import { DateTime } from 'luxon';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderArtist, ProviderPlay } from '@deadair/plugin-sdk';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import {
    AIRING_AFTER_PLAY_MS,
    AIRING_BEFORE_PLAY_MS,
    foldListening,
    foldRecent,
    LISTENING_PROFILE_KEY,
    ListeningProfileService,
    PROFILE_FRESH_MS,
    PROFILE_RETRY_MS,
    RECENT_FRESH_MS,
    RECENT_RETRY_MS,
    RECENT_WINDOW_MS,
    withoutAirings,
} from '../../../src/modules/catalog/listening.profile.service.js';
import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import { songKey } from '../../../src/modules/director/rotation.keys.js';
import type { Container } from 'injectkit';

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
    const container = { createScopedContainer: () => ({ get: () => ({}) }) } as unknown as Container;
    return { service: new ListeningProfileService(registry, invoker, config, logger, container), top, logger };
}

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const play = (title: string, artist: string, playedAt: string): ProviderPlay => ({
    track: { id: `${artist}-${title}`, title, artists: artist === '' ? [] : [artist] },
    playedAt,
});

interface RecentOptions {
    off?: boolean;
    airings?: () => Promise<{ songKey: string; airedAt: DateTime }[]>;
    sources?: (() => Promise<ProviderPlay[]>)[];
}

/** A service whose plugins each answer recent plays with the function given, one plugin per function. */
function buildRecent(options: RecentOptions) {
    const asks = (options.sources ?? []).map(source => vi.fn(source));
    const records = asks.map((getRecentPlays, index) => ({
        id: `p${index}`,
        status: 'active',
        manifest: { capabilities: ['profile'] },
        instance: { getTopArtists: async () => [], getRecentPlays },
    }));
    const registry = { list: () => records } as unknown as PluginRegistry;
    const invoker = { invoke: (_id: string, _op: string, fn: () => Promise<unknown>) => fn() } as unknown as PluginInvoker;
    const config = {
        get: (key: string, fallback: unknown) => (key === LISTENING_PROFILE_KEY && options.off ? 'false' : fallback),
    } as unknown as AppConfig;
    const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as Logger;
    const airingsSince = vi.fn(options.airings ?? (async () => []));
    const container = {
        createScopedContainer: () => ({ get: () => ({ airingsSince }), disposeAsync: async () => undefined }),
    } as unknown as Container;
    return { service: new ListeningProfileService(registry, invoker, config, logger, container), asks, airingsSince, logger };
}

describe('withoutAirings', () => {
    const aired = (title: string, artist: string, minutes: number) => ({ songKey: songKey(title, [artist]), airedAtMs: NOW - minutes * 60_000 });

    it('drops a play the station aired just before it', () => {
        expect(withoutAirings([play('One', 'A', minutesAgo(10))], [aired('One', 'A', 14)])).toEqual([]);
    });

    it('matches across spellings, since a source may never have heard of the copy that aired', () => {
        expect(withoutAirings([play('One', 'Beyoncé', minutesAgo(10))], [aired('ONE', 'Beyonce', 12)])).toEqual([]);
    });

    it('keeps the same song played well away from any airing of it', () => {
        const mine = play('One', 'A', minutesAgo(120));
        expect(withoutAirings([mine], [aired('One', 'A', 10), aired('One', 'A', 400)])).toEqual([mine]);
    });

    it('holds at both edges of the window and no further', () => {
        const at = (airedAtMs: number) => [{ songKey: songKey('One', ['A']), airedAtMs }];
        const mine = play('One', 'A', minutesAgo(60));
        const playedAtMs = Date.parse(mine.playedAt);

        expect(withoutAirings([mine], at(playedAtMs - AIRING_BEFORE_PLAY_MS))).toEqual([]);
        expect(withoutAirings([mine], at(playedAtMs + AIRING_AFTER_PLAY_MS))).toEqual([]);
        expect(withoutAirings([mine], at(playedAtMs - AIRING_BEFORE_PLAY_MS - 1))).toEqual([mine]);
        expect(withoutAirings([mine], at(playedAtMs + AIRING_AFTER_PLAY_MS + 1))).toEqual([mine]);
    });

    it('keeps another act with the same title', () => {
        const mine = play('Hurt', 'Johnny Cash', minutesAgo(10));
        expect(withoutAirings([mine], [aired('Hurt', 'Nine Inch Nails', 12)])).toEqual([mine]);
    });
});

