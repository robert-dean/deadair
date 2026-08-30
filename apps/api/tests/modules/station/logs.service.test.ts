// Two things here can be quietly wrong.
//
// The first is the level filter on a source that has no levels. `readLog` takes a `level` for every
// source and only one of them can act on it, so a file source that silently accepted the parameter
// would show an operator an unfiltered list under a control that looked like it had worked. The page
// leaves `level` absent in that case, and that absence is what these assert.
//
// The second is degradation. Every source here may simply not exist — a station that has never run
// the stream has no stream logs, a process that has not written its first line has no `api.log` —
// and none of that may fail the page. An id that names no source at all is the one real error.

import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { LogsService } from '../../../src/modules/station/logs.service.js';
import { setLogStore } from '../../../src/logging/log.store.js';
import { RotatingLogStore } from '../../../src/logging/rotating.log.store.js';

let root: string;
let logsDir: string;
let streamDir: string;
let service: LogsService;
let logger: Logger;
let store: RotatingLogStore | undefined;

/** A config over a fixed map, so `LOGS_DIR` and `STREAM_LOGS_DIR` can answer differently. */
const config = (values: Record<string, string>): AppConfig =>
    ({ get: (key: string, fallback: unknown) => values[key] ?? fallback }) as unknown as AppConfig;

/** Publishes a real store over `logsDir` and writes `lines` into the app channel through it. */
async function writeAppLog(lines: readonly { level: string; message: string }[]): Promise<void> {
    store = new RotatingLogStore({ root: logsDir });
    setLogStore(store);
    for (const line of lines) store.append(undefined, line.level, line.message);
    // Closed rather than left open: the writes go through a stream, and reading the file back
    // before it has drained is a race this suite would lose intermittently.
    await store.close();
}

/** Writes one of the stream's own logs, in whatever format that process happens to use. */
async function writeStreamLog(filename: string, content: string): Promise<void> {
    await mkdir(streamDir, { recursive: true });
    await writeFile(join(streamDir, filename), content, 'utf8');
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-logs-'));
    logsDir = join(root, 'logs');
    // Where the derivation puts it: the sibling of LOGS_DIR, which is exactly the production
    // image's /data/logs and /data/streamlogs.
    streamDir = join(root, 'streamlogs');
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    service = new LogsService(config({ LOGS_DIR: logsDir }), logger);
});

afterEach(async () => {
    await store?.close();
    store = undefined;
    setLogStore(undefined);
    await rm(root, { recursive: true, force: true });
});

