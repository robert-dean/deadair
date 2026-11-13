// A festival as it is stored: what is mended on the way in, what is refused, and how its dates are read
// against the station's calendar.

import { describe, expect, it } from 'vitest';

import { festivalDraftOf, festivalState, isCalendarDate, stationToday } from '../../../src/modules/schedule/festival.rules.js';

const body = (overrides: Partial<Parameters<typeof festivalDraftOf>[0]> = {}) => ({
    name: 'Shaky Knees',
    startsOn: '2027-05-07',
    endsOn: '2027-05-09',
    acts: [{ artist: 'Foo Fighters', headliner: true }, { artist: 'The Struts' }],
    ...overrides,
});

const statusOf = (thrown: unknown): number | undefined => (thrown as { statusCode?: number }).statusCode;

function refusal(run: () => unknown): { status?: number; message?: string } {
    try {
        run();
    } catch (error) {
        return { status: statusOf(error), message: (error as { details?: { message?: string } }).details?.message };
    }
    return {};
}

describe('festivalDraftOf', () => {
    it('keeps the bill in the order it was listed', () => {
        const draft = festivalDraftOf(body());
        expect(draft.acts).toEqual([
            { artist: 'Foo Fighters', headliner: true },
            { artist: 'The Struts', headliner: false },
        ]);
    });

    it('trims text and leaves a blank optional absent', () => {
        const draft = festivalDraftOf(body({ name: '  Shaky Knees ', place: '   ', url: '' }));
        expect(draft.name).toBe('Shaky Knees');
        expect(draft).not.toHaveProperty('place');
        expect(draft).not.toHaveProperty('url');
    });

    it('drops a blank line from a pasted bill', () => {
        expect(festivalDraftOf(body({ acts: [{ artist: ' ' }, { artist: 'Wet Leg' }] })).acts.map(act => act.artist)).toEqual(['Wet Leg']);
    });

    it('keeps an act listed twice once, at its first place, headlining if either listing said so', () => {
        const draft = festivalDraftOf(body({ acts: [{ artist: 'The Struts' }, { artist: 'Wet Leg' }, { artist: 'the struts', headliner: true }] }));
        expect(draft.acts).toEqual([
            { artist: 'The Struts', headliner: true },
            { artist: 'Wet Leg', headliner: false },
        ]);
    });

    it("carries an act's day inside the festival", () => {
        expect(festivalDraftOf(body({ acts: [{ artist: 'Wet Leg', day: '2027-05-08' }] })).acts[0]).toEqual({
            artist: 'Wet Leg',
            day: '2027-05-08',
            headliner: false,
        });
    });

    it("refuses an act's day outside the festival", () => {
        const refused = refusal(() => festivalDraftOf(body({ acts: [{ artist: 'Wet Leg', day: '2027-05-10' }] })));
        expect(refused.status).toBe(400);
        expect(refused.message).toContain('Wet Leg');
    });

    it('refuses dates the wrong way round', () => {
        expect(refusal(() => festivalDraftOf(body({ startsOn: '2027-05-09', endsOn: '2027-05-07' }))).status).toBe(400);
    });

    it('refuses a day that does not exist', () => {
        expect(refusal(() => festivalDraftOf(body({ startsOn: '2027-02-30', endsOn: '2027-03-01' }))).status).toBe(400);
    });

    it('refuses a festival with no name', () => {
        expect(refusal(() => festivalDraftOf(body({ name: '  ' }))).status).toBe(400);
    });

    it('carries where it was imported from', () => {
        expect(festivalDraftOf(body(), { pluginId: 'ticketmaster', eventId: 'G5v' }).source).toEqual({ pluginId: 'ticketmaster', eventId: 'G5v' });
    });
});

describe('festivalState', () => {
    const festival = { startsOn: '2027-05-07', endsOn: '2027-05-09' };

    it('is upcoming before its first day', () => expect(festivalState(festival, '2027-05-06')).toBe('upcoming'));
    it('is on from its first day to its last, inclusive', () => {
        expect(festivalState(festival, '2027-05-07')).toBe('on');
        expect(festivalState(festival, '2027-05-09')).toBe('on');
    });
    it('is over the day after', () => expect(festivalState(festival, '2027-05-10')).toBe('over'));
});

describe('stationToday', () => {
    it('reads the day at the station rather than in UTC', () => {
        // Half an hour into the 8th in UTC, and still the evening of the 7th in Atlanta.
        expect(stationToday(Date.parse('2027-05-08T00:30:00Z'), 'America/New_York')).toBe('2027-05-07');
    });
});

describe('isCalendarDate', () => {
    it('accepts a real day and refuses the 31st of April', () => {
        expect(isCalendarDate('2028-02-29')).toBe(true);
        expect(isCalendarDate('2027-04-31')).toBe(false);
        expect(isCalendarDate('2027-4-01')).toBe(false);
    });
});
