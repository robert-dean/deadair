// The one place the wire's spelling of an opinion and the column's meet. It is worth pinning
// because the two are not interchangeable and only one of them is ordered: `least(track, album,
// artist)` in `CandidatesRepository.ratingsFor` is what makes a dislike anywhere win, and it works
// on the numbers. A mapping that put `disliked` above `liked` would leave every query in the
// director looking correct and quietly programming the opposite station.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { ratingFromColumn, ratingToColumn, withRating } from '../../../src/modules/catalog/rating.js';
import { RatingAnnouncer } from '../../../src/modules/catalog/rating.announce.js';
import type { AfterCommit } from '../../../src/modules/data/after.commit.js';
import { StationBus } from '../../../src/modules/shared/station.bus.js';

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

// The other half of an opinion: telling the station about it. A dislike is an instruction, and
// until this existed it reached only the two places that BUILD a running order — so an order
// already on air went on playing what an operator had just forbidden. See `DislikeVeto`.
describe('RatingAnnouncer', () => {
    const build = () => {
        const tasks: (() => Promise<void>)[] = [];
        const afterCommit = {
            add: (task: () => Promise<void>) => {
                tasks.push(task);
            },
        } as unknown as AfterCommit;
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
        const bus = new StationBus(logger);
        const heard: unknown[] = [];
        bus.subscribe('catalog.disliked', event => heard.push(event));

        const commit = async () => {
            for (const task of tasks) await task();
        };

        return { announcer: new RatingAnnouncer(afterCommit, bus, logger), commit, tasks, heard, bus, logger };
    };

    it('says nothing until the write has committed', async () => {
        // `publishConfiguredAfterCommit`'s reason, and the same failure: the subscriber asks the
        // catalog what the station now thinks, on its own pooled connection, and inside this
        // request's transaction that read answers with the row as it stood BEFORE the operator's
        // write. Publishing inline would find nothing to do and the record would air anyway.
        const { announcer, commit, tasks, heard } = build();

        announcer.announce('artist', 'art_1', 'Grateful Dead', 'disliked');

        expect(tasks).toHaveLength(1);
        expect(heard).toEqual([]);

        await commit();
        expect(heard).toEqual([{ level: 'artist', id: 'art_1', name: 'Grateful Dead' }]);
    });

    it('says nothing at all about a like or a withdrawn opinion', async () => {
        // A like changes how often a record is drawn and `weightOf` reads that on the next draw, so
        // there is nothing for a running order to do about one. `neutral` cannot put back a record
        // already spliced out either.
        const { announcer, commit, heard } = build();

        announcer.announce('artist', 'art_1', 'Grateful Dead', 'liked');
        announcer.announce('track', 'trk_1', 'Truckin', 'neutral');
        await commit();

        expect(heard).toEqual([]);
    });

    it('lets a rating succeed even when nothing can be told about it', async () => {
        // The write is already durable by the time this runs, so a throw here would report failure
        // for something that worked. `StationBus.publish` catches a subscriber's own throw, which
        // is why the bus itself has to be broken to reach this path at all.
        const { announcer, commit, bus, logger } = build();
        vi.spyOn(bus, 'publish').mockImplementation(() => {
            throw new Error('the bus is gone');
        });

        announcer.announce('artist', 'art_1', 'Grateful Dead', 'disliked');

        await expect(commit()).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
    });
});
