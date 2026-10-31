// A show is the one claim on air that sends somebody somewhere, so what is pinned here is the
// window that keeps it true and the check that keeps it from being made up.

import { describe, expect, it } from 'vitest';

import { concertLine, concertWindow, inventedConcertSentence, spokenConcertDate } from '../../../src/modules/director/break.concert.js';

const SHOW = { venue: 'Tabernacle', city: 'Atlanta', date: 'Saturday, November 14' };

describe('concertWindow', () => {
    it('starts tomorrow on the station calendar, so a show cannot pass between the writing and the air', () => {
        // Half past one in the morning UTC on the 1st is still October 31 in Atlanta.
        const now = Date.parse('2026-11-01T01:30:00Z');
        expect(concertWindow(now, 'America/New_York')).toEqual({ from: '2026-11-01', until: '2026-12-30' });
    });
});

describe('spokenConcertDate', () => {
    it('says a date as a presenter does, whatever zone the server is in', () => {
        expect(spokenConcertDate('2026-11-14')).toBe('Saturday, November 14');
    });
});

describe('concertLine', () => {
    it('gives the venue and the date and fences off everything else', () => {
        const line = concertLine('Royal Blood', SHOW);
        expect(line).toContain('Royal Blood play Tabernacle in Atlanta on Saturday, November 14');
        expect(line).toContain('Do not add a time, a price, tickets');
    });
});

describe('inventedConcertSentence', () => {
    it('refuses a show this break was not handed', () => {
        expect(inventedConcertSentence('Great record. Tickets go on sale Friday, Garth.', [])).toBe('Tickets go on sale Friday, Garth.');
    });

    it('leaves an ordinary break alone, month and day included', () => {
        expect(inventedConcertSentence('Released on March 20, this one rocks. Playing it loud in the basement.', [])).toBeUndefined();
    });

    it('accepts the date it was handed', () => {
        expect(inventedConcertSentence('They hit the Tabernacle on Saturday, November 14. Excellent!', [SHOW])).toBeUndefined();
    });

    it('refuses the right venue on a date it was not handed', () => {
        expect(inventedConcertSentence('They hit the Tabernacle on November 15.', [SHOW])).toBe('They hit the Tabernacle on November 15.');
    });
});
