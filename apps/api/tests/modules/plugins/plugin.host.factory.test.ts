import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpError, IsServerkitError } from '@maroonedsoftware/errors';
import { ErrorCodes } from '@deadair/error-codes';
import { isPluginError, toPluginError, type PluginError, type PluginErrorCode, type PluginManifest } from '@deadair/plugin-sdk';

import { pluginHttpError } from '../../../src/modules/plugins/plugin.error.http.js';

import {
    MAX_PLUGIN_FETCH_REDIRECTS,
    PLUGIN_FETCH_MAX_BODY_BYTES,
    PLUGIN_FETCH_REQUESTS_PER_WINDOW,
    PLUGIN_FETCH_TIMEOUT_MS,
    PluginHostFactory,
    PluginHostFactoryOptions,
} from '../../../src/modules/plugins/plugin.host.factory.js';
import { PLUGIN_INVOKE_TIMEOUT_MS } from '../../../src/modules/plugins/plugin.invoker.js';
import {
    PLUGIN_STORAGE_MAX_KEYS,
    PLUGIN_STORAGE_MAX_VALUE_BYTES,
    PluginStorageRepository,
} from '../../../src/modules/plugins/plugin.storage.repository.js';
import { PluginConfigService } from '../../../src/modules/plugins/plugin.config.service.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id: 'test.plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        kind: 'music-provider',
        capabilities: ['catalog'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
        ...overrides,
    };
}

/**
 * Faithful in-memory stand-in for {@link PluginStorageRepository}: same
 * namespacing-by-pluginId and quota behaviour, backed by a Map instead of
 * Postgres. The factory only ever delegates to the repository's public
 * surface, so this is safe to swap in whole.
 */
class FakeStorageRepository {
    private readonly data = new Map<string, Map<string, unknown>>();

    private bucket(pluginId: string): Map<string, unknown> {
        let bucket = this.data.get(pluginId);
        if (!bucket) {
            bucket = new Map();
            this.data.set(pluginId, bucket);
        }
        return bucket;
    }

    async get(pluginId: string, key: string): Promise<unknown> {
        return this.bucket(pluginId).get(key);
    }

    async set(pluginId: string, key: string, value: unknown): Promise<void> {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) {
            throw httpError(422).withDetails({ message: `plugin storage value for key "${key}" is not JSON-serializable` });
        }
        const size = Buffer.byteLength(serialized, 'utf8');
        if (size > PLUGIN_STORAGE_MAX_VALUE_BYTES) {
            throw httpError(413).withDetails({ message: `plugin storage value for key "${key}" is ${size} bytes, over the limit` });
        }
        const bucket = this.bucket(pluginId);
        if (!bucket.has(key) && bucket.size >= PLUGIN_STORAGE_MAX_KEYS) {
            throw httpError(507).withDetails({ message: `plugin storage is full: at most ${PLUGIN_STORAGE_MAX_KEYS} keys per plugin` });
        }
        bucket.set(key, value);
    }

    async delete(pluginId: string, key: string): Promise<void> {
        this.bucket(pluginId).delete(key);
    }

    async listKeys(pluginId: string, prefix?: string): Promise<string[]> {
        return [...this.bucket(pluginId).keys()].filter(key => !prefix || key.startsWith(prefix)).sort();
    }
}

/** Not exercised by any test here: guards short-circuit before touching config. */
const unusedConfigService = (): PluginConfigService =>
    ({
        getSecrets: vi.fn(() => {
            throw new Error('unexpected call');
        }),
        getConfig: vi.fn(() => {
            throw new Error('unexpected call');
        }),
        saveConfig: vi.fn(() => {
            throw new Error('unexpected call');
        }),
    }) as unknown as PluginConfigService;

function factory(
    storage: PluginStorageRepository = new FakeStorageRepository() as unknown as PluginStorageRepository,
    configService: PluginConfigService = unusedConfigService(),
) {
    return new PluginHostFactory(new PluginHostFactoryOptions('https://host.example'), configService, storage, stubPluginLog().log);
}

