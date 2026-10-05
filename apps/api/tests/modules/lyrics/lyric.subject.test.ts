// What a record is about: one sentence of the model's own, refused if it lifts a run of the lyric.

import { describe, expect, it } from 'vitest';

import { lyricLines, readSubject, subjectPrompt, SUBJECT_VERSION } from '../../../src/modules/lyrics/lyric.subject.js';

const lyric = "I'm so tired of playing\nPlaying with this bow and arrow\nGonna give my heart away\nLeave it to the other girls to play";

describe('readSubject', () => {
    it('keeps a sentence of the model’s own', () => {
        expect(readSubject('{"about":"A woman tired of romantic games asks to be loved as she is."}', lyric)).toEqual({
            about: 'A woman tired of romantic games asks to be loved as she is.',
        });
    });

    it('refuses a sentence that lifts six words in a row from the lyric', () => {
        expect(readSubject('{"about":"She is done playing with this bow and arrow."}', lyric)).toEqual({ refused: 'quoted-lyric' });
    });

    it('does not count a phrase shorter than the run as a quote', () => {
        expect(readSubject('{"about":"About giving my heart away, at last."}', lyric)).toEqual({ about: 'About giving my heart away, at last.' });
    });

    it('takes "could not tell" as an answer, and refuses what is not one', () => {
        expect(readSubject('{"unknown":true}', lyric)).toBe('unknown');
        expect(readSubject('It is about love.', lyric)).toEqual({ refused: 'unreadable' });
        expect(readSubject('{"about":""}', lyric)).toEqual({ refused: 'unreadable' });
    });

    it('refuses a review rather than a sentence', () => {
        expect(readSubject(`{"about":"${'word '.repeat(40)}"}`, lyric)).toEqual({ refused: 'too-long' });
    });

    it('judges a record with no lyric on its own words alone', () => {
        expect(readSubject('{"about":"An instrumental built on a looping organ figure."}', undefined)).toMatchObject({ about: expect.any(String) });
    });
});

describe('subjectPrompt', () => {
    it('never asks for the lyric back', () => {
        const [system] = subjectPrompt({ title: 'Glory Box', artist: 'Portishead' }, false);
        expect(system?.content).toContain('Never quote the lyric');
        expect(SUBJECT_VERSION).toMatch(/^s1-[0-9a-f]{12}$/);
    });

    it('asks for a sentence a presenter could say on air, naming the subject and never describing the act', () => {
        const [system] = subjectPrompt({ title: 'Glory Box', artist: 'Portishead' }, false);
        expect(system?.content).toContain('so a radio presenter could say it on air');
        expect(system?.content).toContain('never describe the act');
    });
});

describe('lyricLines', () => {
    it('splits on lines and drops blanks', () => {
        expect(lyricLines('one\n\n two \r\nthree')).toEqual(['one', 'two', 'three']);
    });
});
