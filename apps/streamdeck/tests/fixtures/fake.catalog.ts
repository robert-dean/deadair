import type { Rating, Track, TrackDetail } from '@deadair/sdk';
import { vi } from 'vitest';

import type { Catalog } from '../../src/station/track.rating.js';
import { record, TRACK_ID } from './playout.status.js';

/** The catalog's row for the record the fixtures put on air, rated however a test wants it. */
export function catalogTrack(rating?: Rating): Track {
    return {
        id: TRACK_ID,
        title: record.title,
        artistId: 'artist-1',
        artistName: 'The Velvet Underground',
        artists: 'The Velvet Underground',
        ...(rating === undefined ? {} : { rating }),
    };
}

/** The same row as the detail route answers it: everything the record has accumulated, none of which a key reads. */
export function catalogDetail(rating?: Rating): TrackDetail {
    return { ...catalogTrack(rating), bindings: [], plays: [], playCount: 0 };
}

/**
 * A catalog that answers with one record, rated as the test says, and remembers a write the way the
 * station does: the answer to a rating is the record as it now stands.
 */
export function fakeCatalog(rating?: Rating) {
    let current = rating;
    const catalog = {
        getTrack: vi.fn(async () => catalogDetail(current)),
        rateTrack: vi.fn(async (_id: string, body: { rating: Rating }) => catalogTrack((current = body.rating))),
    } satisfies Catalog;
    return catalog;
}