/** The rejection, or a failure if there wasn't one. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
        value => {
            throw new Error(`expected a rejection, got ${JSON.stringify(value)}`);
        },
        (thrown: unknown) => thrown,
    );
}

/**
 * Asserts the rejection is a `PluginError` classified `code` and saying
 * something matching `pattern`.
 *
 * The code is asserted, not just the sentence: it is what `plugin.error.http.ts`
 * turns into the status and error code a client sees, so a test that only
 * matched the message would happily pass while every one of these answered 500.
 *
 * Returns the error, for the cases that carry more than a classification.
 */
async function expectPluginError(promise: Promise<unknown>, code: PluginErrorCode, pattern: RegExp): Promise<PluginError> {
    const error = await rejection(promise);

    expect(isPluginError(error), `expected a PluginError, got ${String(error)}`).toBe(true);
    expect((error as PluginError).code).toBe(code);
    expect((error as PluginError).message).toMatch(pattern);

    return error as PluginError;
}

/**
 * `HttpError#message` is the bare status text ("Forbidden"); the useful
 * sentence lives in `details.message`. Asserts the rejection is a
 * `ServerkitError` whose `details.message` matches `pattern`.
 *
 * Only for failures the host passes through from a repository rather than
 * raising itself. Everything the factory throws is a `PluginError`; see
 * {@link expectPluginError}.
 */
