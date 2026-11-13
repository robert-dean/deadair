// What a break on a festival show is told about the festival, and what it may not then say: every word
// from the stored row, nothing once the festival is over, and no date or act the row does not hold.

import { describe, expect, it } from 'vitest';

import {
    breakFestivalOf,
    festivalLines,
    festivalSlotLine,
    festivalSlotOf,
    inventedFestivalSentence,
    spokenDateRange,
    type BreakFestival,
} from '../../../src/modules/director/break.festival.js';
import { writeDecline } from '../../../src/modules/director/break.answer.guard.js';
import type { Festival } from '../../../src/modules/schedule/festival.rules.js';

const ZONE = 'America/New_York';

const FESTIVAL: Festival = {
    id: 'f1',
    name: 'Shaky Knees',
    startsOn: '2027-05-07',
    endsOn: '2027-05-09',
    place: 'Piedmont Park, Atlanta',
    acts: [
        { artist: 'Foo Fighters', headliner: true },
        { artist: 'Wet Leg', day: '2027-05-08', headliner: false },
        { artist: 'The Struts', headliner: false },
    ],
};

const at = (iso: string) => Date.parse(iso);

describe('breakFestivalOf', () => {
    it('tells a break still to come the dates, the place and who headlines', () => {
        expect(breakFestivalOf(FESTIVAL, at('2027-04-20T16:00:00Z'), ZONE)).toEqual({
            name: 'Shaky Knees',
            startsOn: '2027-05-07',
            endsOn: '2027-05-09',
            dates: 'Friday, May 7 to Sunday, May 9',
            place: 'Piedmont Park, Atlanta',
            on: false,
            headliners: ['Foo Fighters'],
            acts: ['Foo Fighters', 'Wet Leg', 'The Struts'],
        });
    });

    it('says it is on, on its days', () => {
        expect(breakFestivalOf(FESTIVAL, at('2027-05-09T20:00:00Z'), ZONE)?.on).toBe(true);
    });

    it('hands nothing once it is over where the station is, read at the instant the break is heard', () => {
        // Ten past midnight on the 10th in Atlanta: over, though it is still the 9th nowhere that matters.
        expect(breakFestivalOf(FESTIVAL, at('2027-05-10T04:10:00Z'), ZONE)).toBeUndefined();
        // Ten to midnight on the 9th in Atlanta, and already the 10th in UTC: still on.
        expect(breakFestivalOf(FESTIVAL, at('2027-05-10T03:50:00Z'), ZONE)?.on).toBe(true);
    });

    it('says a one-day festival as one day', () => {
        expect(spokenDateRange('2027-05-08', '2027-05-08')).toBe('Saturday, May 8');
    });
});

describe('festivalSlotOf', () => {
    it('finds an act on the bill whatever the spelling, with their day', () => {
        expect(festivalSlotOf(FESTIVAL, 'WET LEG')).toEqual({ day: 'Saturday, May 8' });
        expect(festivalSlotOf(FESTIVAL, 'foo fighters')).toEqual({});
    });

    it('does not find an act that is not on it', () => {
        expect(festivalSlotOf(FESTIVAL, 'Nick Drake')).toBeUndefined();
        expect(festivalSlotOf(FESTIVAL, 'Foo')).toBeUndefined();
    });
});

describe('the material', () => {
    it('says the stored facts and what not to add', () => {
        const told = breakFestivalOf(FESTIVAL, at('2027-04-20T16:00:00Z'), ZONE)!;
        const lines = festivalLines(told);

        expect(lines).toContain('Shaky Knees at Piedmont Park, Atlanta');
        expect(lines).toContain('It runs Friday, May 7 to Sunday, May 9');
        expect(lines).toContain('Headlining: Foo Fighters');
        expect(lines).toContain('Do not add set times, prices, tickets');
    });

    it("says a record's place on the bill, with the day when the bill says", () => {
        expect(festivalSlotLine('Wet Leg', 'Shaky Knees', { day: 'Saturday, May 8' })).toBe(
            '- On the bill at Shaky Knees: Wet Leg play it on Saturday, May 8',
        );
        expect(festivalSlotLine('Foo Fighters', 'Shaky Knees', {})).toBe('- On the bill at Shaky Knees: Foo Fighters play it');
    });
});

describe('inventedFestivalSentence', () => {
    const told: BreakFestival = breakFestivalOf(FESTIVAL, at('2027-04-20T16:00:00Z'), ZONE)!;

    it('lets the festival be named with its own dates', () => {
        expect(inventedFestivalSentence('Shaky Knees runs May 7 to May 9 in Piedmont Park.', told, ['Wet Leg'])).toBeUndefined();
        expect(inventedFestivalSentence('Wet Leg play Shaky Knees on May 8th.', told, ['Wet Leg'])).toBeUndefined();
    });

    it('refuses a date that is not one of its days', () => {
        expect(inventedFestivalSentence('Shaky Knees starts May 6, so get ready.', told, [])).toBe('Shaky Knees starts May 6, so get ready.');
    });

    it("refuses putting a record's artist on a bill they are not on", () => {
        const script = 'That was Nick Drake. You can catch him at Shaky Knees this spring.';
        expect(inventedFestivalSentence(script, told, ['Nick Drake'])).toBeUndefined();
        expect(inventedFestivalSentence('Nick Drake is playing Shaky Knees this spring.', told, ['Nick Drake'])).toBe(
            'Nick Drake is playing Shaky Knees this spring.',
        );
    });

    it('reads only a sentence that names the festival', () => {
        expect(inventedFestivalSentence('Nick Drake, on May 3, recorded this.', told, ['Nick Drake'])).toBeUndefined();
    });

    it('matches the name with or without a leading "the"', () => {
        const newport: BreakFestival = { ...told, name: 'the Newport Folk Festival' };
        expect(inventedFestivalSentence('Newport Folk Festival is on May 1.', newport, [])).toBe('Newport Folk Festival is on May 1.');
    });
});

describe('the guard', () => {
    const told: BreakFestival = breakFestivalOf(FESTIVAL, at('2027-04-20T16:00:00Z'), ZONE)!;

    it('refuses a break that dates the festival wrongly, and passes one that dates it right', () => {
        const guard = { festival: { told, neighbours: ['Wet Leg'] } };
        expect(writeDecline('Wet Leg there, who play Shaky Knees on May 8.', guard)).toBeUndefined();
        expect(writeDecline('Wet Leg there, who play Shaky Knees on May 12.', guard)?.fault).toBe('invented-festival');
    });
});
