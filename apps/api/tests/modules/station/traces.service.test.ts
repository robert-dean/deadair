// The fold is where this can be quietly wrong. `job.run` is the decision itself and every other
// span happened inside it, so a fold that summed both would report every job's cost roughly twice
// and nothing would look broken — the numbers would just be flattering in a way nobody could catch
// by reading them.
//
// The rest of what is tested here is degradation. This reads files that another process is appending
// to, on a station where the directory may not exist at all, and none of that may fail the page.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { TracesService } from '../../../src/modules/station/traces.service.js';

let root: string;
let service: TracesService;
let logger: Logger;

const config = (dir: string): AppConfig => ({ get: (_key: string, fallback: unknown) => dir ?? fallback }) as unknown as AppConfig;

/** One span as `recordSpan` writes it. */
const span = (overrides: Record<string, unknown> = {}) => ({
    at: '2026-08-28T10:00:00.000Z',
    trace: 'job-1',
    kind: 'catalog.enrich',
    op: 'plugin.invoke',
    target: 'deadair.wikipedia enrichment.enrichTrack',
    ms: 100,
    outcome: 'ok',
    ...overrides,
});

async function write(day: string, spans: object[]): Promise<void> {
    await mkdir(join(root, 'traces'), { recursive: true });
    await writeFile(join(root, 'traces', `${day}.jsonl`), spans.map(s => JSON.stringify(s)).join('\n') + '\n', 'utf8');
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-traces-'));
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    service = new TracesService(config(root), logger);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('TracesService.readTraces', () => {
    it('does not count the job.run span as one of the calls inside it', async () => {
        // The whole point of the fold. `job.run` supplies the wall clock; the two calls under it are
        // the breakdown, and adding all three would report 1,200ms of work in a 1,000ms job.
        await write('2026-08-28', [span({ op: 'job.run', target: 'catalog.enrich', ms: 1000 }), span({ ms: 100 }), span({ ms: 100 })]);

        const page = await service.readTraces({});

        expect(page.decisions).toHaveLength(1);
        expect(page.decisions[0]).toMatchObject({ id: 'job-1', kind: 'catalog.enrich', ms: 1000, calls: 2, failed: 0 });
    });

    it('reports zero wall clock for a decision recorded before job.run existed', async () => {
        // Rather than summing its calls, which would look like a wall clock and not be one.
        await write('2026-08-28', [span({ ms: 100 }), span({ ms: 100 })]);

        expect((await service.readTraces({})).decisions[0]).toMatchObject({ ms: 0, calls: 2 });
    });

    it('counts a failed call and carries it onto the decision', async () => {
        await write('2026-08-28', [span(), span({ outcome: 'failed', error: 'upstream is down' })]);

        expect((await service.readTraces({})).decisions[0]).toMatchObject({ calls: 2, failed: 1 });
    });

    it('sorts by when a decision last did something, not when it started', async () => {
        // What keeps a long job at the top of the list while it is still running, which is where
        // somebody looking into it expects to find it.
        await write('2026-08-28', [
            span({ trace: 'old', at: '2026-08-28T09:00:00.000Z' }),
            span({ trace: 'long', at: '2026-08-28T08:00:00.000Z' }),
            span({ trace: 'long', at: '2026-08-28T11:00:00.000Z' }),
        ]);

        expect((await service.readTraces({})).decisions.map(d => d.id)).toEqual(['long', 'old']);
    });

    it('says how many decisions the window holds and how many spans that cost', async () => {
        // The page reports its own cost rather than hiding it: if that number gets uncomfortable the
        // answer is a shorter window, not a cursor over a file.
        await write('2026-08-28', [span({ trace: 'a' }), span({ trace: 'b' }), span({ trace: 'c' })]);

        const page = await service.readTraces({ limit: 2 });

        expect(page.decisions).toHaveLength(2);
        expect(page).toMatchObject({ total: 3, spans: 3 });
    });

    it('filters to one kind, and to the ones that failed', async () => {
        await write('2026-08-28', [
            span({ trace: 'a', kind: 'catalog.enrich' }),
            span({ trace: 'b', kind: 'schedule.tick' }),
            span({ trace: 'c', kind: 'catalog.enrich', outcome: 'failed' }),
        ]);

        expect((await service.readTraces({ kind: 'catalog.enrich' })).decisions.map(d => d.id).sort()).toEqual(['a', 'c']);
        expect((await service.readTraces({ failedOnly: true })).decisions.map(d => d.id)).toEqual(['c']);
    });

    it('reads every kept day, not just the newest', async () => {
        await write('2026-08-27', [span({ trace: 'yesterday', at: '2026-08-27T10:00:00.000Z' })]);
        await write('2026-08-28', [span({ trace: 'today' })]);

        expect((await service.readTraces({})).decisions.map(d => d.id)).toEqual(['today', 'yesterday']);
    });
});

describe('TracesService.readTrace', () => {
    it('answers on a prefix, so an id copied out of a log line is enough', async () => {
        await write('2026-08-28', [span({ trace: 'd0536839-28f3-4b20' })]);

        expect((await service.readTrace('d0536839')).decision.id).toBe('d0536839-28f3-4b20');
    });

    it('shows the decisions on either side of this one', async () => {
        // The edge in both directions, which is the whole reason a parent is carried at all: a job
        // that enqueues another is two decisions that may run minutes apart.
        await write('2026-08-28', [
            span({ trace: 'parent', kind: 'catalog.enrich' }),
            span({ trace: 'child', kind: 'catalog.extract_facts', parent: 'parent' }),
            span({ trace: 'other-child', kind: 'render.segment', parent: 'parent' }),
        ]);

        const detail = await service.readTrace('parent');
        expect(detail.parent).toBeUndefined();
        expect(detail.caused.map(d => d.id).sort()).toEqual(['child', 'other-child']);

        expect((await service.readTrace('child')).parent).toMatchObject({ id: 'parent', kind: 'catalog.enrich' });
    });

    it('names no parent when the parent has rotated out of the window', async () => {
        // A real state, not an error: the edge was recorded and the other end is gone. The console
        // draws that rather than being handed a row with an id and no cost.
        await write('2026-08-28', [span({ trace: 'child', parent: 'long-gone' })]);

        const detail = await service.readTrace('child');
        expect(detail.decision.parent).toBe('long-gone');
        expect(detail.parent).toBeUndefined();
    });

    it('refuses an id the window does not hold', async () => {
        await write('2026-08-28', [span()]);

        await expect(service.readTrace('nothing-like-it')).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('when the files cannot be read', () => {
    it('answers empty rather than failing on a station that has written no span', async () => {
        // Every station, until the first job runs after this ships.
        await expect(service.readTraces({})).resolves.toEqual({ decisions: [], total: 0, spans: 0 });
    });

    it('skips a line that is not JSON and keeps the rest of the day', async () => {
        // A file being appended to as this reads it can end mid-line, and one bad line must not cost
        // the reader everything before it.
        await mkdir(join(root, 'traces'), { recursive: true });
        await writeFile(join(root, 'traces', '2026-08-28.jsonl'), `${JSON.stringify(span())}\n{"at":"2026-08-2`, 'utf8');

        expect((await service.readTraces({})).decisions).toHaveLength(1);
    });
});