async function expectDetailMessage(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
    await expect(promise).rejects.toSatisfy(error => {
        if (!IsServerkitError(error)) return false;
        const message = error.details?.message;
        return typeof message === 'string' && pattern.test(message);
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('PluginHostFactory.createHost fetch', () => {
    it('rejects a fetch to a hostname not in permissions.network without ever calling the network stub', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(manifest({ permissions: { network: ['api.example.com'], storage: false, oauth: false } }));

        await expectPluginError(host.fetch('https://evil.example.com/x'), 'forbidden', /not allowed to reach "evil\.example\.com"/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('passes an allowlisted host through to the network stub and maps the response', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(manifest({ permissions: { network: ['api.example.com'], storage: false, oauth: false } }));

        const response = await host.fetch('https://api.example.com/x');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(response).toMatchObject({ status: 200, body: 'hello', ok: true });
        expect(response.headers['content-type']).toBe('text/plain');
    });

    it('spaces a burst that exceeds the per-window quota instead of failing it', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockImplementation(async () => new Response('ok', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(manifest({ permissions: { network: ['api.example.com'], storage: false, oauth: false } }));

        // Exactly the quota, all of which should pass straight through.
        for (let i = 0; i < PLUGIN_FETCH_REQUESTS_PER_WINDOW; i++) {
            await host.fetch(`https://api.example.com/${i}`);
        }
        expect(fetchMock).toHaveBeenCalledTimes(PLUGIN_FETCH_REQUESTS_PER_WINDOW);

        let parkedResolved = false;
        const parked = host.fetch('https://api.example.com/over').then(() => {
            parkedResolved = true;
        });

        await vi.advanceTimersByTimeAsync(500);
        expect(parkedResolved).toBe(false);

        await vi.advanceTimersByTimeAsync(600);
        await parked;
        expect(parkedResolved).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(PLUGIN_FETCH_REQUESTS_PER_WINDOW + 1);
    });

    it('rejects rather than parks when the wait would outlast the call budget', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockImplementation(async () => new Response('ok', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(manifest({ permissions: { network: ['api.example.com'], storage: false, oauth: false } }));

        for (let i = 0; i < PLUGIN_FETCH_REQUESTS_PER_WINDOW; i++) {
            await host.fetch(`https://api.example.com/${i}`);
        }

        // 50ms of budget against a window that has most of a second left to run.
        const error = await expectPluginError(
            host.fetch('https://api.example.com/over', { timeoutMs: 50 }),
            'rate_limited',
            /over its fetch rate limit/,
        );

        // The limiter knew the wait, so the refusal carries it and
        // `pluginHttpError` can answer with a real `Retry-After`.
        expect(error.retryAfterMs).toBeGreaterThan(0);
        expect(error.retryable).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(PLUGIN_FETCH_REQUESTS_PER_WINDOW);
    });

    it('backs off once on a 429 with Retry-After, then retries', async () => {
        vi.useFakeTimers();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '1' } }))
            .mockResolvedValueOnce(new Response('ok', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(manifest({ permissions: { network: ['api.example.com'], storage: false, oauth: false } }));

        const call = host.fetch('https://api.example.com/x');
        let settled: Awaited<ReturnType<typeof host.fetch>> | undefined;
        void call.then(response => {
            settled = response;
        });

        await vi.advanceTimersByTimeAsync(500);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(settled).toBeUndefined();

        await vi.advanceTimersByTimeAsync(600);
        const response = await call;
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(response.status).toBe(200);
    });
});

describe('PluginHostFactory.createHost fetch redirects', () => {
    /** A redirect response as undici hands one back under `redirect: 'manual'`. */
    const redirect = (status: number, location: string): Response => new Response('', { status, headers: { location } });

    /** `[url, init]` of the nth call to the fetch stub, with the URL as a string. */
    const callArgs = (mock: ReturnType<typeof vi.fn>, index: number): { url: string; init: RequestInit } => {
        const [url, init] = mock.mock.calls[index] as [URL | string, RequestInit];
        return { url: String(url), init };
    };

    const headerOf = (init: RequestInit, name: string): string | undefined => {
        const headers = (init.headers ?? {}) as Record<string, string>;
        const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
        return found?.[1];
    };

    const allowlisted = (...network: string[]): PluginManifest => manifest({ permissions: { network, storage: false, oauth: false } });

    it('refuses a redirect to a non-allowlisted host without ever requesting it', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(redirect(302, 'http://169.254.169.254/latest/meta-data/'));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com'));

        await expectPluginError(host.fetch('https://api.example.com/x'), 'upstream', /not allowed to reach "169\.254\.169\.254"/);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('refuses a redirect to a non-http(s) protocol', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(redirect(302, 'file:///etc/passwd'));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com'));

        await expectPluginError(host.fetch('https://api.example.com/x'), 'upstream', /non-http\(s\) URL \("file:"\)/);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('never lets undici follow a redirect on its own', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('hello', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com'));

        await host.fetch('https://api.example.com/x');

        expect(callArgs(fetchMock, 0).init.redirect).toBe('manual');
    });

    it('follows a redirect to an allowlisted host and returns the final response', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(redirect(302, 'https://cdn.example.com/asset'))
            .mockResolvedValueOnce(new Response('final', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com', 'cdn.example.com'));

        const response = await host.fetch('https://api.example.com/x');

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(callArgs(fetchMock, 1).url).toBe('https://cdn.example.com/asset');
        expect(response).toMatchObject({ status: 200, body: 'final', ok: true });
    });

    it('resolves a relative location against the URL that issued it', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(redirect(302, '/moved/here'))
            .mockResolvedValueOnce(new Response('final', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com'));

        await host.fetch('https://api.example.com/deep/path');

        expect(callArgs(fetchMock, 1).url).toBe('https://api.example.com/moved/here');
    });

    it('returns a 3xx without a location header as-is rather than following it', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(new Response('gone sideways', { status: 302 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com'));

        const response = await host.fetch('https://api.example.com/x');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(response.status).toBe(302);
    });

    it('gives up with a 502 once the chain runs past the hop cap', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => redirect(302, 'https://api.example.com/next'));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com'));

        await expectPluginError(host.fetch('https://api.example.com/x'), 'upstream', /too many redirects/);
        expect(fetchMock).toHaveBeenCalledTimes(MAX_PLUGIN_FETCH_REDIRECTS + 1);
    });

    it('drops credential headers when a hop crosses an origin', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(redirect(302, 'https://cdn.example.com/asset'))
            .mockResolvedValueOnce(new Response('final', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com', 'cdn.example.com'));

        await host.fetch('https://api.example.com/x', {
            headers: { Authorization: 'Bearer spotify-token', cookie: 'session=1', 'x-trace': 'keep-me' },
        });

        const second = callArgs(fetchMock, 1).init;
        expect(headerOf(second, 'authorization')).toBeUndefined();
        expect(headerOf(second, 'cookie')).toBeUndefined();
        expect(headerOf(second, 'x-trace')).toBe('keep-me');
    });

    it('keeps credential headers on a same-origin hop', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(redirect(302, 'https://api.example.com/y'))
            .mockResolvedValueOnce(new Response('final', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com'));

        await host.fetch('https://api.example.com/x', { headers: { authorization: 'Bearer spotify-token' } });

        expect(headerOf(callArgs(fetchMock, 1).init, 'authorization')).toBe('Bearer spotify-token');
    });

    it('preserves method and body across a 307', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(redirect(307, 'https://api.example.com/y'))
            .mockResolvedValueOnce(new Response('final', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com'));

        await host.fetch('https://api.example.com/x', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } });

        const second = callArgs(fetchMock, 1).init;
        expect(second.method).toBe('POST');
        expect(second.body).toBe('{"a":1}');
        expect(headerOf(second, 'content-type')).toBe('application/json');
    });

    it('rewrites a 303 to a GET with no body', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(redirect(303, 'https://api.example.com/result'))
            .mockResolvedValueOnce(new Response('final', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com'));

        await host.fetch('https://api.example.com/x', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } });

        const second = callArgs(fetchMock, 1).init;
        expect(second.method).toBe('GET');
        expect(second.body).toBeUndefined();
        expect(headerOf(second, 'content-type')).toBeUndefined();
    });

    it('rewrites a 302 after a POST to a GET with no body', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(redirect(302, 'https://api.example.com/y'))
            .mockResolvedValueOnce(new Response('final', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com'));

        await host.fetch('https://api.example.com/x', { method: 'POST', body: '{"a":1}' });

        const second = callArgs(fetchMock, 1).init;
        expect(second.method).toBe('GET');
        expect(second.body).toBeUndefined();
    });

    it('runs the whole chain under the one original deadline', async () => {
        vi.useFakeTimers();
        const fetchMock = vi
            .fn()
            .mockImplementationOnce(async () => redirect(302, 'https://api.example.com/slow'))
            .mockImplementationOnce(
                async (_url: URL, init: RequestInit) =>
                    new Promise<Response>((_resolve, reject) => {
                        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                    }),
            );
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com'));

        const call = host.fetch('https://api.example.com/x', { timeoutMs: 1_000 });
        const assertion = expectPluginError(call, 'timeout', /timed out after 1000ms/);

        await vi.advanceTimersByTimeAsync(1_100);
        await assertion;
    });

    it('does not charge redirect hops against the plugin rate limit', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockImplementation(async () => new Response('ok', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com'));

        // Spend all but one of the window's points, so the chain below has
        // exactly one to its name.
        for (let i = 0; i < PLUGIN_FETCH_REQUESTS_PER_WINDOW - 1; i++) {
            await host.fetch(`https://api.example.com/${i}`);
        }

        fetchMock
            .mockResolvedValueOnce(redirect(302, 'https://api.example.com/a'))
            .mockResolvedValueOnce(redirect(302, 'https://api.example.com/b'))
            .mockResolvedValueOnce(new Response('final', { status: 200 }));

        // No timer is advanced: a chain that charged its hops would run out of
        // points on the second one and park here forever.
        const response = await host.fetch('https://api.example.com/x');

        expect(response.body).toBe('final');
        expect(fetchMock).toHaveBeenCalledTimes(PLUGIN_FETCH_REQUESTS_PER_WINDOW + 2);
    });

    it('reports the final hop as the response url, and flags that it redirected', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(redirect(302, 'https://cdn.example.com/asset'))
            .mockResolvedValueOnce(new Response('final', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com', 'cdn.example.com'));

        const response = await host.fetch('https://api.example.com/x');

        expect(response.url).toBe('https://cdn.example.com/asset');
        expect(response.redirected).toBe(true);
    });

    it('reports the requested url and no redirect when the chain was one hop', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('hello', { status: 200 })));
        const host = factory().createHost(allowlisted('api.example.com'));

        const response = await host.fetch('https://api.example.com/x?q=1');

        expect(response.url).toBe('https://api.example.com/x?q=1');
        expect(response.redirected).toBe(false);
    });
});

describe('PluginHostFactory.createHost fetch response shape', () => {
    const allowlisted = (...network: string[]): PluginManifest => manifest({ permissions: { network, storage: false, oauth: false } });

    it('hands back every set-cookie separately instead of the last one winning', async () => {
        const headers = new Headers({ 'content-type': 'text/plain' });
        headers.append('set-cookie', 'session=abc; Path=/; HttpOnly');
        headers.append('set-cookie', 'csrf=def; Path=/');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200, headers })));
        const host = factory().createHost(allowlisted('api.example.com'));

        const response = await host.fetch('https://api.example.com/login');

        expect(response.setCookie).toEqual(['session=abc; Path=/; HttpOnly', 'csrf=def; Path=/']);
        // Kept out of `headers` on purpose: a Record can only hold one, and a
        // half-truth there is worse than an absence.
        expect(response.headers['set-cookie']).toBeUndefined();
        expect(response.headers['content-type']).toBe('text/plain');
    });

    it('is an empty array, not a missing field, when the server set no cookies', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
        const host = factory().createHost(allowlisted('api.example.com'));

        await expect(host.fetch('https://api.example.com/x')).resolves.toMatchObject({ setCookie: [] });
    });

    it('joins a repeated non-cookie header rather than dropping one', async () => {
        const headers = new Headers();
        headers.append('warning', '199 - "first"');
        headers.append('warning', '199 - "second"');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200, headers })));
        const host = factory().createHost(allowlisted('api.example.com'));

        const response = await host.fetch('https://api.example.com/x');

        expect(response.headers.warning).toBe('199 - "first", 199 - "second"');
    });

    it('passes the status text through', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404, statusText: 'Not Found' })));
        const host = factory().createHost(allowlisted('api.example.com'));

        await expect(host.fetch('https://api.example.com/x')).resolves.toMatchObject({ status: 404, statusText: 'Not Found', ok: false });
    });
});

