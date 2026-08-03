import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { httpError, IsServerkitError } from '@maroonedsoftware/errors';
import type { PluginManifest } from '@deadair/plugin-sdk';

import {
    MAX_PLUGIN_FETCH_REDIRECTS,
    PLUGIN_FETCH_DEFAULTS,
    PluginFetchLimits,
    PluginHostFactory,
    PluginHostFactoryOptions,
} from '../../../src/modules/plugins/plugin.host.factory.js';
import {
    PLUGIN_STORAGE_MAX_KEYS,
    PLUGIN_STORAGE_MAX_VALUE_BYTES,
    PluginStorageRepository,
} from '../../../src/modules/plugins/plugin.storage.repository.js';
import { PluginConfigService } from '../../../src/modules/plugins/plugin.config.service.js';
import { PluginEchoTracker } from '../../../src/modules/plugins/plugin.echo.tracker.js';

const stubLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
});

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
    fetchLimits: PluginFetchLimits = {},
    storage: PluginStorageRepository = new FakeStorageRepository() as unknown as PluginStorageRepository,
    configService: PluginConfigService = unusedConfigService(),
    echoTracker: PluginEchoTracker = new PluginEchoTracker(),
) {
    return new PluginHostFactory(new PluginHostFactoryOptions('https://host.example', fetchLimits), configService, storage, echoTracker, stubLogger());
}

