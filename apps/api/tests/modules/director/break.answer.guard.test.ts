import { describe, expect, it } from 'vitest';
import { writeDecline } from '../../../src/modules/director/break.answer.guard.js';
import type { BreakTrack } from '../../../src/modules/director/break.writer.js';
import type { SpokenWeather } from '../../../src/modules/weather/weather.words.js';

describe('writeDecline, against the record a break hands over to', () => {
    const reading: SpokenWeather = {
        place: 'Atlanta',
        observedAt: '2026-11-02T07:38:00-05:00',
        units: 'imperial',
        current: { condition: 'clear', words: 'clear', temperature: 57 },
    };
    const morning = { at: Date.parse('2026-11-02T12:46:00Z'), zone: 'America/New_York' };

    it('does not read a figure out of the title of a cued record', () => {
        const next: BreakTrack = { title: 'Your Love (9PM)', artist: 'ATB' };

        expect(writeDecline("It's 57 and clear in Atlanta. ATB. Your Love (9PM).", { weather: reading, cues: { next } })).toBeUndefined();
    });

    it('still refuses a figure nobody measured beside a cued record', () => {
        const next: BreakTrack = { title: 'Your Love (9PM)', artist: 'ATB' };

        expect(writeDecline("It's 58 and clear in Atlanta. ATB. Your Love (9PM).", { weather: reading, cues: { next } })?.fault).toBe(
            'invented-figure',
        );
    });

    it('does not read the time of day out of a cued record, with its credit said in full', () => {
        const next: BreakTrack = { title: '1989 ft. The Midnight', artist: 'Nightly' };

        expect(writeDecline('And that is the way it is. Nightly, 1989 featuring The Midnight.', { moment: morning, cues: { next } })).toBeUndefined();
    });

    it('still refuses the wrong time of day outside the name of a cued record', () => {
        const next: BreakTrack = { title: '1989 ft. The Midnight', artist: 'Nightly' };

        expect(writeDecline('It is midnight here. Nightly, 1989 featuring The Midnight.', { moment: morning, cues: { next } })?.fault).toBe(
            'wrong-daypart',
        );
    });
});