describe('PluginHostFactory.createHost fetch body limit', () => {
    const allowlisted = (...network: string[]): PluginManifest => manifest({ permissions: { network, storage: false, oauth: false } });

    /** A chunked body with no `content-length`: the shape only the running count can catch. */
    const streamOf = (chunks: string[]): Response =>
        new Response(
            new ReadableStream<Uint8Array>({
                start(controller) {
                    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
                    controller.close();
                },
            }),
        );

    /** A chunk list that lands `over` bytes past the cap, without building one giant string. */
    const chunksOverCap = (over: number): string[] => {
        const chunk = 'x'.repeat(1024 * 1024);
        const whole = Math.floor(PLUGIN_FETCH_MAX_BODY_BYTES / chunk.length);
        const remainder = PLUGIN_FETCH_MAX_BODY_BYTES - whole * chunk.length + over;
        return [...Array<string>(whole).fill(chunk), 'x'.repeat(remainder)];
    };

    it('refuses an oversized body on content-length alone, and tears the stream down instead of draining it', async () => {
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                controller.enqueue(new TextEncoder().encode('x'));
            },
            cancel() {
                cancelled = true;
            },
        });
        // The declared length is a lie the counter could never catch: the real
        // body is one byte at a time, so the declared size in the message can
        // only have come from the header.
        const declared = PLUGIN_FETCH_MAX_BODY_BYTES + 1;
        const response = new Response(body, { status: 200, headers: { 'content-length': String(declared) } });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
        const host = factory().createHost(allowlisted('api.example.com'));

        await expectPluginError(
            host.fetch('https://api.example.com/big'),
            'upstream',
            new RegExp(`response body is ${declared} bytes, over the ${PLUGIN_FETCH_MAX_BODY_BYTES} byte limit`),
        );
        expect(cancelled).toBe(true);
    });

    it('refuses a body that only reveals its size as it streams, and calls it a failure rather than a timeout', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamOf(chunksOverCap(20))));
        const host = factory().createHost(allowlisted('api.example.com'));

        await expectPluginError(
            host.fetch('https://api.example.com/chunked'),
            'upstream',
            new RegExp(`failed: response body is ${PLUGIN_FETCH_MAX_BODY_BYTES + 20} bytes, over the ${PLUGIN_FETCH_MAX_BODY_BYTES} byte limit`),
        );
    });

    it('lets a body exactly at the limit through', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamOf(chunksOverCap(0))));
        const host = factory().createHost(allowlisted('api.example.com'));

        const response = await host.fetch('https://api.example.com/exact');

        expect(response.body).toHaveLength(PLUGIN_FETCH_MAX_BODY_BYTES);
    });

    it('measures bytes, not characters, so multi-byte text cannot slip past the cap', async () => {
        // Three bytes per character in UTF-8, so this is one character (three
        // bytes) past the cap while being a third of its length in characters.
        const characters = Math.floor(PLUGIN_FETCH_MAX_BODY_BYTES / 3) + 1;
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamOf(['あ'.repeat(characters)])));
        const host = factory().createHost(allowlisted('api.example.com'));

        await expectPluginError(host.fetch('https://api.example.com/utf8'), 'upstream', new RegExp(`response body is ${characters * 3} bytes`));
    });

    it('decodes a multi-byte character split across two chunks', async () => {
        const encoded = new TextEncoder().encode('あ');
        const split = new Response(
            new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoded.slice(0, 1));
                    controller.enqueue(encoded.slice(1));
                    controller.close();
                },
            }),
        );
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(split));
        const host = factory().createHost(allowlisted('api.example.com'));

        await expect(host.fetch('https://api.example.com/utf8')).resolves.toMatchObject({ body: 'あ' });
    });

    it('handles a bodyless response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
        const host = factory().createHost(allowlisted('api.example.com'));

        await expect(host.fetch('https://api.example.com/x')).resolves.toMatchObject({ status: 204, body: '' });
    });

    it('caps rather than allowing unlimited', () => {
        expect(PLUGIN_FETCH_MAX_BODY_BYTES).toBeGreaterThan(0);
    });
});

