import { SdkError, type Rating, type Track, type TrackDetail } from '@deadair/sdk';
import { describe, expect, it, vi } from 'vitest';

import { NotConfigured } from '../../src/station/connection.failure.js';
import { RatingStore, type Catalog } from '../../src/station/track.rating.js';

function detail(rating?: Rating): TrackDetail {
    return { ...record(rating), bindings: [], plays: [], playCount: 0 };
}

function record(rating?: Rating): Track {
    return {
        id: 'track-1',
        title: 'Pale Blue Eyes',
        artistId: 'artist-1',
        artistName: 'The Velvet Underground',
        artists: 'The Velvet Underground',
        ...(rating === undefined ? {} : { rating }),
    };
}

function fakeCatalog(overrides: Partial<Catalog> = {}) {
    const catalog = {
        getTrack: vi.fn(async () => detail('liked')),
        rateTrack: vi.fn(async (_id: string, body: { rating: Rating }) => record(body.rating)),
        ...overrides,
    } satisfies Catalog;
    return { catalog, store: new RatingStore({ catalog: () => catalog }) };
}

describe('RatingStore', () => {
    it('asks the station what it thinks of a record, once, however many ask', async () => {
        const { catalog, store } = fakeCatalog();

        await Promise.all([store.load('track-1'), store.load('track-1')]);
        expect(await store.load('track-1')).toBe('liked');
        expect(catalog.getTrack).toHaveBeenCalledTimes(1);
        expect(catalog.getTrack).toHaveBeenCalledWith('track-1');
        expect(store.peek('track-1')).toEqual({ rating: 'liked' });
    });

    it('reads a record with no rating on it as no opinion rather than as nothing known', async () => {
        const { store } = fakeCatalog({ getTrack: vi.fn(async () => detail()) });
        expect(await store.load('track-1')).toBe('neutral');
        expect(store.peek('track-1')).toEqual({ rating: 'neutral' });
    });

    it('remembers a record it could not ask about, so a failing station is asked once a record', async () => {
        const getTrack = vi.fn(async () => {
            throw new SdkError(403, 'Forbidden', {}, new Headers());
        });
        const { store } = fakeCatalog({ getTrack });

        expect(await store.load('track-1')).toBeUndefined();
        expect(await store.load('track-1')).toBeUndefined();
        expect(getTrack).toHaveBeenCalledTimes(1);
        expect(store.peek('track-1')).toEqual({ rating: undefined });
    });

    it('knows nothing about a record nobody has asked about', () => {
        const { store } = fakeCatalog();
        expect(store.peek('track-9')).toBeUndefined();
    });

    it('writes a rating and lights the key from the answer, asking nothing more', async () => {
        const { catalog, store } = fakeCatalog();

        expect(await store.rate('track-1', 'disliked')).toBe('disliked');
        expect(catalog.rateTrack).toHaveBeenCalledWith('track-1', { rating: 'disliked' });
        expect(store.peek('track-1')).toEqual({ rating: 'disliked' });
        expect(await store.load('track-1')).toBe('disliked');
        expect(catalog.getTrack).not.toHaveBeenCalled();
    });

    it('throws a refused write to whoever pressed, and keeps what it knows', async () => {
        const { store } = fakeCatalog({
            rateTrack: vi.fn(async () => {
                throw new SdkError(403, 'Forbidden', {}, new Headers());
            }),
        });
        await store.load('track-1');

        await expect(store.rate('track-1', 'liked')).rejects.toBeInstanceOf(SdkError);
        expect(store.peek('track-1')).toEqual({ rating: 'liked' });
    });

    it('asks nothing, and remembers nothing, while there is no station', async () => {
        const store = new RatingStore({ catalog: () => undefined });
        expect(await store.load('track-1')).toBeUndefined();
        expect(store.peek('track-1')).toBeUndefined();
        await expect(store.rate('track-1', 'liked')).rejects.toBeInstanceOf(NotConfigured);
    });

    it('forgets everything when the station changes, because the ids were that station’s', async () => {
        const { store } = fakeCatalog();
        await store.load('track-1');
        store.reset();
        expect(store.peek('track-1')).toBeUndefined();
    });

    it('remembers a few records either way of the one on air, and no more', async () => {
        const catalog = {
            getTrack: vi.fn(async (id: string) => ({ ...detail('liked'), id })),
            rateTrack: vi.fn(async () => record('liked')),
        } satisfies Catalog;
        const store = new RatingStore({ catalog: () => catalog, capacity: 2 });

        await store.load('a');
        await store.load('b');
        await store.load('c');
        expect(store.peek('a')).toBeUndefined();
        expect(store.peek('c')).toEqual({ rating: 'liked' });
    });
});
