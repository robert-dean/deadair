// The recorder's whole value is that it records the calls nobody else does — a timeout, a plugin
// disposed mid-stream — so what is worth testing is the two ways it could fail to: by not writing at
// all, and by writing something a reader cannot parse.
//
// It also sits inside every plugin call the station makes, which makes its failure modes the
// caller's problem. Hence the two rules asserted here that look like paranoia and are not: it never
// throws, and it never makes a caller wait.

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { flushSpans, MAX_TRACE_FILES, recordSpan, setTraceRoot, spanError } from '../../../src/modules/shared/trace.spans.js';
import { runInTrace } from '../../../src/modules/shared/trace.context.js';

let root: string;

/** Every span written so far, parsed. Fails loudly if a line is not JSON, which is the point. */
async function written(): Promise<Record<string, unknown>[]> {
    await flushSpans();
    const dir = join(root, 'traces');
    const files = (await readdir(dir).catch(() => [])).filter(name => name.endsWith('.jsonl')).sort();
    const lines: Record<string, unknown>[] = [];
    for (const name of files) {
        const text = await readFile(join(dir, name), 'utf8');
        for (const line of text.split('\n').filter(l => l.length > 0)) lines.push(JSON.parse(line));
    }
    return lines;
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-spans-'));
    setTraceRoot(root);
});

afterEach(async () => {
    await flushSpans();
    setTraceRoot(undefined);
    await rm(root, { recursive: true, force: true });
});

describe('recordSpan', () => {
    it('files a span under the decision that was running', async () => {
        await runInTrace({ id: 'job-42', kind: 'director.refill_lineup' }, async () => {
            recordSpan({ op: 'llm.generate', target: 'gpt-oss', ms: 60_007, outcome: 'failed', error: 'budget' });
        });

        const [span] = await written();
        expect(span).toMatchObject({
            trace: 'job-42',
            kind: 'director.refill_lineup',
            op: 'llm.generate',
            target: 'gpt-oss',
            ms: 60_007,
            outcome: 'failed',
            error: 'budget',
        });
        expect(typeof span!.at).toBe('string');
    });

    it('writes nothing outside a trace', async () => {
        // Startup and every timer the station runs. A span with no decision to belong to answers
        // none of the questions this file exists for, and would be most of the volume.
        recordSpan({ op: 'plugin.invoke', ms: 1, outcome: 'ok' });

        expect(await written()).toEqual([]);
    });

    it('writes nothing before the root has been set', async () => {
        // Every unit test in this suite, and anything that runs before `setup.server.ts`.
        setTraceRoot(undefined);

        await runInTrace({ id: 'job-1', kind: 'k' }, async () => {
            recordSpan({ op: 'plugin.invoke', ms: 1, outcome: 'ok' });
        });

        setTraceRoot(root);
        expect(await written()).toEqual([]);
    });

    it('keeps concurrent writes to whole lines', async () => {
        // A half-line is worse than a missing one: a reader parsing JSONL stops at it, so one
        // interleaved write would cost every span after it in the file.
        await runInTrace({ id: 'job-1', kind: 'k' }, async () => {
            for (let i = 0; i < 50; i++) recordSpan({ op: 'plugin.invoke', target: `call-${i}`, ms: i, outcome: 'ok' });
        });

        const spans = await written();
        expect(spans).toHaveLength(50);
        expect(spans.map(s => s.target)).toContain('call-49');
    });

    it('never throws and never makes the caller wait, whatever the disk does', async () => {
        // It sits inside every plugin call the station makes. A station that stopped programming
        // because it could not write a span would be a far worse bug than the one it diagnoses.
        setTraceRoot(join(root, 'traces-file'));
        await writeFile(join(root, 'traces-file'), 'not a directory', 'utf8');

        await runInTrace({ id: 'job-1', kind: 'k' }, async () => {
            expect(() => recordSpan({ op: 'plugin.invoke', ms: 1, outcome: 'ok' })).not.toThrow();
        });

        await expect(flushSpans()).resolves.toBeUndefined();
    });

    it('returns before the write has landed', async () => {
        // `recordSpan` is void on purpose: a caller that awaited it would hold a plugin's slot open
        // for a disk write.
        await runInTrace({ id: 'job-1', kind: 'k' }, async () => {
            recordSpan({ op: 'plugin.invoke', ms: 1, outcome: 'ok' });
            // Nothing on disk yet, and the caller has already carried on.
            const dir = await readdir(join(root, 'traces')).catch(() => []);
            expect(dir).toEqual([]);
        });

        expect(await written()).toHaveLength(1);
    });

    it('keeps a bounded number of days', async () => {
        const dir = join(root, 'traces');
        await runInTrace({ id: 'job-1', kind: 'k' }, async () => {
            recordSpan({ op: 'plugin.invoke', ms: 1, outcome: 'ok' });
        });
        await flushSpans();

        // Older days, named the way the recorder names them so the prune's sort matches.
        for (let day = 1; day <= MAX_TRACE_FILES + 3; day++) {
            await writeFile(join(dir, `2020-01-${String(day).padStart(2, '0')}.jsonl`), '{}\n', 'utf8');
        }

        await runInTrace({ id: 'job-2', kind: 'k' }, async () => {
            recordSpan({ op: 'plugin.invoke', ms: 1, outcome: 'ok' });
        });
        await flushSpans();

        const files = (await readdir(dir)).filter(name => name.endsWith('.jsonl'));
        expect(files).toHaveLength(MAX_TRACE_FILES);
        // Today's file survives, which is the one being written to.
        expect(files.some(name => name.startsWith(new Date().toISOString().slice(0, 10)))).toBe(true);
    });
});

describe('spanError', () => {
    it('takes the message off an Error and bounds it', () => {
        expect(spanError(new Error('upstream is down'))).toBe('upstream is down');
        expect(spanError(new Error('x'.repeat(500))).length).toBe(200);
    });

    it('describes a thrown non-Error rather than dropping it', () => {
        expect(spanError('just a string')).toBe('just a string');
    });
});
