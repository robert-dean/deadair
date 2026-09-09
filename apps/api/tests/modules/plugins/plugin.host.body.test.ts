import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPluginError, type PluginError, type PluginErrorCode, type PluginManifest } from '@deadair/plugin-sdk';

import {
    PLUGIN_BODY_IDLE_TIMEOUT_MS,
    PLUGIN_BODY_LIFETIME_MS,
    PLUGIN_RESPONSE_MAX_BYTES,
    PluginHostFactory,
    PluginHostFactoryOptions,
} from '../../../src/modules/plugins/plugin.host.factory.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';
import { stubShimClient } from '../../utils/spotify.shim.fixture.js';
import type { PluginGrantsService } from '../../../src/modules/plugins/plugin.grants.service.js';
import { stubContainer } from '../../utils/stub.container.js';

/**
 * The bounds on a response body a plugin has not finished reading.
 *
 * These used to belong to a separate byte egress, `host.streams`, with its own handles and base64
 * chunks, because a live `ReadableStream` could not cross the plugin boundary. It can now
 * (`packages/plugin-sdk/CLAUDE.md` § "Trust and egress"), so the protocol is gone and the bounds
 * are not: a body is read outside the deadline that fetched it, and without these it is an
 * unbounded socket.
 */
const PLUGIN_ID = 'test.bodies';

function manifest(network: PluginManifest['permissions']['network'] = ['audio.example.com']): PluginManifest {
    return {
        id: PLUGIN_ID,
        name: 'Streaming Plugin',
        version: '1.0.0',
        capabilities: ['speech'],
        apiVersion: '^1.0.0',
        permissions: { network, storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
    };
}

/** What the operator has allowed: nothing. No manifest in this file asks for a capability. */
const restrictedNetwork = (): PluginGrantsService => ({ holds: () => false }) as unknown as PluginGrantsService;

function factory(): PluginHostFactory {
    // Nothing here reaches the database: every manifest below declares a fixed
    // network allowlist, so no scope is ever opened.
    const { container } = stubContainer([]);
    return new PluginHostFactory(
        new PluginHostFactoryOptions('https://host.example'),
        container,
        stubPluginLog().log,
        stubShimClient(),
        restrictedNetwork(),
    );
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

/** One chunk off a body, the way a plugin reads it. */
const readChunk = async (response: Response): Promise<ReadableStreamReadResult<Uint8Array>> => {
    const reader = readers.get(response) ?? response.body!.getReader();
    readers.set(response, reader);
    return await reader.read();
};

/** One reader per response, so successive `readChunk` calls continue rather than relock. */
const readers = new WeakMap<Response, ReadableStreamDefaultReader<Uint8Array>>();

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

describe('response body bounds', () => {
    it('walks the body in order and ends', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => bodyOf([bytes(1, 2), bytes(3, 4)])),
        );
        const host = factory().createHost(manifest());

        const response = await host.fetch('https://audio.example.com/speech.mp3');

        expect((await readChunk(response)).value).toEqual(bytes(1, 2));
        expect((await readChunk(response)).value).toEqual(bytes(3, 4));
        expect((await readChunk(response)).done).toBe(true);
    });

    it('gives up on a body that stalls, and calls it a timeout', async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => stallingBodyAfter(bytes(1))),
        );
        const host = factory().createHost(manifest());
        const response = await host.fetch('https://audio.example.com/speech.mp3');

        expect((await readChunk(response)).value).toEqual(bytes(1));

        // The assertion is attached BEFORE the clock moves. Advancing first would
        // reject a promise nobody is holding a handler for yet, which Node reports
        // as an unhandled rejection even though the test goes on to await it.
        const stalled = expectPluginError(readChunk(response), 'timeout', new RegExp(`produced nothing for ${PLUGIN_BODY_IDLE_TIMEOUT_MS}ms`));
        await vi.advanceTimersByTimeAsync(PLUGIN_BODY_IDLE_TIMEOUT_MS + 1);
        await stalled;
    });

    it('refuses a body that outlives the lifetime cap, and says so on the next read', async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => stallingBodyAfter(bytes(1))),
        );
        const host = factory().createHost(manifest());
        const response = await host.fetch('https://audio.example.com/speech.mp3');

        // Deliberately NOT read first. A body sitting on a full buffer has no
        // read in flight, so no idle deadline is running and the lifetime cap is
        // the only bound left, which is exactly the case it exists for: a plugin
        // that opened something and then went away.
        await vi.advanceTimersByTimeAsync(1);
        await vi.advanceTimersByTimeAsync(PLUGIN_BODY_LIFETIME_MS + 1);

        // The recorded reason rather than a bare stream error: the plugin is told
        // what happened to a body it was legitimately holding.
        await expectPluginError(readChunk(response), 'timeout', new RegExp(`held a response body open for more than ${PLUGIN_BODY_LIFETIME_MS}ms`));
    });

    it('refuses a body that runs past the byte cap', async () => {
        // Two chunks either side of the cap, so the running count is what catches
        // it rather than any declared length.
        const half = new Uint8Array(PLUGIN_RESPONSE_MAX_BYTES / 2 + 1);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => bodyOf([half, half])),
        );
        const host = factory().createHost(manifest());
        const response = await host.fetch('https://audio.example.com/big.wav');

        await readChunk(response);

        await expectPluginError(readChunk(response), 'upstream', new RegExp(`over the ${PLUGIN_RESPONSE_MAX_BYTES} byte limit`));
    });

    it('reads a response that had no body at all as one that is already finished', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(null, { status: 204 })),
        );
        const host = factory().createHost(manifest());

        const response = await host.fetch('https://audio.example.com/speech.mp3');

        expect(response.status).toBe(204);
        expect(response.body).toBeNull();
        await expect(response.text()).resolves.toBe('');
    });

    it('aborts the request behind a body that is cancelled', async () => {
        let signal: AbortSignal | undefined;
        vi.stubGlobal(
            'fetch',
            vi.fn(async (_url: URL, init: RequestInit) => {
                signal = init.signal ?? undefined;
                return bodyOf([bytes(1)]);
            }),
        );
        const host = factory().createHost(manifest());
        const response = await host.fetch('https://audio.example.com/speech.mp3');

        expect(signal?.aborted).toBe(false);
        await response.body!.cancel();

        // Cancelling the stream alone would leave the request itself running
        // until the socket timed out on its own.
        expect(signal?.aborted).toBe(true);
    });
});