/**
 * The budget knobs used to be independent of the invoker's deadline, which
 * meant a limit could be written down that no call could ever reach. These
 * pin the two together.
 */
describe('PluginHostFactory fetch budget', () => {
    const allowlisted = (...network: string[]): PluginManifest => manifest({ permissions: { network, storage: false, oauth: false } });

    it('never gives a fetch a default budget the invoker would not honour', () => {
        expect(PLUGIN_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(PLUGIN_INVOKE_TIMEOUT_MS);
    });

    it('clamps a plugin asking for longer than the invoke deadline down to it', async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async (_url: URL, init: RequestInit) =>
                    new Promise<Response>((_resolve, reject) => {
                        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                    }),
            ),
        );
        const host = factory().createHost(allowlisted('api.example.com'));

        const call = host.fetch('https://api.example.com/slow', { timeoutMs: 120_000 });
        const assertion = expectPluginError(call, 'timeout', new RegExp(`timed out after ${PLUGIN_INVOKE_TIMEOUT_MS}ms`));

        await vi.advanceTimersByTimeAsync(PLUGIN_INVOKE_TIMEOUT_MS + 100);
        await assertion;
    });

    it('skips a Retry-After back-off that would outlast the budget, handing the 429 back instead', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue(new Response('slow down', { status: 429, headers: { 'retry-after': '60' } }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com'));

        const response = await host.fetch('https://api.example.com/x');

        // One call, not two: sleeping 60s only to be abandoned at the deadline
        // helps nobody, and the plugin can read `retry-after` itself.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(response.status).toBe(429);
    });
});

