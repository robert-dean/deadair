import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPluginError, type PluginError, type PluginErrorCode, type PluginManifest } from '@deadair/plugin-sdk';

import {
    PLUGIN_STREAM_IDLE_TIMEOUT_MS,
    PLUGIN_STREAM_LIFETIME_MS,
    PLUGIN_STREAM_MAX_BYTES,
    PLUGIN_STREAM_MAX_OPEN,
    PluginHostFactory,
    PluginHostFactoryOptions,
} from '../../../src/modules/plugins/plugin.host.factory.js';
import type { PluginConfigService } from '../../../src/modules/plugins/plugin.config.service.js';
import type { PluginStorageRepository } from '../../../src/modules/plugins/plugin.storage.repository.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const PLUGIN_ID = 'test.streams';

function manifest(network: PluginManifest['permissions']['network'] = ['audio.example.com']): PluginManifest {
    return {
        id: PLUGIN_ID,
        name: 'Streaming Plugin',
        version: '1.0.0',
        kind: 'tts',
        capabilities: ['speech'],
        apiVersion: '^1.0.0',
        permissions: { network, storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
    };
}

function factory(): PluginHostFactory {
    const storage = {} as unknown as PluginStorageRepository;
    const configService = {} as unknown as PluginConfigService;
    return new PluginHostFactory(new PluginHostFactoryOptions('https://host.example'), configService, storage, stubPluginLog().log);
}

/** A response whose body yields `chunks` in order and then ends. */
const bodyOf = (chunks: Uint8Array[], init?: ResponseInit): Response =>
    new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                for (const chunk of chunks) controller.enqueue(chunk);
                controller.close();
            },
        }),
        init,
    );

/** A body that produces `first` and then never anything else, until it is cancelled. */
const stallingBodyAfter = (first: Uint8Array): Response =>
    new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(first);
            },
        }),
    );

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

const decode = (data: string | undefined): Uint8Array => new Uint8Array(Buffer.from(data ?? '', 'base64'));

async function rejection(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
        value => {
            throw new Error(`expected a rejection, got ${JSON.stringify(value)}`);
        },
        (thrown: unknown) => thrown,
    );
}

async function expectPluginError(promise: Promise<unknown>, code: PluginErrorCode, pattern: RegExp): Promise<PluginError> {
    const error = await rejection(promise);

    expect(isPluginError(error), `expected a PluginError, got ${String(error)}`).toBe(true);
    expect((error as PluginError).code).toBe(code);
    expect((error as PluginError).message).toMatch(pattern);

    return error as PluginError;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('host.streams.open', () => {
    it('refuses a hostname the manifest never declared, before any request goes out', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const host = factory().createHost(manifest(['audio.example.com']));

        await expectPluginError(host.streams.open('https://elsewhere.example.com/x.mp3'), 'forbidden', /not allowed to reach "elsewhere/);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('hands back the status and headers without draining the body', async () => {
        // Counts how many times the source was asked for more. A `ReadableStream`
        // fills its own one-chunk buffer eagerly whatever the consumer does, so
        // the claim being tested is "one chunk, not the file" rather than
        // "nothing at all" — which is still the whole difference from `host.fetch`.
        let pulls = 0;
        const response = new Response(
            new ReadableStream<Uint8Array>({
                pull(controller) {
                    pulls += 1;
                    if (pulls >= 3) return controller.close();
                    controller.enqueue(bytes(pulls));
                },
            }),
            { status: 200, headers: { 'content-type': 'audio/mpeg' } },
        );
        vi.stubGlobal('fetch', vi.fn(async () => response));
        const host = factory().createHost(manifest());

        const opened = await host.streams.open('https://audio.example.com/speech.mp3');

        expect(opened.status).toBe(200);
        expect(opened.ok).toBe(true);
        expect(opened.headers['content-type']).toBe('audio/mpeg');
        expect(opened.url).toBe('https://audio.example.com/speech.mp3');
        expect(typeof opened.streamId).toBe('string');
        expect(pulls).toBeLessThanOrEqual(1);

        // And the rest arrives only because it was asked for.
        await host.streams.read(opened.streamId);
        await host.streams.read(opened.streamId);
        expect(await host.streams.read(opened.streamId)).toMatchObject({ done: true });
        expect(pulls).toBe(3);
    });

    it('re-checks the allowlist on a redirect hop, exactly as host.fetch does', async () => {
        const redirect = new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.com/x.mp3' } });
        vi.stubGlobal('fetch', vi.fn(async () => redirect));
        const host = factory().createHost(manifest(['audio.example.com']));

        await expectPluginError(
            host.streams.open('https://audio.example.com/speech.mp3'),
            'upstream',
            /not allowed to reach "elsewhere\.example\.com".*redirected there by/s,
        );
    });

    it('refuses to open more than the host allows at once, and counts only live streams', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => bodyOf([bytes(1)])));
        const host = factory().createHost(manifest());

        const opened = [];
        for (let index = 0; index < PLUGIN_STREAM_MAX_OPEN; index++) {
            opened.push(await host.streams.open('https://audio.example.com/speech.mp3'));
        }

        await expectPluginError(host.streams.open('https://audio.example.com/speech.mp3'), 'unavailable', /already holds \d+ open streams/);

        // Closing one makes room again, which is what says the cap counts what is
        // held rather than what has ever been opened.
        await host.streams.close(opened[0]!.streamId);
        await expect(host.streams.open('https://audio.example.com/speech.mp3')).resolves.toBeDefined();
    });
});

