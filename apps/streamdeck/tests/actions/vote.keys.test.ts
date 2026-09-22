import { SdkError } from '@deadair/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteKeys } from '../../src/actions/vote.keys.js';
import { svgDataUri, voteSvg } from '../../src/display/key.image.js';
import { RatingStore, type Catalog } from '../../src/station/track.rating.js';
import { fakeCatalog } from '../fixtures/fake.catalog.js';
import { fakeKey } from '../fixtures/fake.key.js';
import { fakeStation } from '../fixtures/fake.station.js';
import { airing, record, stoodDown, TRACK_ID } from '../fixtures/playout.status.js';
import { POLL_INTERVAL_MS } from '../../src/station/status.poller.js';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

/** A deck showing both vote keys against one station, which is the arrangement the pair is drawn for. */
async function deck(catalog: Catalog = fakeCatalog('neutral'), station = fakeStation()) {
    const log = vi.fn();
    const ratings = new RatingStore({ catalog: () => catalog });
    const like = new VoteKeys('liked', ratings, station.poller, log);
    const dislike = new VoteKeys('disliked', ratings, station.poller, log);
    const likeKey = fakeKey('like');
    const dislikeKey = fakeKey('dislike');
    like.appear(likeKey);
    dislike.appear(dislikeKey);
    await vi.advanceTimersByTimeAsync(0);
    return { like, dislike, likeKey, dislikeKey, log, station, catalog, ratings };
}

const last = (calls: string[], what: string): string | undefined => calls.filter(call => call.startsWith(what)).at(-1);

/** The face the renderer draws for a state, as the key would have been told to show it. */
/**
 * The face the renderer draws for a state, as the key would have been told to show it.
 *
 * With no skull, because `deck` builds its keys without one: a plugin that could not read
 * `skull.png` off its own folder draws the heart alone, and the tests are about what the key decides
 * rather than about the picture inside it. The skull's own thread is the test below.
 */
const face = (vote: 'liked' | 'disliked', lit: boolean, dim = false): string => `image ${svgDataUri(voteSvg({ vote, lit, dim }))}`;