/**
 * The host used to raise `httpError` here, which is not a `PluginError`, so
 * `toPluginError` (the adoption step every call into plugin code goes through
 * in `PluginInvoker`) classified all of it `internal` and `pluginHttpError`
 * answered 500 no matter what the host had decided. These assert the whole
 * chain, because each half was already correct on its own while the join was
 * not: an unreachable upstream answered 500 `PLUGIN_FAILED` in production.
 */
describe('PluginHostFactory fetch failures, as the client sees them', () => {
    const allowlisted = (...network: string[]): PluginManifest => manifest({ permissions: { network, storage: false, oauth: false } });

    /** What `PluginInvoker` does to anything a plugin call throws, then the route's mapping. */
    const asResponse = (error: unknown) => pluginHttpError('test.plugin', toPluginError(error));

    it('answers 502 PLUGIN_UPSTREAM_FAILED when the upstream cannot be reached', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.example.com')));
        const host = factory().createHost(allowlisted('api.example.com'));

        const error = await rejection(host.fetch('https://api.example.com/x'));
        const failure = asResponse(error);

        expect(failure.statusCode).toBe(502);
        expect(failure.details).toMatchObject({ code: ErrorCodes.PLUGIN_UPSTREAM_FAILED, plugin: 'test.plugin' });
    });

    it('answers 504 PLUGIN_TIMED_OUT when the host abandoned the call on its deadline', async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async (_url: URL, init: RequestInit) =>
                    new Promise<Response>((_resolve, reject) => {
                        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                    }),
            ),
        );
        const host = factory().createHost(allowlisted('api.example.com'));

        const call = rejection(host.fetch('https://api.example.com/slow', { timeoutMs: 1_000 }));
        await vi.advanceTimersByTimeAsync(1_100);
        const failure = asResponse(await call);

        expect(failure.statusCode).toBe(504);
        expect(failure.details).toMatchObject({ code: ErrorCodes.PLUGIN_TIMED_OUT });
    });

    it('answers 429 with a Retry-After the limiter supplied', async () => {
        vi.useFakeTimers();
        // A fresh Response per call: one instance would have its body stream
        // consumed by the first read and locked for every read after it.
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(async () => new Response('ok', { status: 200 })),
        );
        const host = factory().createHost(allowlisted('api.example.com'));

        for (let i = 0; i < PLUGIN_FETCH_REQUESTS_PER_WINDOW; i++) {
            await host.fetch(`https://api.example.com/${i}`);
        }

        const failure = asResponse(await rejection(host.fetch('https://api.example.com/over', { timeoutMs: 50 })));

        expect(failure.statusCode).toBe(429);
        expect(failure.details).toMatchObject({ code: ErrorCodes.PLUGIN_RATE_LIMITED });
        expect(failure.headers).toMatchObject({ 'Retry-After': expect.any(String) });
    });

    it('answers 502 PLUGIN_FORBIDDEN for a hostname the manifest never declared', async () => {
        vi.stubGlobal('fetch', vi.fn());
        const host = factory().createHost(allowlisted('api.example.com'));

        const failure = asResponse(await rejection(host.fetch('https://evil.example.com/x')));

        expect(failure.statusCode).toBe(502);
        expect(failure.details).toMatchObject({ code: ErrorCodes.PLUGIN_FORBIDDEN, retryable: false });
    });

    it('answers 422 PLUGIN_MISCONFIGURED for a URL the plugin could not have built from good settings', async () => {
        vi.stubGlobal('fetch', vi.fn());
        const host = factory().createHost(allowlisted('api.example.com'));

        const failure = asResponse(await rejection(host.fetch('not-a-url')));

        expect(failure.statusCode).toBe(422);
        expect(failure.details).toMatchObject({ code: ErrorCodes.PLUGIN_MISCONFIGURED });
    });
});

