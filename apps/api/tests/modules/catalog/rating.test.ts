// The one place the wire's spelling of an opinion and the column's meet. It is worth pinning
// because the two are not interchangeable and only one of them is ordered: `least(track, album,
// artist)` in `CandidatesRepository.ratingsFor` is what makes a dislike anywhere win, and it works
// on the numbers. A mapping that put `disliked` above `liked` would leave every query in the
// director looking correct and quietly programming the opposite station.

import { describe, expect, it } from 'vitest';

import { ratingFromColumn, ratingToColumn, withRating } from '../../../src/modules/catalog/rating.js';

describe('ratingToColumn', () => {
    it('orders a dislike below neutral and a like above it', () => {
        expect(ratingToColumn('disliked')).toBeLessThan(ratingToColumn('neutral'));
        expect(ratingToColumn('liked')).toBeGreaterThan(ratingToColumn('neutral'));
    });

    it('writes the three values the check constraint allows', () => {
        expect([ratingToColumn('liked'), ratingToColumn('neutral'), ratingToColumn('disliked')]).toEqual([1, 0, -1]);
    });
});

describe('ratingFromColumn', () => {
    it('round-trips every opinion', () => {
        for (const rating of ['liked', 'neutral', 'disliked'] as const) {
            expect(ratingFromColumn(ratingToColumn(rating))).toBe(rating);
        }
    });

    it('reads a value outside the constraint as no opinion rather than refusing to draw the row', () => {
        expect(ratingFromColumn(7)).toBe('liked');
        expect(ratingFromColumn(Number.NaN)).toBe('neutral');
    });
});

describe('withRating', () => {
    it('replaces the column with the enum and leaves the rest of the row alone', () => {
        expect(withRating({ id: 'a', name: 'Talk Talk', rating: -1 })).toEqual({ id: 'a', name: 'Talk Talk', rating: 'disliked' });
    });
});