describe('foldRecent', () => {
    it('ranks by plays, then by who was on latest, counting a spelling once', () => {
        const artists = foldRecent(
            [
                play('a', 'Latest', minutesAgo(5)),
                play('b', 'Twice', minutesAgo(10)),
                play('c', 'Older', minutesAgo(15)),
                play('d', 'TWICE', minutesAgo(20)),
            ],
            NOW,
        );

        expect(artists).toEqual(['Twice', 'Latest', 'Older']);
    });

    it('ages out what is past the window, and ignores a play with no artist or no readable time', () => {
        const pastWindow = new Date(NOW - RECENT_WINDOW_MS - 1).toISOString();

        expect(foldRecent([play('a', 'Old', pastWindow), play('b', '', minutesAgo(1)), play('c', 'Unreadable', 'whenever')], NOW)).toEqual([]);
    });

    it('credits the lead artist alone', () => {
        const duet: ProviderPlay = { track: { id: 'x', title: 'x', artists: ['Lead', 'Guest'] }, playedAt: minutesAgo(1) };

        expect(foldRecent([duet], NOW)).toEqual(['Lead']);
    });

    it('keeps fifteen', () => {
        const plays = Array.from({ length: 20 }, (_, index) => play('a', `Artist ${index}`, minutesAgo(index)));

        expect(foldRecent(plays, NOW)).toHaveLength(15);
    });
});

describe('ListeningProfileService.recent', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('says who was played, less what the station aired', async () => {
        const { service } = buildRecent({
            sources: [async () => [play('Mine', 'Operator', minutesAgo(30)), play('Aired', 'Station', minutesAgo(10))]],
            airings: async () => [{ songKey: songKey('Aired', ['Station']), airedAt: DateTime.fromMillis(NOW - 12 * 60_000) }],
        });

        await expect(service.recent()).resolves.toEqual(['Operator']);
    });

    it('asks once an hour, and only for this', async () => {
        const { service, asks } = buildRecent({ sources: [async () => [play('a', 'A', minutesAgo(1))]] });

        await service.recent();
        await service.recent();
        expect(asks[0]).toHaveBeenCalledTimes(1);

        vi.setSystemTime(NOW + RECENT_FRESH_MS);
        await service.recent();
        expect(asks[0]).toHaveBeenCalledTimes(2);
    });

    it('costs nothing when switched off', async () => {
        const { service, asks } = buildRecent({ off: true, sources: [async () => [play('a', 'A', minutesAgo(1))]] });

        await expect(service.recent()).resolves.toEqual([]);
        expect(asks[0]).not.toHaveBeenCalled();
    });

    it('leaves out a provider that keeps no history without failing', async () => {
        const { service } = build(async () => []);

        await expect(service.recent()).resolves.toEqual([]);
    });

    it('takes what one source said when another fails', async () => {
        const { service } = buildRecent({
            sources: [async () => Promise.reject(new Error('forbidden')), async () => [play('a', 'A', minutesAgo(1))]],
        });

        await expect(service.recent()).resolves.toEqual(['A']);
    });

    it('keeps the last good answer when every source fails, and waits before asking again', async () => {
        let failing = false;
        const { service, asks, logger } = buildRecent({
            sources: [async () => (failing ? Promise.reject(new Error('refused')) : [play('a', 'A', minutesAgo(1))])],
        });
        await service.recent();

        failing = true;
        vi.setSystemTime(NOW + RECENT_FRESH_MS);
        await expect(service.recent()).resolves.toEqual(['A']);
        expect(logger.warn).toHaveBeenCalledTimes(1);

        vi.setSystemTime(NOW + RECENT_FRESH_MS + RECENT_RETRY_MS - 1);
        await service.recent();
        expect(asks[0]).toHaveBeenCalledTimes(2);

        vi.setSystemTime(NOW + RECENT_FRESH_MS + RECENT_RETRY_MS);
        await service.recent();
        expect(asks[0]).toHaveBeenCalledTimes(3);
    });

    it('says nothing rather than something unfiltered when the airings cannot be read', async () => {
        let broken = false;
        const { service, logger } = buildRecent({
            sources: [async () => [play('a', 'A', minutesAgo(1))]],
            airings: async () => {
                if (broken) throw new Error('database gone');
                return [];
            },
        });
        await expect(service.recent()).resolves.toEqual(['A']);

        broken = true;
        vi.setSystemTime(NOW + RECENT_FRESH_MS);
        await expect(service.recent()).resolves.toEqual([]);
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });
});

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
