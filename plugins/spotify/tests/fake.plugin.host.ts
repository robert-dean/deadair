import { vi } from 'vitest';

import type { HostFetchInit, HostFetchMethod, HostFetchResponse, PluginHost } from '@deadair/plugin-sdk';

/** One `host.fetch` call, recorded with only the fields tests care about. */
export interface RecordedFetchCall {
    url: string;
    method: HostFetchMethod | undefined;
    headers: Record<string, string> | undefined;
    body: string | undefined;
}

/**
 * A `PluginHost` for tests. `fetch` replays a queue of scripted
 * `HostFetchResponse`s (FIFO, one per call) — or a custom handler installed
 * with `setFetchImpl`, for call-count-driven scenarios like a 401-then-200
 * retry — and records every call it received in `calls`. `storage`, `config`,
 * `secrets` and the `oauth` vault are in-memory and can be seeded or read
 * directly, bypassing the `PluginHost` methods, so a test can assert on state
 * without going through the code under test twice.
 */
export interface FakePluginHost extends PluginHost {
    /** Every `host.fetch` call so far, in call order. */
    readonly calls: RecordedFetchCall[];
    /** Push one scripted response onto the back of the reply queue. */
    queueResponse(response: Partial<HostFetchResponse>): void;
    /** Replace the fetch handler outright; overrides the queue while set. */
    setFetchImpl(impl: (url: string, init?: HostFetchInit) => Promise<HostFetchResponse>): void;
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
}

/** Builds a default 200 `HostFetchResponse`, overridable field by field. */
export function fakeHostFetchResponse(overrides: Partial<HostFetchResponse> = {}): HostFetchResponse {
    return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        setCookie: [],
        body: '',
        ok: true,
        url: 'https://example.test/',
        redirected: false,
        ...overrides,
    };
}

export function createFakePluginHost(): FakePluginHost {
    const calls: RecordedFetchCall[] = [];
    const queue: HostFetchResponse[] = [];
    let customImpl: ((url: string, init?: HostFetchInit) => Promise<HostFetchResponse>) | undefined;

    const storageData = new Map<string, unknown>();
    let configData: Record<string, unknown> = {};
    const secretsData = new Map<string, string>();
    let tokens: Record<string, string> | undefined;

    const fetchImpl = vi.fn(async (url: string, init?: HostFetchInit): Promise<HostFetchResponse> => {
        calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
        if (customImpl) return customImpl(url, init);
        const next = queue.shift();
        if (!next) throw new Error(`fake plugin host: no response queued for ${init?.method ?? 'GET'} ${url}`);
        return next;
    });

    const host: FakePluginHost = {
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        fetch: fetchImpl,
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
        calls,
        queueResponse(response: Partial<HostFetchResponse>) {
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
    };

    return host;
}