/**
 * `HttpError#message` is the bare status text ("Forbidden"); the useful
 * sentence lives in `details.message`. Asserts the rejection is a
 * `ServerkitError` whose `details.message` matches `pattern`.
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

        await expectDetailMessage(host.fetch('https://evil.example.com/x'), /not allowed to reach "evil\.example\.com"/);
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

    it('spaces a burst according to the rate limit policy', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockImplementation(async () => new Response('ok', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory({ requestsPerWindow: 1, windowSeconds: 1 }).createHost(
            manifest({ permissions: { network: ['api.example.com'], storage: false, oauth: false } }),
        );

        await host.fetch('https://api.example.com/first');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        let secondResolved = false;
        const second = host.fetch('https://api.example.com/second').then(() => {
            secondResolved = true;
        });

        await vi.advanceTimersByTimeAsync(500);
        expect(secondResolved).toBe(false);

        await vi.advanceTimersByTimeAsync(600);
        await second;
        expect(secondResolved).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('backs off once on a 429 with Retry-After, then retries', async () => {
        vi.useFakeTimers();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '1' } }))
            .mockResolvedValueOnce(new Response('ok', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory({ requestsPerWindow: 100, windowSeconds: 1 }).createHost(
            manifest({ permissions: { network: ['api.example.com'], storage: false, oauth: false } }),
        );

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

        await expectDetailMessage(host.fetch('https://api.example.com/x'), /not allowed to reach "169\.254\.169\.254"/);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('refuses a redirect to a non-http(s) protocol', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(redirect(302, 'file:///etc/passwd'));
        vi.stubGlobal('fetch', fetchMock);
        const host = factory().createHost(allowlisted('api.example.com'));

        await expectDetailMessage(host.fetch('https://api.example.com/x'), /non-http\(s\) URL \("file:"\)/);
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

        await expectDetailMessage(host.fetch('https://api.example.com/x'), /too many redirects/);
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
        const assertion = expectDetailMessage(call, /timed out after 1000ms/);

        await vi.advanceTimersByTimeAsync(1_100);
        await assertion;
    });

    it('does not charge redirect hops against the plugin rate limit', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(redirect(302, 'https://api.example.com/a'))
            .mockResolvedValueOnce(redirect(302, 'https://api.example.com/b'))
            .mockResolvedValueOnce(new Response('final', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        // One request per window: a chain that charged its hops would park here.
        const host = factory({ requestsPerWindow: 1, windowSeconds: 60, maxRateLimitWaitMs: 0 }).createHost(allowlisted('api.example.com'));

        const response = await host.fetch('https://api.example.com/x');

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(response.body).toBe('final');
    });
});

describe('PluginHostFactory.createHost storage', () => {
    it('namespaces storage by plugin id: two hosts, same key, no cross-talk', async () => {
        const repo = new FakeStorageRepository() as unknown as PluginStorageRepository;
        const f = factory({}, repo);
        const hostA = f.createHost(manifest({ id: 'plugin.a', permissions: { network: [], storage: true, oauth: false } }));
        const hostB = f.createHost(manifest({ id: 'plugin.b', permissions: { network: [], storage: true, oauth: false } }));

        await hostA.storage.set('shared-key', 'value-a');
        await hostB.storage.set('shared-key', 'value-b');

        await expect(hostA.storage.get('shared-key')).resolves.toBe('value-a');
        await expect(hostB.storage.get('shared-key')).resolves.toBe('value-b');
    });

    it('rejects once the plugin exceeds its key quota', async () => {
        const repo = new FakeStorageRepository() as unknown as PluginStorageRepository;
        const host = factory({}, repo).createHost(manifest({ id: 'plugin.quota', permissions: { network: [], storage: true, oauth: false } }));

        for (let i = 0; i < PLUGIN_STORAGE_MAX_KEYS; i++) {
            await host.storage.set(`key-${i}`, i);
        }

        await expectDetailMessage(host.storage.set('one-too-many', true), /storage is full/);
    });

    it('throws a permission error for storage when the manifest does not declare it', async () => {
        const host = factory().createHost(manifest({ permissions: { network: [], storage: false, oauth: false } }));

        await expectDetailMessage(host.storage.get('k'), /does not declare the "storage" permission/);
        await expectDetailMessage(host.storage.set('k', 1), /does not declare the "storage" permission/);
        await expectDetailMessage(host.storage.delete('k'), /does not declare the "storage" permission/);
        await expectDetailMessage(host.storage.list(), /does not declare the "storage" permission/);
    });
});

describe('PluginHostFactory.createHost oauth', () => {
    it('throws a permission error for oauth when the manifest does not declare it', async () => {
        const host = factory().createHost(manifest({ permissions: { network: [], storage: false, oauth: false } }));

        await expectDetailMessage(host.oauth.getRedirectUri(), /does not declare the "oauth" permission/);
        await expectDetailMessage(host.oauth.saveTokens({}), /does not declare the "oauth" permission/);
        await expectDetailMessage(host.oauth.getTokens(), /does not declare the "oauth" permission/);
    });

    it('announces the echo before saving tokens, so the write cannot notify before the expectation is registered', async () => {
        const calls: string[] = [];
        const echoTracker = {
            expectEcho: vi.fn(() => {
                calls.push('expectEcho');
            }),
            retractEcho: vi.fn(() => {
                calls.push('retractEcho');
            }),
        } as unknown as PluginEchoTracker;
        const configService = {
            saveConfig: vi.fn(async () => {
                calls.push('saveConfig');
            }),
        } as unknown as PluginConfigService;
        const host = factory({}, undefined, configService, echoTracker).createHost(
            manifest({ permissions: { network: [], storage: false, oauth: true } }),
        );

        await host.oauth.saveTokens({ access_token: 'abc' });

        expect(calls).toEqual(['expectEcho', 'saveConfig']);
        expect(echoTracker.retractEcho).not.toHaveBeenCalled();
    });

    it('retracts the announced echo and propagates the error when saveConfig rejects', async () => {
        const echoTracker = {
            expectEcho: vi.fn(),
            retractEcho: vi.fn(),
        } as unknown as PluginEchoTracker;
        const failure = new Error('database is down');
        const configService = {
            saveConfig: vi.fn().mockRejectedValue(failure),
        } as unknown as PluginConfigService;
        const host = factory({}, undefined, configService, echoTracker).createHost(
            manifest({ permissions: { network: [], storage: false, oauth: true } }),
        );

        await expect(host.oauth.saveTokens({ access_token: 'abc' })).rejects.toThrow('database is down');

        expect(echoTracker.expectEcho).toHaveBeenCalledExactlyOnceWith('test.plugin');
        expect(echoTracker.retractEcho).toHaveBeenCalledExactlyOnceWith('test.plugin');
    });
});

// Sanity check that the defaults referenced by these tests match the source, per the package note.
describe('PLUGIN_FETCH_DEFAULTS', () => {
    it('defaults the fetch timeout to 10s', () => {
        expect(PLUGIN_FETCH_DEFAULTS.timeoutMs).toBe(10_000);
    });
});
