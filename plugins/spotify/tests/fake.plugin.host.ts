import { vi } from 'vitest';

import type { HostFetchInit, HostFetchMethod, PluginHost, ProviderStream } from '@deadair/plugin-sdk';

/** One `host.fetch` call, recorded with only the fields tests care about. */
export interface RecordedFetchCall {
    url: string;
    method: HostFetchMethod | undefined;
    headers: Record<string, string> | undefined;
    body: string | undefined;
}

/**
 * A `PluginHost` for tests. `fetch` replays a queue of scripted
 * `Response`s (FIFO, one per call) — or a custom handler installed
 * with `setFetchImpl`, for call-count-driven scenarios like a 401-then-200
 * retry — and records every call it received in `calls`. `storage`, `config`,
 * `secrets` and the `oauth` vault are in-memory and can be seeded or read
 * directly, bypassing the `PluginHost` methods, so a test can assert on state
 * without going through the code under test twice.
 */
export interface FakePluginHost extends PluginHost {
    /** Every `host.fetch` call so far, in call order. */
    readonly calls: RecordedFetchCall[];
    /** Set what `host.remainingMs()` reports, for testing budget shedding. */
    seedRemainingMs(ms: number): void;
    /** Push one scripted response onto the back of the reply queue. */
    queueResponse(response: FakeResponseInit): void;
    /** Replace the fetch handler outright; overrides the queue while set. */
    setFetchImpl(impl: (url: string, init?: HostFetchInit) => Promise<Response>): void;
    /** Seed the value `host.config.get()` resolves to. */
    seedConfig(config: Record<string, unknown>): void;
    /** Seed a value `host.secrets.get(key)` resolves to. */
    seedSecret(key: string, value: string): void;
    /** Seed a storage entry directly, bypassing `host.storage.set`. */
    seedStorage(key: string, value: unknown): void;
    /** Read a storage entry directly, bypassing `host.storage.get`. */
    getStorageEntry(key: string): unknown;
    /** All storage keys currently set, unfiltered. */
    storageKeys(): string[];
    /** Seed the oauth vault directly, bypassing `host.oauth.saveTokens`. */
    seedTokens(tokens: Record<string, string>): void;
    /** Read the oauth vault directly, bypassing `host.oauth.getTokens`. */
    getVaultTokens(): Record<string, string> | undefined;
    /** Set what `host.trackFetcher.serve()` answers with; `undefined` means "this station has no fetcher". */
    seedFetchedTrack(stream: ProviderStream | undefined): void;
}

/**
 * What `host.remainingMs()` reports unless a test says otherwise. Matches the
 * host's default per-call deadline, so a plugin that only sheds work when the
 * budget is tight behaves in tests the way it does on a healthy station.
 */
const DEFAULT_REMAINING_MS = 15_000;

/**
 * What a test says a scripted reply should be.
 *
 * Not `ResponseInit`, because `url` is not on it: `host.fetch` reports the last
 * hop of the redirect chain there, and a `Response` built by hand has an empty
 * one unless it is defined in.
 */
export interface FakeResponseInit {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    /** Text for a JSON or error reply, bytes for a binary one. */
    body?: string | Uint8Array;
    url?: string;
}

/** Statuses whose `Response` must carry a null body, or the constructor throws. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** Builds a default 200 `Response`, overridable field by field. */
export function fakeHostFetchResponse(init: FakeResponseInit = {}): Response {
    const status = init.status ?? 200;

    const response = new Response(NULL_BODY_STATUSES.has(status) ? null : (init.body ?? ''), {
        status,
        statusText: init.statusText ?? 'OK',
        headers: init.headers ?? { 'content-type': 'application/json' },
    });

    // Read-only on a constructed response, and part of what the host promises.
    Object.defineProperty(response, 'url', { value: init.url ?? 'https://example.test/' });

    return response;
}

export function createFakePluginHost(): FakePluginHost {
    const calls: RecordedFetchCall[] = [];
    const queue: Response[] = [];
    let customImpl: ((url: string, init?: HostFetchInit) => Promise<Response>) | undefined;

    const storageData = new Map<string, unknown>();
    let configData: Record<string, unknown> = {};
    const secretsData = new Map<string, string>();
    let tokens: Record<string, string> | undefined;
    let remainingMs = DEFAULT_REMAINING_MS;
    let fetchedTrack: ProviderStream | undefined = { url: 'http://127.0.0.1:3679/track/song-1?t=signed', expiresAt: 1_893_456_000_000 };

    const fetchImpl = vi.fn(async (url: string, init?: HostFetchInit): Promise<Response> => {
        calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
        if (customImpl) return customImpl(url, init);
        const next = queue.shift();
        if (!next) throw new Error(`fake plugin host: no response queued for ${init?.method ?? 'GET'} ${url}`);
        return next;
    });

    const host: FakePluginHost = {
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        fetch: fetchImpl,
        // Never aborts: these tests are about what a plugin does with a reply,
        // not about being cancelled half way through one.
        signal: new AbortController().signal,
        remainingMs: vi.fn(() => remainingMs),
        storage: {
            get: vi.fn(async (key: string) => storageData.get(key)),
            set: vi.fn(async (key: string, value: unknown) => {
                storageData.set(key, value);
            }),
            delete: vi.fn(async (key: string) => {
                storageData.delete(key);
            }),
            list: vi.fn(async (prefix?: string) => [...storageData.keys()].filter(key => !prefix || key.startsWith(prefix))),
        },
        secrets: { get: vi.fn(async (key: string) => secretsData.get(key)) },
        config: { get: vi.fn(async () => configData) },
        oauth: {
            getRedirectUri: vi.fn(async () => 'https://example.test/callback'),
            saveTokens: vi.fn(async (next: Record<string, string>) => {
                tokens = next;
            }),
            getTokens: vi.fn(async () => tokens),
        },
        events: { emit: vi.fn() },
        trackFetcher: { serve: vi.fn(async () => fetchedTrack) },
        calls,
        seedRemainingMs(ms) {
            remainingMs = ms;
        },
        queueResponse(response: FakeResponseInit) {
            queue.push(fakeHostFetchResponse(response));
        },
        setFetchImpl(impl) {
            customImpl = impl;
        },
        seedConfig(config) {
            configData = config;
        },
        seedSecret(key, value) {
            secretsData.set(key, value);
        },
        seedStorage(key, value) {
            storageData.set(key, value);
        },
        getStorageEntry(key) {
            return storageData.get(key);
        },
        storageKeys() {
            return [...storageData.keys()];
        },
        seedTokens(next) {
            tokens = next;
        },
        getVaultTokens() {
            return tokens;
        },
        seedFetchedTrack(stream) {
            fetchedTrack = stream;
        },
    };

    return host;
}