describe('host.streams.read', () => {
    it('walks the body in order and ends with a terminal chunk carrying no data', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => bodyOf([bytes(1, 2), bytes(3)])));
        const host = factory().createHost(manifest());
        const { streamId } = await host.streams.open('https://audio.example.com/speech.mp3');

        const first = await host.streams.read(streamId);
        const second = await host.streams.read(streamId);
        const last = await host.streams.read(streamId);

        expect(decode(first.data)).toEqual(bytes(1, 2));
        expect(decode(second.data)).toEqual(bytes(3));
        expect([first.seq, second.seq, last.seq]).toEqual([0, 1, 2]);
        expect([first.done, second.done]).toEqual([false, false]);
        expect(last.done).toBe(true);
        expect(last.data).toBeUndefined();
    });

    it('holds back what maxBytes did not take, so a small read costs round trips and never bytes', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => bodyOf([bytes(1, 2, 3, 4, 5)])));
        const host = factory().createHost(manifest());
        const { streamId } = await host.streams.open('https://audio.example.com/speech.mp3');

        const first = await host.streams.read(streamId, 2);
        const second = await host.streams.read(streamId, 2);
        const third = await host.streams.read(streamId, 2);

        expect(decode(first.data)).toEqual(bytes(1, 2));
        expect(decode(second.data)).toEqual(bytes(3, 4));
        expect(decode(third.data)).toEqual(bytes(5));
        expect(await host.streams.read(streamId)).toMatchObject({ done: true });
    });

    it('answers a stream that already ended as one that does not exist', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => bodyOf([bytes(1)])));
        const host = factory().createHost(manifest());
        const { streamId } = await host.streams.open('https://audio.example.com/speech.mp3');

        await host.streams.read(streamId);
        expect(await host.streams.read(streamId)).toMatchObject({ done: true });

        await expectPluginError(host.streams.read(streamId), 'not_found', /has no open stream/);
    });

    it('answers an id nobody ever opened as not_found, which does not count against the plugin', async () => {
        vi.stubGlobal('fetch', vi.fn());
        const host = factory().createHost(manifest());

        // `not_found` is resource-scoped, so a plugin asking about a stream it
        // already closed cannot trip its own circuit breaker.
        await expectPluginError(host.streams.read('nope'), 'not_found', /has no open stream "nope"/);
    });

    it('gives up on a body that stalls, and calls it a timeout', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn(async () => stallingBodyAfter(bytes(1))));
        const host = factory().createHost(manifest());
        const { streamId } = await host.streams.open('https://audio.example.com/speech.mp3');

        expect(decode((await host.streams.read(streamId)).data)).toEqual(bytes(1));

        // The assertion is attached BEFORE the clock moves. Advancing first would
        // reject a promise nobody is holding a handler for yet, which Node reports
        // as an unhandled rejection even though the test goes on to await it.
        const stalled = expectPluginError(
            host.streams.read(streamId),
            'timeout',
            new RegExp(`produced nothing for ${PLUGIN_STREAM_IDLE_TIMEOUT_MS}ms`),
        );
        await vi.advanceTimersByTimeAsync(PLUGIN_STREAM_IDLE_TIMEOUT_MS + 1);
        await stalled;
    });

    it('refuses a stream that outlives the lifetime cap, and says so on the next read', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn(async () => stallingBodyAfter(bytes(1))));
        const host = factory().createHost(manifest());
        const { streamId } = await host.streams.open('https://audio.example.com/speech.mp3');

        await host.streams.read(streamId);
        await vi.advanceTimersByTimeAsync(PLUGIN_STREAM_LIFETIME_MS + 1);

        // The recorded reason, not "no such stream": the plugin is told what
        // happened to a stream it was legitimately holding.
        await expectPluginError(
            host.streams.read(streamId),
            'timeout',
            new RegExp(`held a stream open for more than ${PLUGIN_STREAM_LIFETIME_MS}ms`),
        );
    });

    it('refuses a stream that runs past the byte cap', async () => {
        // Two chunks either side of the cap, so the running count is what catches
        // it rather than any declared length.
        const half = new Uint8Array(PLUGIN_STREAM_MAX_BYTES / 2 + 1);
        vi.stubGlobal('fetch', vi.fn(async () => bodyOf([half, half])));
        const host = factory().createHost(manifest());
        const { streamId } = await host.streams.open('https://audio.example.com/big.wav');

        await host.streams.read(streamId);

        await expectPluginError(host.streams.read(streamId), 'upstream', new RegExp(`over the ${PLUGIN_STREAM_MAX_BYTES} byte limit`));
    });

    it('reads a response that had no body at all as an immediately finished stream', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
        const host = factory().createHost(manifest());
        const opened = await host.streams.open('https://audio.example.com/speech.mp3');

        expect(opened.status).toBe(204);
        expect(await host.streams.read(opened.streamId)).toMatchObject({ seq: 0, done: true });
    });
});

