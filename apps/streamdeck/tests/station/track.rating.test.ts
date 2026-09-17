import { SdkError } from '@deadair/sdk';
import { describe, expect, it, vi } from 'vitest';

import { NotConfigured } from '../../src/station/connection.failure.js';
import { RatingStore, type Catalog } from '../../src/station/track.rating.js';
import { catalogDetail, catalogTrack, fakeCatalog } from '../fixtures/fake.catalog.js';

function storeOver(catalog: Catalog) {
    return new RatingStore({ catalog: () => catalog });
}

describe('RatingStore', () => {
    it('asks the station what it thinks of a record, once, however many ask', async () => {
        const catalog = fakeCatalog('liked');
        const store = storeOver(catalog);

        await Promise.all([store.load('track-1'), store.load('track-1')]);
        expect(await store.load('track-1')).toBe('liked');
        expect(catalog.getTrack).toHaveBeenCalledTimes(1);
        expect(catalog.getTrack).toHaveBeenCalledWith('track-1');
        expect(store.peek('track-1')).toEqual({ rating: 'liked' });
    });

    it('reads a record with no rating on it as no opinion rather than as nothing known', async () => {
        const store = storeOver({ ...fakeCatalog(), getTrack: vi.fn(async () => catalogDetail()) });
        expect(await store.load('track-1')).toBe('neutral');
        expect(store.peek('track-1')).toEqual({ rating: 'neutral' });
    });

    it('remembers a record it could not ask about, so a failing station is asked once a record', async () => {
        const getTrack = vi.fn(async () => {
            throw new SdkError(403, 'Forbidden', {}, new Headers());
        });
        const store = storeOver({ ...fakeCatalog(), getTrack });

        expect(await store.load('track-1')).toBeUndefined();
        expect(await store.load('track-1')).toBeUndefined();
        expect(getTrack).toHaveBeenCalledTimes(1);
        expect(store.peek('track-1')).toEqual({ rating: undefined });
    });

    it('knows nothing about a record nobody has asked about', () => {
        expect(storeOver(fakeCatalog()).peek('track-9')).toBeUndefined();
    });

    it('writes a rating and lights the key from the answer, asking nothing more', async () => {
        const catalog = fakeCatalog('neutral');
        const store = storeOver(catalog);

        expect(await store.rate('track-1', 'disliked')).toBe('disliked');
        expect(catalog.rateTrack).toHaveBeenCalledWith('track-1', { rating: 'disliked' });
        expect(store.peek('track-1')).toEqual({ rating: 'disliked' });
        expect(await store.load('track-1')).toBe('disliked');
        expect(catalog.getTrack).not.toHaveBeenCalled();
    });

    it('throws a refused write to whoever pressed, and keeps what it knows', async () => {
        const store = storeOver({
            ...fakeCatalog('liked'),
            rateTrack: vi.fn(async () => {
                throw new SdkError(403, 'Forbidden', {}, new Headers());
            }),
        });
        await store.load('track-1');

        await expect(store.rate('track-1', 'disliked')).rejects.toBeInstanceOf(SdkError);
        expect(store.peek('track-1')).toEqual({ rating: 'liked' });
    });

    it('asks nothing, and remembers nothing, while there is no station', async () => {
        const store = new RatingStore({ catalog: () => undefined });
        expect(await store.load('track-1')).toBeUndefined();
        expect(store.peek('track-1')).toBeUndefined();
        await expect(store.rate('track-1', 'liked')).rejects.toBeInstanceOf(NotConfigured);
    });

    it('forgets everything when the station changes, because the ids were that station’s', async () => {
        const store = storeOver(fakeCatalog('liked'));
        const heard = vi.fn();
        store.subscribe(heard);
        await store.load('track-1');

        store.reset();
        expect(store.peek('track-1')).toBeUndefined();
        expect(heard).toHaveBeenCalled();
    });

    it('tells whoever is listening when an opinion changes, and not when it is the one they have', async () => {
        const store = storeOver(fakeCatalog('liked'));
        const heard = vi.fn();
        const stop = store.subscribe(heard);

        await store.load('track-1');
        expect(heard).toHaveBeenCalledTimes(1);
        await store.rate('track-1', 'liked');
        expect(heard).toHaveBeenCalledTimes(1);
        await store.rate('track-1', 'neutral');
        expect(heard).toHaveBeenCalledTimes(2);

        stop();
        await store.rate('track-1', 'disliked');
        expect(heard).toHaveBeenCalledTimes(2);
    });

    it('remembers a few records either way of the one on air, and no more', async () => {
        const store = new RatingStore({
            catalog: () => ({ ...fakeCatalog(), getTrack: vi.fn(async (id: string) => ({ ...catalogDetail('liked'), id })) }),
            capacity: 2,
        });

        await store.load('a');
        await store.load('b');
        await store.load('c');
        expect(store.peek('a')).toBeUndefined();
        expect(store.peek('c')).toEqual({ rating: 'liked' });
    });

    it('answers a write with what the station said, not with what was asked for', async () => {
        const store = storeOver({ ...fakeCatalog(), rateTrack: vi.fn(async () => catalogTrack('neutral')) });
        expect(await store.rate('track-1', 'liked')).toBe('neutral');
    });
});
