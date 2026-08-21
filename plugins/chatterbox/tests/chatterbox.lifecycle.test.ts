// Getting a model onto the GPU and off it again, which is the whole of what makes this engine more
// than a second Kokoro. Every rule here is one the previous station paid for on air, so the tests
// are written against the failures rather than against the happy path.

import { describe, expect, it, vi } from 'vitest';
import { isPluginError } from '@deadair/plugin-sdk';

import { LOAD_POLL_MS, LOAD_TIMEOUT_MS, ModelLifecycle, serverRoot } from '../src/chatterbox.lifecycle.js';

const BASE_URL = 'http://gpu.test:8004/v1';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

interface HarnessOptions {
    /** What `/api/model-info` says `loaded` is, one answer per call. The last one repeats. */
    loaded?: boolean[];
    /** What `/restart_server` answers with, one per call. The last one repeats. */
    load?: (number | 'throw')[];
    unloadStatus?: number;
}

function harness(options: HarnessOptions = {}) {
    const loadedAnswers = [...(options.loaded ?? [true])];
    const loadAnswers = [...(options.load ?? [200])];
    const calls: string[] = [];

    /** Takes the next answer, repeating the last one forever. */
    const next = <T>(queue: T[]): T => (queue.length > 1 ? queue.shift()! : queue[0]!);

    const fetch = vi.fn(async (url: string) => {
        if (url.endsWith('/api/model-info')) {
            calls.push('info');
            return json({ loaded: next(loadedAnswers) });
        }
        if (url.endsWith('/restart_server')) {
            calls.push('load');
            const answer = next(loadAnswers);
            if (answer === 'throw') throw new Error('connection refused');
            return json({}, answer);
        }
        if (url.endsWith('/api/unload')) {
            calls.push('unload');
            return json({}, options.unloadStatus ?? 200);
        }
        throw new Error(`unexpected url ${url}`);
    });

    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    // A clock the poll does not own, so a timeout is a few lines rather than a minute.
    let clock = 0;
    const lifecycle = new ModelLifecycle({
        baseUrl: BASE_URL,
        fetch: fetch as never,
        headers: () => ({}),
        logger: logger as never,
        now: () => clock,
        sleep: async ms => {
            clock += ms;
        },
    });

    return { lifecycle, fetch, calls, logger, tick: (ms: number) => (clock += ms) };
}

describe('serverRoot', () => {
    it('strips the version segment, because model management lives above it', () => {
        expect(serverRoot('http://gpu.test:8004/v1')).toBe('http://gpu.test:8004');
        expect(serverRoot('http://gpu.test:8004/v1/')).toBe('http://gpu.test:8004');
        expect(serverRoot('http://gpu.test:8004/v2')).toBe('http://gpu.test:8004');
    });

    it('leaves an address that is already the root alone', () => {
        expect(serverRoot('http://gpu.test:8004')).toBe('http://gpu.test:8004');
    });

    it('keeps a path prefix that is not a version', () => {
        // A server behind a reverse proxy at /tts/v1 has its root at /tts, not at /.
        expect(serverRoot('http://gpu.test/tts/v1')).toBe('http://gpu.test/tts');
    });
});

describe('loaded', () => {
    it('reads what the server says', async () => {
        expect(await harness({ loaded: [true] }).lifecycle.loaded()).toBe(true);
        expect(await harness({ loaded: [false] }).lifecycle.loaded()).toBe(false);
    });

    it('counts an unreachable server as holding nothing', async () => {
        // The safe direction in both places this is read: before a synthesis it means try to load,
        // and inside the poll it means keep waiting. Answering yes to a silent server would send a
        // synthesis at nothing.
        const { lifecycle, fetch } = harness();
        fetch.mockRejectedValue(new Error('connection refused'));

        expect(await lifecycle.loaded()).toBe(false);
    });

    it('counts a refusal as holding nothing', async () => {
        const { lifecycle, fetch } = harness();
        fetch.mockResolvedValue(json({}, 500));

        expect(await lifecycle.loaded()).toBe(false);
    });
});

describe('ensureLoaded', () => {
    it('does nothing at all when a model is already resident', async () => {
        // The ordinary case, and it must cost one question rather than a load.
        const { lifecycle, calls } = harness({ loaded: [true] });

        await lifecycle.ensureLoaded();

        expect(calls).toEqual(['info']);
    });

    it('loads one when the server is empty, and asks before waiting', async () => {
        // The load is synchronous on current builds, so a poll that slept first would add two
        // seconds to every cold break for nothing.
        const { lifecycle, calls } = harness({ loaded: [false, true] });

        await lifecycle.ensureLoaded();

        expect(calls).toEqual(['info', 'load', 'info']);
    });

    it('waits for a load that reports resident later', async () => {
        const { lifecycle, calls } = harness({ loaded: [false, false, false, true] });

        await lifecycle.ensureLoaded();

        expect(calls.filter(call => call === 'info')).toHaveLength(4);
        expect(calls.filter(call => call === 'load')).toHaveLength(1);
    });

    it('unloads before retrying a load that failed, rather than OOMing against its own leak', async () => {
        // The self-heal. A load that dies on CUDA OOM strands its partial allocations — 3.5 GiB
        // observed on a 16 GiB card — so an immediate retry throws itself at a GPU it just filled.
        const { lifecycle, calls } = harness({ loaded: [false, true], load: [500, 200] });

        await lifecycle.ensureLoaded();

        expect(calls).toEqual(['info', 'load', 'unload', 'load', 'info']);
    });

    it('gives up as `unavailable`, so the segment keeps its words', async () => {
        // Not `upstream`: the engine is fine and the station simply has nothing to speak with yet.
        // `RenderSegmentJob` reads that code and leaves the row `written` rather than writing the
        // break off and spending one of its three attempts.
        const { lifecycle } = harness({ loaded: [false], load: [500, 500] });

        const error = await lifecycle.ensureLoaded().catch((thrown: unknown) => thrown);

        expect(isPluginError(error)).toBe(true);
        expect(isPluginError(error) && error.code).toBe('unavailable');
    });

    it('gives up when the server accepts the load and never reports a model', async () => {
        // Bounded well inside the host's own 120s invocation budget, because the synthesis still
        // has to happen after this: a load allowed to eat the lot turns a cold start into a break
        // that fails rather than one that is merely slow.
        const { lifecycle, calls } = harness({ loaded: [false] });

        const error = await lifecycle.ensureLoaded().catch((thrown: unknown) => thrown);

        expect(isPluginError(error) && error.code).toBe('unavailable');
        // One poll per interval across the window, plus the free one before any waiting, and the
        // second load the self-heal tries.
        expect(calls.filter(call => call === 'info').length).toBeGreaterThanOrEqual(LOAD_TIMEOUT_MS / LOAD_POLL_MS);
    });
});

describe('unload', () => {
    it('never throws when the server refuses', async () => {
        // It is called on the way out of a render that already succeeded, and on the retry path
        // where an exception would mask the load error that actually mattered.
        const { lifecycle, logger } = harness({ unloadStatus: 500 });

        await expect(lifecycle.unload()).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('never throws when the server is unreachable', async () => {
        const { lifecycle, fetch, logger } = harness();
        fetch.mockRejectedValue(new Error('connection refused'));

        await expect(lifecycle.unload()).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
    });
});
