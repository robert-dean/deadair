import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderArtist } from '@deadair/plugin-sdk';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import {
    foldListening,
    LISTENING_PROFILE_KEY,
    ListeningProfileService,
    PROFILE_FRESH_MS,
    PROFILE_RETRY_MS,
} from '../../../src/modules/catalog/listening.profile.service.js';
import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';

const artist = (name: string, ...genres: string[]): ProviderArtist => ({ id: name, name, ...(genres.length > 0 ? { genres } : {}) });

function build(getTopArtists: (window: string) => Promise<ProviderArtist[]>, options: { off?: boolean; plugins?: boolean } = {}) {
    const top = vi.fn(getTopArtists);
    const record = { id: 'p', status: 'active', manifest: { capabilities: ['profile'] }, instance: { getTopArtists: top } };
    const registry = { list: () => (options.plugins === false ? [] : [record]) } as unknown as PluginRegistry;
    const invoker = { invoke: (_id: string, _op: string, fn: () => Promise<unknown>) => fn() } as unknown as PluginInvoker;
    const config = {
        get: (key: string, fallback: unknown) => (key === LISTENING_PROFILE_KEY && options.off ? 'false' : fallback),
    } as unknown as AppConfig;
    const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as Logger;
    return { service: new ListeningProfileService(registry, invoker, config, logger), top, logger };
}

describe('foldListening', () => {
    it('keeps the nearest window first and counts each artist once', () => {
        const profile = foldListening([
            [artist('Now', 'metal'), artist('Both', 'metal')],
            [artist('both', 'metal'), artist('Then', 'jazz')],
        ]);

        expect(profile.artists).toEqual(['Now', 'Both', 'Then']);
        expect(profile.genres).toEqual(['metal', 'jazz']);
    });

    it('breaks a tie between styles by name, so one answer always reads the same', () => {
        expect(foldListening([[artist('A', 'zydeco'), artist('B', 'ambient')]]).genres).toEqual(['ambient', 'zydeco']);
    });
});

describe('ListeningProfileService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('asks both windows once, then answers from memory until the answer goes stale', async () => {
        const { service, top } = build(async () => [artist('A')]);

        await expect(service.read()).resolves.toEqual({ artists: ['A'], genres: [] });
        await service.read();
        expect(top.mock.calls.map(call => call[0])).toEqual(['short', 'medium']);

        vi.advanceTimersByTime(PROFILE_FRESH_MS);
        await service.read();
        expect(top).toHaveBeenCalledTimes(4);
    });

    it('folds callers arriving during a read into that read', async () => {
        const { service, top } = build(async () => [artist('A')]);

        await Promise.all([service.read(), service.read(), service.read()]);

        expect(top).toHaveBeenCalledTimes(2);
    });

    it('asks nothing when switched off, and answers nothing', async () => {
        const { service, top } = build(async () => [artist('A')], { off: true });

        await expect(service.read()).resolves.toBeUndefined();
        expect(top).not.toHaveBeenCalled();
    });

    it('answers nothing when no plugin can say, and asks a plugin that appears later', async () => {
        const { service } = build(async () => [], { plugins: false });

        await expect(service.read()).resolves.toBeUndefined();
    });

    it('answers nothing rather than an empty profile for an account with no listening', async () => {
        const { service } = build(async () => []);

        await expect(service.read()).resolves.toBeUndefined();
    });

    it('survives one window failing', async () => {
        const { service } = build(async window => {
            if (window === 'short') throw new Error('refused');
            return [artist('A')];
        });

        await expect(service.read()).resolves.toEqual({ artists: ['A'], genres: [] });
    });

    it('never throws, keeps the last good answer through a failure, and waits before asking again', async () => {
        let up = true;
        const { service, top, logger } = build(async () => {
            if (!up) throw new Error('quota');
            return [artist('A')];
        });
        await service.read();

        up = false;
        vi.advanceTimersByTime(PROFILE_FRESH_MS);
        await expect(service.read()).resolves.toEqual({ artists: ['A'], genres: [] });
        expect(logger.warn).toHaveBeenCalledTimes(1);
        const asked = top.mock.calls.length;

        await service.read();
        expect(top).toHaveBeenCalledTimes(asked);

        vi.advanceTimersByTime(PROFILE_RETRY_MS);
        await service.read();
        expect(top.mock.calls.length).toBeGreaterThan(asked);
    });
});