describe('LogsService.listSources', () => {
    it('reports every source in a fixed order, present or not', async () => {
        const { sources } = await service.listSources();

        expect(sources.map(source => source.id)).toEqual(['api', 'liquidsoap', 'shim']);
    });

    it('says which sources carry a level, so the console knows whether to offer the filter', async () => {
        const { sources } = await service.listSources();

        expect(Object.fromEntries(sources.map(source => [source.id, source.levels]))).toEqual({
            api: true,
            liquidsoap: false,
            shim: false,
        });
    });

    it('reports a source that has never been written as absent rather than failing', async () => {
        const { sources } = await service.listSources();

        for (const source of sources) {
            expect(source.present).toBe(false);
            expect(source.bytes).toBe(0);
            // Absent, not null: an optional the reader does not have is dropped.
            expect(source).not.toHaveProperty('lastWriteAt');
        }
    });

    it('measures the app log once it has been written', async () => {
        await writeAppLog([{ level: 'info', message: 'the station came up' }]);

        const source = (await service.listSources()).sources.find(entry => entry.id === 'api');

        expect(source?.present).toBe(true);
        expect(source?.bytes).toBeGreaterThan(0);
        expect(source?.lastWriteAt).toBeDefined();
    });

    it('does not count the plugin channels or the trace files as part of the app log', async () => {
        await writeAppLog([{ level: 'info', message: 'a line' }]);
        const withoutNeighbours = (await service.listSources()).sources.find(entry => entry.id === 'api')?.bytes ?? 0;

        // A plugin's channel is a subdirectory of the same root, and so is `traces/`. Neither is
        // this source, and a size that swallowed them would be wrong in a way nobody could see.
        await mkdir(join(logsDir, 'deadair.spotify'), { recursive: true });
        await writeFile(join(logsDir, 'deadair.spotify', 'plugin.log'), 'x'.repeat(5000), 'utf8');
        await mkdir(join(logsDir, 'traces'), { recursive: true });
        await writeFile(join(logsDir, 'traces', '2026-08-30.jsonl'), 'x'.repeat(5000), 'utf8');

        expect((await service.listSources()).sources.find(entry => entry.id === 'api')?.bytes).toBe(withoutNeighbours);
    });

    it('finds the stream logs at the sibling of LOGS_DIR', async () => {
        await writeStreamLog('liquidsoap.log', '2026/08/30 10:00:00 [main:3] started\n');

        const source = (await service.listSources()).sources.find(entry => entry.id === 'liquidsoap');

        expect(source?.present).toBe(true);
        expect(source?.bytes).toBeGreaterThan(0);
    });

    it('prefers STREAM_LOGS_DIR over the derivation when an operator has set one', async () => {
        const elsewhere = join(root, 'somewhere-else');
        await mkdir(elsewhere, { recursive: true });
        await writeFile(join(elsewhere, 'spotify-shim.log'), 'starting\n', 'utf8');

        const pointed = new LogsService(config({ LOGS_DIR: logsDir, STREAM_LOGS_DIR: elsewhere }), logger);

        expect((await pointed.listSources()).sources.find(entry => entry.id === 'shim')?.present).toBe(true);
        // And the derived directory, which is where the unpointed service looks, has nothing in it.
        expect((await service.listSources()).sources.find(entry => entry.id === 'shim')?.present).toBe(false);
    });
});