describe('PluginHostFactory.cancelOpenBodies', () => {
    it('lets go of everything a disposed plugin was still holding', async () => {
        const signals: AbortSignal[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (_url: URL, init: RequestInit) => {
                if (init.signal) signals.push(init.signal);
                return stallingBodyAfter(bytes(1));
            }),
        );
        const hostFactory = factory();
        const host = hostFactory.createHost(manifest());

        const first = await host.fetch('https://audio.example.com/a.mp3');
        const second = await host.fetch('https://audio.example.com/b.mp3');

        hostFactory.cancelOpenBodies(PLUGIN_ID);

        expect(signals).toHaveLength(2);
        expect(signals.every(signal => signal.aborted)).toBe(true);
        // A body cannot outlive the instance that fetched it, and the next read
        // is told why rather than being told the stream simply ended.
        await expectPluginError(readChunk(first), 'unavailable', /disposed while a response body was still open/);
        await expectPluginError(readChunk(second), 'unavailable', /disposed while a response body was still open/);
    });

    it('leaves a body that already finished alone', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => bodyOf([bytes(1)])),
        );
        const hostFactory = factory();
        const host = hostFactory.createHost(manifest());

        const response = await host.fetch('https://audio.example.com/a.mp3');
        await expect(response.text()).resolves.toHaveLength(1);

        expect(() => hostFactory.cancelOpenBodies(PLUGIN_ID)).not.toThrow();
    });

    it('is safe for a plugin that never opened one, and safe to call twice', () => {
        const hostFactory = factory();
        hostFactory.createHost(manifest());

        expect(() => hostFactory.cancelOpenBodies(PLUGIN_ID)).not.toThrow();
        expect(() => hostFactory.cancelOpenBodies(PLUGIN_ID)).not.toThrow();
        expect(() => hostFactory.cancelOpenBodies('never.existed')).not.toThrow();
    });
});
