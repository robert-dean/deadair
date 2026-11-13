// The station's own chart, ranked from counts somebody chose: the points, the lift a like gives,
// what keeps a record off, the tie-breaks a countdown needs, and the movement worked out from the
// weeks before an edition. No database: the repository's half is in its own file.

import { describe, expect, it } from 'vitest';

import {
    combineCounts,
    favouritesEdition,
    MIN_POINTS,
    pointsFor,
    rankTallies,
    STATION_CHART_SIZE,
    weekBefore,
    weeklyEdition,
    type SongStanding,
    type WeekTally,
} from '../../../src/modules/charts/station.chart.js';

const WEEK = '2026-11-02';
const LAST_WEEK = '2026-10-26';

const tally = (songKey: string, counts: Partial<Pick<WeekTally, 'plays' | 'requests' | 'skips' | 'lastAiredAt' | 'week'>> = {}): WeekTally => ({
    week: counts.week ?? WEEK,
    songKey,
    title: `${songKey} title`,
    artist: `${songKey} artist`,
    plays: counts.plays ?? 0,
    requests: counts.requests ?? 0,
    skips: counts.skips ?? 0,
    ...(counts.lastAiredAt === undefined ? {} : { lastAiredAt: counts.lastAiredAt }),
});

const standings = (entries: Record<string, Partial<SongStanding>> = {}): Map<string, SongStanding> =>
    new Map(Object.entries(entries).map(([key, standing]) => [key, { liked: false, barred: false, ...standing }]));

describe('pointsFor', () => {
    it('counts a play as one, a request as three and a skip as one off', () => {
        expect(pointsFor({ plays: 4, requests: 2, skips: 1 }, false)).toBe(9);
    });

    it('lifts a liked record by half', () => {
        expect(pointsFor({ plays: 4, requests: 0, skips: 0 }, true)).toBe(6);
    });

    it('never lifts a record the skips have taken below nothing', () => {
        expect(pointsFor({ plays: 1, requests: 0, skips: 3 }, true)).toBe(-2);
    });
});

describe('rankTallies', () => {
    it('ranks by points, a request outweighing two plays', () => {
        const ranked = rankTallies([tally('played', { plays: 2 }), tally('asked', { requests: 1 })], standings(), 40);

        expect(ranked.map(scored => scored.tally.songKey)).toEqual(['asked', 'played']);
    });

    it('keeps a disliked or suspended record off, however much it aired', () => {
        const ranked = rankTallies([tally('barred', { plays: 20 }), tally('fine', { plays: 2 })], standings({ barred: { barred: true } }), 40);

        expect(ranked.map(scored => scored.tally.songKey)).toEqual(['fine']);
    });

    it(`needs ${MIN_POINTS} points to place, so one play in a quiet week is not a placing`, () => {
        const ranked = rankTallies([tally('once', { plays: 1 }), tally('twice', { plays: 2 })], standings(), 40);

        expect(ranked.map(scored => scored.tally.songKey)).toEqual(['twice']);
    });

    it('lets a like carry a record over the bar, but not one nobody heard', () => {
        const ranked = rankTallies([tally('liked once', { plays: 1 })], standings({ 'liked once': { liked: true } }), 40);

        expect(ranked.map(scored => scored.tally.songKey)).toEqual([]);
    });

    it('breaks a tie on requests, then on the most recent play, then on the song key', () => {
        const ranked = rankTallies(
            [
                tally('c', { plays: 3, lastAiredAt: '2026-11-03T10:00:00.000Z' }),
                tally('b', { plays: 3, lastAiredAt: '2026-11-05T10:00:00.000Z' }),
                tally('a', { plays: 3, lastAiredAt: '2026-11-05T10:00:00.000Z' }),
                tally('requested', { requests: 1 }),
            ],
            standings(),
            40,
        );

        expect(ranked.map(scored => scored.tally.songKey)).toEqual(['requested', 'a', 'b', 'c']);
    });

    it('keeps at most the size asked for', () => {
        const tallies = Array.from({ length: 50 }, (_, index) => tally(`song ${String(index).padStart(2, '0')}`, { plays: 2 + index }));

        expect(rankTallies(tallies, standings(), STATION_CHART_SIZE)).toHaveLength(STATION_CHART_SIZE);
    });
});