describe('PluginHostFactory.createHost storage', () => {
    it('namespaces storage by plugin id: two hosts, same key, no cross-talk', async () => {
        const repo = new FakeStorageRepository() as unknown as PluginStorageRepository;
        const f = factory(repo);
        const hostA = f.createHost(manifest({ id: 'plugin.a', permissions: { network: [], storage: true, oauth: false } }));
        const hostB = f.createHost(manifest({ id: 'plugin.b', permissions: { network: [], storage: true, oauth: false } }));

        await hostA.storage.set('shared-key', 'value-a');
        await hostB.storage.set('shared-key', 'value-b');

        await expect(hostA.storage.get('shared-key')).resolves.toBe('value-a');
        await expect(hostB.storage.get('shared-key')).resolves.toBe('value-b');
    });

    it('rejects once the plugin exceeds its key quota', async () => {
        const repo = new FakeStorageRepository() as unknown as PluginStorageRepository;
        const host = factory(repo).createHost(manifest({ id: 'plugin.quota', permissions: { network: [], storage: true, oauth: false } }));

        for (let i = 0; i < PLUGIN_STORAGE_MAX_KEYS; i++) {
            await host.storage.set(`key-${i}`, i);
        }

        await expectDetailMessage(host.storage.set('one-too-many', true), /storage is full/);
    });

    it('throws a permission error for storage when the manifest does not declare it', async () => {
        const host = factory().createHost(manifest({ permissions: { network: [], storage: false, oauth: false } }));

        await expectPluginError(host.storage.get('k'), 'internal', /does not declare the "storage" permission/);
        await expectPluginError(host.storage.set('k', 1), 'internal', /does not declare the "storage" permission/);
        await expectPluginError(host.storage.delete('k'), 'internal', /does not declare the "storage" permission/);
        await expectPluginError(host.storage.list(), 'internal', /does not declare the "storage" permission/);
    });
});