describe('host.streams.close', () => {
    it('is idempotent, so a plugin can always call it from a finally', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => bodyOf([bytes(1)])));
        const host = factory().createHost(manifest());
        const { streamId } = await host.streams.open('https://audio.example.com/speech.mp3');

        await expect(host.streams.close(streamId)).resolves.toBeUndefined();
        await expect(host.streams.close(streamId)).resolves.toBeUndefined();
        await expect(host.streams.close('never-existed')).resolves.toBeUndefined();
    });

    it('aborts the request behind the stream', async () => {
        let signal: AbortSignal | undefined;
        vi.stubGlobal(
            'fetch',
            vi.fn(async (_url: URL, init: RequestInit) => {
                signal = init.signal ?? undefined;
                return bodyOf([bytes(1)]);
            }),
        );
        const host = factory().createHost(manifest());
        const { streamId } = await host.streams.open('https://audio.example.com/speech.mp3');

        expect(signal?.aborted).toBe(false);
        await host.streams.close(streamId);
        expect(signal?.aborted).toBe(true);
    });
});

describe('PluginHostFactory.closeStreamsFor', () => {
    it('lets go of everything a disposed plugin was still holding', async () => {
        const signals: AbortSignal[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (_url: URL, init: RequestInit) => {
                if (init.signal) signals.push(init.signal);
                return bodyOf([bytes(1)]);
            }),
        );
        const hostFactory = factory();
        const host = hostFactory.createHost(manifest());

        const first = await host.streams.open('https://audio.example.com/a.mp3');
        const second = await host.streams.open('https://audio.example.com/b.mp3');

        hostFactory.closeStreamsFor(PLUGIN_ID);

        expect(signals.every(signal => signal.aborted)).toBe(true);
        // A stream cannot outlive the instance that opened it, so what is left is
        // an id nothing knows about.
        await expectPluginError(host.streams.read(first.streamId), 'not_found', /has no open stream/);
        await expectPluginError(host.streams.read(second.streamId), 'not_found', /has no open stream/);
    });

    it('is safe for a plugin that never opened one, and safe to call twice', () => {
        const hostFactory = factory();
        hostFactory.createHost(manifest());

        expect(() => hostFactory.closeStreamsFor(PLUGIN_ID)).not.toThrow();
        expect(() => hostFactory.closeStreamsFor(PLUGIN_ID)).not.toThrow();
        expect(() => hostFactory.closeStreamsFor('never.existed')).not.toThrow();
    });
});