describe('weekBefore', () => {
    it('steps back seven calendar days, across a month', () => {
        expect(weekBefore('2026-11-02')).toBe('2026-10-26');
        expect(weekBefore('2026-03-02')).toBe('2026-02-23');
    });
});

describe('weeklyEdition', () => {
    it('numbers the edition from one and carries what each record did that week', () => {
        const chart = weeklyEdition(
            [tally('top', { plays: 6, requests: 1 }), tally('second', { plays: 3 })],
            standings({ top: { liked: true } }),
            WEEK,
        );

        expect(chart).toEqual([
            { rank: 1, songKey: 'top', title: 'top title', artist: 'top artist', plays: 6, requests: 1, liked: true, peak: 1, weeksOn: 1 },
            { rank: 2, songKey: 'second', title: 'second title', artist: 'second artist', plays: 3, requests: 0, liked: false, peak: 2, weeksOn: 1 },
        ]);
    });

    it("works out last week's position, the peak and the weeks on from the weeks before it", () => {
        const chart = weeklyEdition(
            [
                tally('climber', { week: '2026-10-19', plays: 9 }),
                tally('other', { week: '2026-10-19', plays: 10 }),
                tally('climber', { week: LAST_WEEK, plays: 2 }),
                tally('other', { week: LAST_WEEK, plays: 3 }),
                tally('climber', { week: WEEK, plays: 8 }),
                tally('new', { week: WEEK, plays: 4 }),
            ],
            standings(),
            WEEK,
        );

        expect(chart.map(({ songKey, rank, peak, weeksOn, lastWeek }) => ({ songKey, rank, peak, weeksOn, lastWeek }))).toEqual([
            { songKey: 'climber', rank: 1, peak: 1, weeksOn: 3, lastWeek: 2 },
            { songKey: 'new', rank: 2, peak: 2, weeksOn: 1, lastWeek: undefined },
        ]);
    });

    it('never reads a week after the edition', () => {
        const chart = weeklyEdition([tally('later', { week: '2026-11-09', plays: 50 }), tally('now', { plays: 2 })], standings(), WEEK);

        expect(chart.map(entry => entry.songKey)).toEqual(['now']);
    });

    it('is empty for a week nothing aired in', () => {
        expect(weeklyEdition([tally('old', { week: LAST_WEEK, plays: 5 })], standings(), WEEK)).toEqual([]);
    });
});

describe('favouritesEdition', () => {
    it('ranks only what the station likes, over every week, with no movement', () => {
        const chart = favouritesEdition(
            [
                tally('liked', { week: LAST_WEEK, plays: 3 }),
                tally('liked', { week: WEEK, plays: 1, requests: 1 }),
                tally('also liked', { plays: 1 }),
                tally('unrated', { plays: 40 }),
            ],
            standings({ liked: { liked: true }, 'also liked': { liked: true } }),
            100,
        );

        expect(chart).toEqual([
            { rank: 1, songKey: 'liked', title: 'liked title', artist: 'liked artist', plays: 4, requests: 1, liked: true },
            { rank: 2, songKey: 'also liked', title: 'also liked title', artist: 'also liked artist', plays: 1, requests: 0, liked: true },
        ]);
    });
});

describe('combineCounts', () => {
    it('folds plays, requests and skips into one tally per record per week, named as it last aired', () => {
        const combined = combineCounts(
            [{ week: WEEK, songKey: 'k', title: 'Aired Title', artist: 'Aired Artist', count: 3, lastAiredAt: '2026-11-04T09:00:00.000Z' }],
            [
                { week: WEEK, songKey: 'k', title: 'Catalog Title', artist: 'Catalog Artist', count: 2 },
                { week: LAST_WEEK, songKey: 'k', title: 'Catalog Title', artist: 'Catalog Artist', count: 1 },
            ],
            [{ week: WEEK, songKey: 'k', title: '', artist: '', count: 1 }],
        );

        expect(combined).toEqual([
            {
                week: WEEK,
                songKey: 'k',
                title: 'Aired Title',
                artist: 'Aired Artist',
                plays: 3,
                requests: 2,
                skips: 1,
                lastAiredAt: '2026-11-04T09:00:00.000Z',
            },
            { week: LAST_WEEK, songKey: 'k', title: 'Catalog Title', artist: 'Catalog Artist', plays: 0, requests: 1, skips: 0 },
        ]);
    });
});
