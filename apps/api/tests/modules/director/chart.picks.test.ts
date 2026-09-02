// Turning a chart into picks. Pure, so this is a table rather than a harness — which is the reason
// the step was lifted out of `ChartSetGenerator` in the first place. The interesting behaviour is
// the ORDER, and one case in here is a genuine trap: the cap has to be applied before the reverse,
// or "the top ten as a countdown" quietly becomes the bottom ten.

import { describe, expect, it } from 'vitest';

import { chartPicks, DEFAULT_CHART_ORDER, type ChartEntryLike } from '../../../src/modules/director/chart.picks.js';
import { songKey } from '../../../src/modules/director/rotation.keys.js';

const entry = (rank: number, title: string, artist: string, year?: number): ChartEntryLike => ({
    rank,
    title,
    artist,
    ...(year === undefined ? {} : { year }),
});

/** Five records by five acts, so nothing is dropped for a reason a case did not ask for. */
const TOP_FIVE: ChartEntryLike[] = [
    entry(1, 'Glory Box', 'Portishead'),
    entry(2, 'Windowlicker', 'Aphex Twin'),
    entry(3, 'Teardrop', 'Massive Attack'),
    entry(4, 'Sour Times', 'Portishead'),
    entry(5, 'Angel', 'Massive Attack'),
];

const titles = (picks: readonly { title: string }[]): string[] => picks.map(pick => pick.title);

describe('chartPicks', () => {
    it('walks the published document from the top for `ranked`', () => {
        expect(titles(chartPicks(TOP_FIVE, { order: 'ranked' }))).toEqual([
            'Glory Box',
            'Windowlicker',
            'Teardrop',
            'Sour Times',
            'Angel',
        ]);
    });

    it('ends on number one for `countdown`', () => {
        expect(titles(chartPicks(TOP_FIVE, { order: 'countdown' }))).toEqual([
            'Angel',
            'Sour Times',
            'Teardrop',
            'Windowlicker',
            'Glory Box',
        ]);
    });

    it('takes the TOP of the chart when capped, then reverses it', () => {
        // The trap. Reversing first and then taking three would be a countdown of ranks 5, 4 and 3
        // — the records nobody asked for — and it would look right in every other assertion here.
        expect(titles(chartPicks(TOP_FIVE, { want: 3, order: 'countdown' }))).toEqual(['Teardrop', 'Windowlicker', 'Glory Box']);
    });

    it('defaults to the published order, leaving the countdown to whoever asks for one', () => {
        expect(titles(chartPicks(TOP_FIVE))).toEqual(titles(chartPicks(TOP_FIVE, { order: 'ranked' })));
        expect(DEFAULT_CHART_ORDER).toBe('countdown');
    });

    it('sorts by rank rather than trusting the order a service answered in', () => {
        const shuffled = [TOP_FIVE[2]!, TOP_FIVE[0]!, TOP_FIVE[4]!, TOP_FIVE[1]!, TOP_FIVE[3]!];

        expect(titles(chartPicks(shuffled, { order: 'ranked' }))).toEqual(titles(chartPicks(TOP_FIVE, { order: 'ranked' })));
    });

    it('names a title and an artist and never a trackId', () => {
        // The whole reason the resolver is allowed to be the only thing that matches a name.
        for (const pick of chartPicks(TOP_FIVE)) expect(pick).toEqual({ title: pick.title, artist: pick.artist });
    });

    it('drops records outside the period, and keeps one whose year is unknown', () => {
        const dated = [entry(1, 'Anthem', 'A', 1994), entry(2, 'Newer', 'B', 2024), entry(3, 'Undated', 'C')];

        expect(titles(chartPicks(dated, { era: { from: 1990, to: 1999 }, order: 'ranked' }))).toEqual(['Anthem', 'Undated']);
    });

    it('skips songs the running order already holds', () => {
        const avoid = new Set([songKey('Windowlicker', ['Aphex Twin'])]);

        expect(titles(chartPicks(TOP_FIVE, { avoidSongKeys: avoid, order: 'ranked' }))).toEqual([
            'Glory Box',
            'Teardrop',
            'Sour Times',
            'Angel',
        ]);
    });

    it('keeps one entry per song when a chart lists the same record twice', () => {
        const doubled = [entry(1, 'Glory Box', 'Portishead'), entry(2, 'glory box', 'portishead'), entry(3, 'Teardrop', 'Massive Attack')];

        expect(titles(chartPicks(doubled, { order: 'ranked' }))).toEqual(['Glory Box', 'Teardrop']);
    });

    it('fills the cap from further down rather than stopping short at a skipped record', () => {
        // The oversample only pays off if a dropped entry is replaced rather than counted.
        const avoid = new Set([songKey('Glory Box', ['Portishead'])]);

        expect(titles(chartPicks(TOP_FIVE, { want: 2, avoidSongKeys: avoid, order: 'ranked' }))).toEqual(['Windowlicker', 'Teardrop']);
    });

    it('answers with nothing for an empty chart or a cap of zero', () => {
        expect(chartPicks([], { order: 'countdown' })).toEqual([]);
        expect(chartPicks(TOP_FIVE, { want: 0 })).toEqual([]);
    });
});
