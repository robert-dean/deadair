// The provider half of a listener's search. It is reached on every search while the station may take
// records in, and it offers nothing the library half already showed, nothing the catalog holds, and
// nothing by an artist the station dislikes, guests included. Each term's answer is kept for a minute,
// a term already being asked about is joined rather than asked again, and a fresh one spends the
// caller's allowance, so a caller who is not one of the debouncing apps cannot drive the providers.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogKey, normalizeKey } from '../../../src/modules/catalog/catalog.keys.js';
import { RequestProviderSearch, REQUEST_PROVIDER_TTL_MS } from '../../../src/modules/requests/request.provider.search.js';
import type { FoundTrack } from '../../../src/modules/llm/provider.search.js';
import { settingsConfig } from '../../utils/settings.config.js';

const key = (title: string, artist: string) => catalogKey(normalizeKey(title), normalizeKey(artist));

const found = (title: string, artist: string, extra: Partial<FoundTrack> = {}): FoundTrack => ({
    title,
    artist,
    source: 'deadair.spotify',
    externalId: `sp-${title}`,
    ...extra,
});

function build(
    world: {
        reached?: FoundTrack[];
        owned?: string[];
        banned?: string[];
        bannedArtists?: string[];
        settings?: Record<string, string>;
        canSearch?: boolean;
        /** Whether the caller and the station still have the allowance. */
        allowed?: boolean;
    } = {},
) {
    const search = vi.fn(async () => ({ tracks: world.reached ?? [], searched: 1 }));
    const providers = { search, canSearch: () => world.canSearch ?? true };
    const tracks = {
        ownership: vi.fn(async () => ({ owned: new Set(world.owned ?? []), banned: new Set(world.banned ?? []) })),
        dislikedArtistKeys: vi.fn(async () => new Set((world.bannedArtists ?? []).map(normalizeKey))),
    };
    const registry = { get: vi.fn((id: string) => (id === 'deadair.spotify' ? { id, manifest: { name: 'Spotify' } } : undefined)) };
    const limiter = { allows: vi.fn(async (_callerKey: string) => world.allowed ?? true) };
    const { config } = settingsConfig(world.settings ?? {});
    return { finder: new RequestProviderSearch(providers as never, tracks as never, registry as never, config, limiter as never), search, limiter };
}

afterEach(() => {
    RequestProviderSearch.forget();
    vi.useRealTimers();
});

describe('RequestProviderSearch', () => {
    it('is reached by default, however much the library answered', () => {
        expect(build().finder.reaches()).toBe(true);
    });

    it('is not reached while the station may not take records in, with the setting as the STRING it really is', () => {
        expect(build({ settings: { 'rotation.discover': 'false' } }).finder.reaches()).toBe(false);
        expect(build({ settings: { 'rotation.discover': 'true' } }).finder.reaches()).toBe(true);
    });

    it('is not reached when no provider can be searched', () => {
        expect(build({ canSearch: false }).finder.reaches()).toBe(false);
    });

    it('offers a record by its provider copy, named by the plugin it comes from', async () => {
        const { finder, search } = build({ reached: [found('Blueberry Hill', 'Fats Domino', { album: 'Swings', year: 1959 })] });

        expect(await finder.search('blueberry', [], 10, 'user:a-1')).toEqual([
            {
                source: { pluginId: 'deadair.spotify', externalId: 'sp-Blueberry Hill' },
                sourceName: 'Spotify',
                title: 'Blueberry Hill',
                artist: 'Fats Domino',
                album: 'Swings',
                year: 1959,
            },
        ]);
        expect(search).toHaveBeenCalledWith('blueberry', {}, 25, { operation: 'requests.search.searchTracks' });
    });

    it('leaves out what the library showed, what the catalog holds, and what was disliked', async () => {
        const { finder } = build({
            reached: [found('Shown', 'A'), found('Held', 'B'), found('Banned', 'C'), found('Fine', 'D')],
            owned: [key('Held', 'B')],
            banned: [key('Banned', 'C')],
        });

        const rows = await finder.search('x', [{ title: 'Shown', artist: 'A' }], 10, 'user:a-1');

        expect(rows.map(row => row.title)).toEqual(['Fine']);
    });

    it('leaves out a record by a disliked artist, a guest as much as the lead', async () => {
        const { finder } = build({
            reached: [found('One', 'Lead'), found('Two', 'Other', { featuring: ['Lead'] }), found('Three', 'Other')],
            bannedArtists: ['Lead'],
        });

        expect((await finder.search('x', [], 10, 'user:a-1')).map(row => row.title)).toEqual(['Three']);
    });

    it('answers no more than it was asked for', async () => {
        const { finder } = build({ reached: [found('One', 'A'), found('Two', 'B'), found('Three', 'C')] });

        expect(await finder.search('x', [], 2, 'user:a-1')).toHaveLength(2);
    });

    it('asks the providers once a minute per term, whatever the case or the spaces', async () => {
        vi.useFakeTimers();
        const { finder, search } = build({ reached: [found('One', 'A')] });

        await finder.search('Blue', [], 10, 'user:a-1');
        await finder.search(' blue ', [], 10, 'user:a-1');
        expect(search).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(REQUEST_PROVIDER_TTL_MS + 1);
        await finder.search('blue', [], 10, 'user:a-1');
        expect(search).toHaveBeenCalledTimes(2);
    });

    it('spends the caller\'s allowance only on a term the providers are asked about fresh', async () => {
        const { finder, limiter } = build({ reached: [found('One', 'A')] });

        await finder.search('blue', [], 10, 'user:a-1');
        await finder.search('blue', [], 10, 'user:a-2');
        expect(limiter.allows).toHaveBeenCalledTimes(1);
        expect(limiter.allows).toHaveBeenCalledWith('user:a-1');
    });

    it('joins a search already asking about the same term rather than asking the providers twice', async () => {
        let answer: (value: { tracks: FoundTrack[]; searched: number }) => void = () => undefined;
        const { finder, search, limiter } = build();
        search.mockImplementationOnce(() => new Promise(resolve => (answer = resolve)));

        const first = finder.search('blue', [], 10, 'user:a-1');
        const second = finder.search('Blue ', [], 10, 'user:a-2');
        await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
        answer({ tracks: [found('One', 'A')], searched: 1 });

        expect(await first).toHaveLength(1);
        expect(await second).toHaveLength(1);
        expect(search).toHaveBeenCalledTimes(1);
        expect(limiter.allows).toHaveBeenCalledTimes(1);
    });

    it('answers nothing, and asks nothing, once the caller or the station is out of allowance', async () => {
        const { finder, search } = build({ reached: [found('One', 'A')], allowed: false });

        expect(await finder.search('blue', [], 10, 'user:a-1')).toEqual([]);
        expect(search).not.toHaveBeenCalled();
    });

    it('caches nothing for a refused term, so it is asked properly once the allowance is back', async () => {
        const { finder, search, limiter } = build({ reached: [found('One', 'A')] });
        limiter.allows.mockResolvedValueOnce(false);

        expect(await finder.search('blue', [], 10, 'user:a-1')).toEqual([]);
        expect(await finder.search('blue', [], 10, 'user:a-1')).toHaveLength(1);
        expect(search).toHaveBeenCalledTimes(1);
    });
});
