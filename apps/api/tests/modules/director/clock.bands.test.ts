// A schedule an operator types is a place where a typo becomes a bulletin at the wrong hour, so the
// parser's interesting cases are the ones it must REFUSE rather than the ones it accepts. And
// `nextOccurrence` is arithmetic on a wall clock, which is where daylight saving hides: the tests
// below pin both directions of a clock change, because getting either wrong shows up twice a year
// and nowhere else.

import { describe, expect, it } from 'vitest';

import { CLOCK_BAND_KEYS, nextOccurrence, parseBands, stationBands, type AnchoredBand } from '../../../src/modules/director/clock.bands.js';
import { settingsConfig } from '../../utils/settings.config.js';

const anchored = (minute: number, kind: string, hour?: number): AnchoredBand => ({
    at: 'clock',
    minute,
    kind,
    ...(hour === undefined ? {} : { hour }),
});

const LONDON = 'Europe/London';

describe('parseBands', () => {
    it('reads an hourly band, a daily one and an interval', () => {
        const { bands, rejected } = parseBands(':00 talkbreak\n09:30 news\nevery 60m news');

        expect(rejected).toEqual([]);
        expect(bands).toEqual([
            { at: 'clock', minute: 0, kind: 'talkbreak' },
            { at: 'clock', minute: 30, hour: 9, kind: 'news' },
            { at: 'interval', everyMs: 3_600_000, kind: 'news' },
        ]);
    });

    it('keeps the operator’s order, because order is what settles a contested boundary', () => {
        const { bands } = parseBands(':30 news\n:00 talkbreak');

        expect(bands.map(band => band.kind)).toEqual(['news', 'talkbreak']);
    });

    it('ignores blank lines and lets a # turn a rule off without losing it', () => {
        const { bands, rejected } = parseBands('\n# :00 talkbreak\n\n:30 news\n');

        expect(rejected).toEqual([]);
        expect(bands).toEqual([{ at: 'clock', minute: 30, kind: 'news' }]);
    });

    it('accepts the ways somebody might write an interval', () => {
        const { bands } = parseBands('every 20m news\nevery 45 min news\nEVERY 90 minutes news');

        expect(bands.map(band => (band.at === 'interval' ? band.everyMs : 0))).toEqual([1_200_000, 2_700_000, 5_400_000]);
    });

    it('reports a line it cannot read rather than guessing at it', () => {
        // Every one of these is a plausible typo, and every one of them would put a break on air at
        // a time nobody chose if it were read as anything at all.
        const { bands, rejected } = parseBands('9:0 news\n:60 news\n25:00 news\nevery 0m news\nnews\n:30');

        expect(bands).toEqual([]);
        expect(rejected).toEqual(['9:0 news', ':60 news', '25:00 news', 'every 0m news', 'news', ':30']);
    });

    it('answers nothing at all for a box nobody has written in', () => {
        // Deliberately NOT the templates rule, where empty restores the station's own five. An
        // empty schedule is a coherent schedule: ordinary spacing and nothing else.
        expect(parseBands(undefined).bands).toEqual([]);
        expect(parseBands('').bands).toEqual([]);
        expect(parseBands('  \n\n # nothing here\n').bands).toEqual([]);
    });
});

describe('stationBands', () => {
    it('reads the operator’s schedule out of the settings', () => {
        const { config } = settingsConfig({ [CLOCK_BAND_KEYS.bands]: ':00 talkbreak' });

        expect(stationBands(config).bands).toEqual([{ at: 'clock', minute: 0, kind: 'talkbreak' }]);
    });

    it('answers nothing when the station has no schedule', () => {
        expect(stationBands(settingsConfig().config).bands).toEqual([]);
    });
});

describe('nextOccurrence', () => {
    it('finds the next top of the hour', () => {
        const from = Date.UTC(2026, 7, 13, 8, 42);

        expect(nextOccurrence(anchored(0, 'talkbreak'), from, 'UTC')).toBe(Date.UTC(2026, 7, 13, 9, 0));
    });

    it('finds the next half past, within the same hour', () => {
        const from = Date.UTC(2026, 7, 13, 8, 12);

        expect(nextOccurrence(anchored(30, 'news'), from, 'UTC')).toBe(Date.UTC(2026, 7, 13, 8, 30));
    });

    it('never answers the occurrence that is happening right now', () => {
        // Strictly after, or a band resolved on its own boundary would keep re-targeting a slot the
        // station has already gone past — and the planner asks this on every commit pass.
        const now = Date.UTC(2026, 7, 13, 9, 0);

        expect(nextOccurrence(anchored(0, 'talkbreak'), now, 'UTC')).toBe(Date.UTC(2026, 7, 13, 10, 0));
    });

    it('waits a whole day for a band pinned to an hour', () => {
        const from = Date.UTC(2026, 7, 13, 9, 30);

        expect(nextOccurrence(anchored(0, 'news', 9), from, 'UTC')).toBe(Date.UTC(2026, 7, 14, 9, 0));
    });

    it('reads the clock where the station is', () => {
        // 08:42 UTC is 09:42 in London in August, so the next top of the hour is 10:00 London,
        // which is 09:00 UTC. Read against UTC it would be an hour out.
        const from = Date.UTC(2026, 7, 13, 8, 42);

        expect(nextOccurrence(anchored(0, 'talkbreak'), from, LONDON)).toBe(Date.UTC(2026, 7, 13, 9, 0));
        expect(nextOccurrence(anchored(0, 'news', 9), from, LONDON)).toBe(Date.UTC(2026, 7, 14, 8, 0));
    });

    it('lands on the right instant through a spring-forward', () => {
        // London goes 01:00 -> 02:00 on 29 March 2026. A daily 09:00 band that morning is still a
        // real 09:00, and it is an hour earlier in UTC than the day before.
        const from = Date.UTC(2026, 2, 28, 12, 0);
        const at = nextOccurrence(anchored(0, 'news', 9), from, LONDON);

        expect(at).toBe(Date.UTC(2026, 2, 29, 8, 0));
    });

    it('lands on the right instant through an autumn fall-back', () => {
        // London goes 02:00 -> 01:00 on 25 October 2026.
        const from = Date.UTC(2026, 9, 24, 12, 0);
        const at = nextOccurrence(anchored(0, 'news', 9), from, LONDON);

        expect(at).toBe(Date.UTC(2026, 9, 25, 9, 0));
    });

    it('skips a day whose wall clock never reaches the time asked for', () => {
        // 01:30 does not exist in London on 29 March 2026: the clock jumps straight past it. The
        // band skips that day rather than landing an hour out, which is the failure that would
        // have a bulletin air at half past midnight.
        const from = Date.UTC(2026, 2, 28, 12, 0);
        const at = nextOccurrence(anchored(30, 'news', 1), from, LONDON);

        expect(at).toBe(Date.UTC(2026, 2, 30, 0, 30));
    });

    it('always answers something later than it was asked about', () => {
        // The property the planner leans on. Every hour of a fortnight, both band shapes.
        for (let hour = 0; hour < 24 * 14; hour++) {
            const from = Date.UTC(2026, 2, 20, hour, 17);

            expect(nextOccurrence(anchored(0, 'talkbreak'), from, LONDON)).toBeGreaterThan(from);
            expect(nextOccurrence(anchored(30, 'news', 9), from, LONDON)).toBeGreaterThan(from);
        }
    });
});