describe('LogsService.readLog', () => {
    it('answers the app log newest first', async () => {
        await writeAppLog([
            { level: 'info', message: 'first' },
            { level: 'info', message: 'second' },
            { level: 'info', message: 'third' },
        ]);

        const page = await service.readLog('api', {});

        expect(page.lines.map(line => line.text)).toEqual(['third', 'second', 'first']);
    });

    it('parses the stamp and the level off a line it wrote itself', async () => {
        await writeAppLog([{ level: 'warn', message: 'something is off' }]);

        const [line] = (await service.readLog('api', {})).lines;

        expect(line?.level).toBe('warn');
        expect(line?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(line?.text).toBe('something is off');
    });

    it('filters the app log by minimum severity and says which one it applied', async () => {
        await writeAppLog([
            { level: 'debug', message: 'chatter' },
            { level: 'error', message: 'a real problem' },
        ]);

        const page = await service.readLog('api', { level: 'warn' });

        expect(page.level).toBe('warn');
        expect(page.lines.map(line => line.text)).toEqual(['a real problem']);
    });

    it('answers a line it did not write whole, rather than splitting it into a stamp it is not', async () => {
        await writeAppLog([{ level: 'info', message: 'a proper line' }]);
        // The store's own regex is `<token> <token> <rest>`, so it would report this as a decision
        // stamped `something`. An optional `ts` that means "the first word" is worse than no `ts`.
        await appendFile(join(logsDir, 'api.log'), 'something else entirely\n', 'utf8');

        const [line] = (await service.readLog('api', {})).lines;

        expect(line?.text).toBe('something else entirely');
        expect(line).not.toHaveProperty('ts');
        expect(line).not.toHaveProperty('level');
    });

    it('answers a line with nothing to split at all whole', async () => {
        await writeAppLog([{ level: 'info', message: 'a proper line' }]);
        await appendFile(join(logsDir, 'api.log'), 'unsplittable\n', 'utf8');

        expect((await service.readLog('api', {})).lines[0]?.text).toBe('unsplittable');
    });

    it('drops a level token that is not one of the five rather than inventing one', async () => {
        await writeAppLog([{ level: 'notice', message: 'from somewhere else' }]);

        const [line] = (await service.readLog('api', {})).lines;

        expect(line?.text).toBe('from somewhere else');
        expect(line).not.toHaveProperty('level');
    });

    it('answers a stream log as raw lines, newest first, with no level on any of them', async () => {
        await writeStreamLog('liquidsoap.log', '2026/08/30 10:00:00 [main:3] started\n2026/08/30 10:00:01 [clock:3] playing\n');

        const page = await service.readLog('liquidsoap', {});

        expect(page.lines.map(line => line.text)).toEqual(['2026/08/30 10:00:01 [clock:3] playing', '2026/08/30 10:00:00 [main:3] started']);
        expect(page.lines.every(line => line.level === undefined && line.ts === undefined)).toBe(true);
    });

    it('leaves level absent on a stream log even when one was asked for', async () => {
        await writeStreamLog('liquidsoap.log', 'one\ntwo\n');

        const page = await service.readLog('liquidsoap', { level: 'error' });

        // The filter did nothing, and the page must not look as though it had.
        expect(page).not.toHaveProperty('level');
        expect(page.lines).toHaveLength(2);
    });

    it('honours the limit', async () => {
        await writeStreamLog('liquidsoap.log', `${['a', 'b', 'c', 'd', 'e'].join('\n')}\n`);

        expect((await service.readLog('liquidsoap', { limit: 2 })).lines.map(line => line.text)).toEqual(['e', 'd']);
    });

    it('says so when a stream log was longer than the tail budget', async () => {
        // Liquidsoap rotates nothing, so this file grows for as long as the station runs. The read
        // is bounded and the page has to admit that the oldest line it shows is not the first.
        const line = `${'x'.repeat(199)}\n`;
        await writeStreamLog('liquidsoap.log', line.repeat(4000)); // 800 KB, past the 512 KiB budget

        const page = await service.readLog('liquidsoap', { limit: 10 });

        expect(page.truncated).toBe(true);
        expect(page.lines).toHaveLength(10);
    });

    it('does not call a short stream log truncated', async () => {
        await writeStreamLog('liquidsoap.log', 'one\ntwo\n');

        expect((await service.readLog('liquidsoap', {})).truncated).toBe(false);
    });

    it('answers nothing rather than throwing for a source that has never been written', async () => {
        expect(await service.readLog('shim', {})).toEqual({ sourceId: 'shim', truncated: false, lines: [] });
    });

    it('answers nothing rather than throwing when setup never published a store', async () => {
        // Outside a test this is a boot that failed before `setup.server.ts` got there.
        setLogStore(undefined);

        expect(await service.readLog('api', {})).toEqual({ sourceId: 'api', truncated: false, lines: [] });
    });

    it('refuses an id that names no source', async () => {
        await expect(service.readLog('../../etc/passwd', {})).rejects.toMatchObject({ statusCode: 404 });
        await expect(service.readLog('nginx', {})).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('LogsService.downloadLog', () => {
    it('hands back the app log as the file was written, oldest first', async () => {
        await writeAppLog([
            { level: 'info', message: 'first' },
            { level: 'info', message: 'second' },
        ]);

        const { body } = await service.downloadLog('api');
        const messages = body
            .split('\n')
            .filter(line => line.length > 0)
            // `<ISO ts> <LEVEL padded to five> <message>`, which is the file's own shape and the
            // reason the download is not the same thing as a page of parsed lines.
            .map(line => line.replace(/^\S+\s+\S+\s+/, ''));

        expect(messages).toEqual(['first', 'second']);
    });

    it('names the attachment after the source rather than after anything a caller sent', async () => {
        const { headers } = await service.downloadLog('liquidsoap');

        expect(headers.contentDisposition).toBe('attachment; filename="deadair-liquidsoap.log"');
    });

    it('hands back an empty body for a source that is not there, with the header intact', async () => {
        const { body, headers } = await service.downloadLog('shim');

        expect(body).toBe('');
        expect(headers.contentDisposition).toBe('attachment; filename="deadair-shim.log"');
    });

    it('refuses an id that names no source', async () => {
        await expect(service.downloadLog('icecast')).rejects.toMatchObject({ statusCode: 404 });
    });
});