describe('VoteKeys', () => {
    it('asks the station what it thinks of the record on air, once for both keys', async () => {
        const { catalog, likeKey, dislikeKey } = await deck(fakeCatalog('liked'));

        expect(catalog.getTrack).toHaveBeenCalledTimes(1);
        expect(catalog.getTrack).toHaveBeenCalledWith(TRACK_ID);
        expect(last(likeKey.calls, 'image')).toBe(face('liked', true));
        expect(last(dislikeKey.calls, 'image')).toBe(face('disliked', false));
    });

    it('does not ask again while the same record plays', async () => {
        const { catalog } = await deck();
        await vi.advanceTimersByTimeAsync(6_000);
        expect(catalog.getTrack).toHaveBeenCalledTimes(1);
    });

    it('writes its own opinion, and ticks', async () => {
        const { like, likeKey, catalog } = await deck();

        await like.press('like');
        expect(catalog.rateTrack).toHaveBeenCalledWith(TRACK_ID, { rating: 'liked' });
        expect(likeKey.calls).toContain('ok');
        expect(last(likeKey.calls, 'image')).toBe(face('liked', true));
    });

    it('withdraws the opinion on a second press, which is where neutral lives on a deck', async () => {
        const { like, likeKey, catalog } = await deck();

        await like.press('like');
        await like.press('like');
        expect(catalog.rateTrack).toHaveBeenLastCalledWith(TRACK_ID, { rating: 'neutral' });
        expect(last(likeKey.calls, 'image')).toBe(face('liked', false));
    });

    it('takes the light off the other key, which is a different action and cannot see this one', async () => {
        const { like, dislike, likeKey, dislikeKey } = await deck(fakeCatalog('liked'));
        expect(last(likeKey.calls, 'image')).toBe(face('liked', true));

        await dislike.press('dislike');
        expect(last(dislikeKey.calls, 'image')).toBe(face('disliked', true));
        expect(last(likeKey.calls, 'image')).toBe(face('liked', false));
    });

    it('refuses a press on something with no row in the catalog, and asks the station nothing', async () => {
        const { trackId: _trackId, ...aBreak } = record;
        const station = fakeStation(airing({ nowPlaying: { item: aBreak, startedAt: 1_000 } }));
        const { like, likeKey, catalog } = await deck(fakeCatalog(), station);

        await like.press('like');
        expect(catalog.getTrack).not.toHaveBeenCalled();
        expect(catalog.rateTrack).not.toHaveBeenCalled();
        expect(likeKey.calls).toContain('alert');
        expect(last(likeKey.calls, 'image')).toBe(face('liked', false, true));
    });

    it('refuses a press with nothing on air', async () => {
        const { like, likeKey, catalog } = await deck(fakeCatalog(), fakeStation(stoodDown()));
        await like.press('like');
        expect(catalog.rateTrack).not.toHaveBeenCalled();
        expect(likeKey.calls).toContain('alert');
    });

    it('goes faint on a stale reading and refuses the press, because the opinion may be about the record before', async () => {
        const { like, likeKey, station, catalog } = await deck(fakeCatalog('liked'));
        expect(last(likeKey.calls, 'image')).toBe(face('liked', true));

        station.playout.getPlayoutStatus.mockRejectedValue(new TypeError('fetch failed'));
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

        expect(last(likeKey.calls, 'image')).toBe(face('liked', false, true));
        expect(likeKey.calls).toContain('title No station');
        await like.press('like');
        expect(catalog.rateTrack).not.toHaveBeenCalled();
        expect(likeKey.calls).toContain('alert');
    });

    it('says in the log that voting needs a key with Read and manage', async () => {
        const catalog = {
            ...fakeCatalog(),
            rateTrack: vi.fn(async () => {
                throw new SdkError(403, 'Forbidden', {}, new Headers());
            }),
        };
        const { like, likeKey, log } = await deck(catalog);

        await like.press('like');
        expect(likeKey.calls).toContain('alert');
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Voting needs a key with Read and manage'));
    });

    it('still reads the rating with a key that may not write it', async () => {
        const catalog = {
            ...fakeCatalog('disliked'),
            rateTrack: vi.fn(async () => {
                throw new SdkError(403, 'Forbidden', {}, new Headers());
            }),
        };
        const { dislikeKey } = await deck(catalog);
        expect(last(dislikeKey.calls, 'image')).toBe(face('disliked', true));
    });

    it('ignores a second press while the first is still going', async () => {
        const catalog = fakeCatalog();
        let finish: () => void = () => undefined;
        catalog.rateTrack.mockImplementationOnce(() => new Promise(resolve => (finish = () => resolve(catalogLiked()))));
        const { like } = await deck(catalog);

        const first = like.press('like');
        await like.press('like');
        finish();
        await first;
        expect(catalog.rateTrack).toHaveBeenCalledTimes(1);
    });

    it('asks about the next record when the station moves on', async () => {
        const { catalog, station } = await deck();
        station.answer(airing({ nowPlaying: { item: { ...record, id: 'item-2', trackId: 'track-2' }, startedAt: 2_000 } }));
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

        expect(catalog.getTrack).toHaveBeenCalledTimes(2);
        expect(catalog.getTrack).toHaveBeenLastCalledWith('track-2');
    });

    it('draws the mark’s skull inside the heart when the plugin could read it', async () => {
        const station = fakeStation();
        const ratings = new RatingStore({ catalog: () => fakeCatalog('liked') });
        const like = new VoteKeys('liked', ratings, station.poller, vi.fn(), 'data:image/png;base64,AAAA');
        const key = fakeKey('like');
        like.appear(key);
        await vi.advanceTimersByTimeAsync(0);

        const drawn = last(key.calls, 'image');
        expect(drawn).toBe(`image ${svgDataUri(voteSvg({ vote: 'liked', lit: true, dim: false, skull: 'data:image/png;base64,AAAA' }))}`);
        expect(drawn).not.toBe(face('liked', true));
    });

    it('lets go of the poller and the store when the last key goes', async () => {
        const { like, dislike, station } = await deck();
        like.disappear('like');
        dislike.disappear('dislike');
        station.playout.getPlayoutStatus.mockClear();
        await vi.advanceTimersByTimeAsync(6_000);
        expect(station.playout.getPlayoutStatus).not.toHaveBeenCalled();
    });
});

function catalogLiked() {
    return { id: TRACK_ID, title: record.title, artistId: 'a', artistName: 'a', artists: 'a', rating: 'liked' as const };
}
