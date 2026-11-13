import { describe, expect, it } from 'vitest';
import { readAnswer, unshownRecordIn, writeDecline } from '../../../src/modules/director/break.answer.guard.js';
import { unshownGuard } from '../../../src/modules/director/unshown.records.js';
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

    it("does not take last week's chart position for a temperature", () => {
        const next: BreakTrack = { title: 'Glory Box', artist: 'Portishead', chart: { rank: 3, name: 'Top 40', lastWeek: 12 } };

        expect(
            writeDecline("It's 57 and clear in Atlanta. Up from number 12, at number 3, Portishead, Glory Box.", {
                weather: reading,
                cues: { next },
                names: [next],
            }),
        ).toBeUndefined();
        expect(
            writeDecline("It's 57 and clear in Atlanta. Up from number 14, at number 3, Portishead, Glory Box.", {
                weather: reading,
                cues: { next },
                names: [next],
            })?.fault,
        ).toBe('invented-figure');
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

// A news, weather or welcome break handing over to a record an earlier break named. Strict on
// purpose: title AND artist, because this refuses a script rather than asking whether it named its own.
describe('unshownRecordIn', () => {
    const abba = { title: 'Gimme! Gimme! Gimme! (A Man After Midnight)', artist: 'ABBA' };
    const rain = { title: 'Rain', artist: 'The Beatles' };

    it('finds a German hand-back to a record the break was not given', () => {
        expect(unshownRecordIn('Und jetzt geht es weiter mit ABBA und Gimme! Gimme! Gimme!', [abba, rain], 'de')).toBe(abba);
        expect(unshownRecordIn("Next up, ABBA's Gimme! Gimme! Gimme!", [abba])).toBe(abba);
    });

    it('lets a title or an artist alone go by, which is a word in a forecast or a name in passing', () => {
        expect(unshownRecordIn('Rain this afternoon, clearing by six.', [rain])).toBeUndefined();
        expect(unshownRecordIn('Fans of ABBA will like this one.', [abba])).toBeUndefined();
    });

    it('answers nothing with nothing to look for', () => {
        expect(unshownRecordIn('Und jetzt: ABBA mit Gimme! Gimme! Gimme!', [])).toBeUndefined();
    });
});

describe('a guard carrying the records a break was not given', () => {
    const guard = {
        unshown: [{ title: 'Gimme! Gimme! Gimme!', artist: 'ABBA' }],
        cues: { next: { title: 'Hells Bells', artist: 'AC/DC' } },
        language: 'de',
    };

    it('refuses the stale hand-back in both orders, with the record it named', () => {
        const stale = 'Das Wetter: drei Grad und bewölkt. Und jetzt: ABBA mit Gimme! Gimme! Gimme!';

        expect(readAnswer(stale, guard)).toBeUndefined();
        expect(writeDecline(stale, guard)).toMatchObject({ fault: 'unshown-record' });
        expect(writeDecline(stale, guard)?.reason).toContain('Gimme! Gimme! Gimme!');
    });

    it('airs the hand-back to the record it was given', () => {
        const right = 'Das Wetter: drei Grad und bewölkt. Und jetzt: AC/DC mit Hells Bells.';

        expect(readAnswer(right, guard)).toBe(right);
        expect(writeDecline(right, guard)).toBeUndefined();
    });
});

describe('unshownGuard', () => {
    const abba = { title: 'Gimme! Gimme! Gimme!', artist: 'ABBA' };
    const falco = { title: 'Jeanny', artist: 'Falco' };

    it('asks nothing of a break with nothing recent to refuse', () => {
        expect(unshownGuard({})).toEqual({});
        expect(unshownGuard({ lately: [] })).toEqual({});
    });

    it('leaves out a record the break’s own stories name, since reporting it is the news', () => {
        expect(unshownGuard({ lately: [abba, falco], stories: [{ headline: 'ABBA reissue Gimme! Gimme! Gimme!' }] })).toEqual({ unshown: [falco] });
        expect(
            unshownGuard({ lately: [abba], stories: [{ headline: 'Bridge reopens.', body: 'ABBA played Gimme! Gimme! Gimme! at the opening.' }] }),
        ).toEqual({});
    });

    it('keeps every record for a break with no stories', () => {
        expect(unshownGuard({ lately: [abba, falco] })).toEqual({ unshown: [abba, falco] });
    });
});

describe('readAnswer and the reactions a break was offered', () => {
    const script = 'That one was a lot. [sigh] Here is the next record.';

    it('keeps a presenter reaction when the guard names none, as every guard did before', () => {
        expect(readAnswer(script, {})).toContain('[sigh]');
    });

    it('trims a reaction the break was not offered, rather than letting the engine perform it', () => {
        const kept = readAnswer(script, { reactions: [] });
        expect(kept).not.toContain('[sigh]');
        expect(kept).toContain('Here is the next record.');
    });

    it('keeps one it was offered', () => {
        expect(readAnswer(script, { reactions: ['sigh'] })).toContain('[sigh]');
    });
});