describe('PluginHostFactory.createHost oauth', () => {
    it('throws a permission error for oauth when the manifest does not declare it', async () => {
        const host = factory().createHost(manifest({ permissions: { network: [], storage: false, oauth: false } }));

        await expectPluginError(host.oauth.getRedirectUri(), 'internal', /does not declare the "oauth" permission/);
        await expectPluginError(host.oauth.saveTokens({}), 'internal', /does not declare the "oauth" permission/);
        await expectPluginError(host.oauth.getTokens(), 'internal', /does not declare the "oauth" permission/);
    });

    it('persists the tokens through saveConfig, carrying the manifest fields so stored settings survive a refresh', async () => {
        const saveConfig = vi.fn(async () => {});
        const configService = { saveConfig } as unknown as PluginConfigService;
        const host = factory(undefined, configService).createHost(manifest({ permissions: { network: [], storage: false, oauth: true } }));

        await host.oauth.saveTokens({ access_token: 'abc' });

        expect(saveConfig).toHaveBeenCalledTimes(1);
        expect(saveConfig.mock.calls[0]?.[0]).toBe('test.plugin');
    });

    it('propagates the error when saveConfig rejects', async () => {
        const failure = new Error('database is down');
        const configService = {
            saveConfig: vi.fn().mockRejectedValue(failure),
        } as unknown as PluginConfigService;
        const host = factory(undefined, configService).createHost(manifest({ permissions: { network: [], storage: false, oauth: true } }));

        await expect(host.oauth.saveTokens({ access_token: 'abc' })).rejects.toThrow('database is down');
    });
});

// Sanity check that the constant referenced by these tests matches the source, per the package note.
describe('PLUGIN_FETCH_TIMEOUT_MS', () => {
    it('defaults the fetch budget to 10s', () => {
        expect(PLUGIN_FETCH_TIMEOUT_MS).toBe(10_000);
    });
});
