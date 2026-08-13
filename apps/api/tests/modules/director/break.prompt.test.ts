// What the station asks a model for, and what it will accept back. Everything here is about the one
// failure mode a model has that a listener hears as the station lying: naming a record that is not
// playing, or framing a real fact as a cue for one it was never given.
//
// Pure functions, so the rules can be pinned without a model. What they cannot pin is whether a
// given model obeys them — that is what `llm.captureWrites` and the script history are for.

import { describe, expect, it } from 'vitest';

import { breakPrompt, DEFAULT_MAX_WORDS, readAnswer } from '../../../src/modules/director/break.prompt.js';

const previous = { title: 'Solid Air', artist: 'John Martyn' };
const next = { title: 'Pink Moon', artist: 'Nick Drake' };

const system = (messages: ReturnType<typeof breakPrompt>) => messages.find(message => message.role === 'system')?.content ?? '';
const user = (messages: ReturnType<typeof breakPrompt>) => messages.find(message => message.role === 'user')?.content ?? '';

describe('breakPrompt', () => {
    it('is a system turn and a user turn, in that order', () => {
        const messages = breakPrompt({ kind: 'talkbreak', previous });

        expect(messages.map(message => message.role)).toEqual(['system', 'user']);
    });

    it('bans naming any record it was not given, and asks for certainty separately', () => {
        // Two rules rather than one, because they fail independently: inventing a credit and
        // mis-cueing a real record are different mistakes and a single instruction gets neither.
        const rules = system(breakPrompt({ kind: 'talkbreak', previous, next }));

        expect(rules).toMatch(/never name, cue, or allude to any other song/i);
        expect(rules).toMatch(/not certain/i);
    });

    it('shows the model both records it was given', () => {
        const said = user(breakPrompt({ kind: 'talkbreak', previous, next }));

        expect(said).toContain('Solid Air');
        expect(said).toContain('John Martyn');
        expect(said).toContain('Pink Moon');
        expect(said).toContain('Nick Drake');
    });

    it('says outright that there is no next record when there is not', () => {
        // A model handed one record will reach for a second. The caller withheld the next one
        // because it could not be trusted, and silence about that is not the same as saying so.
        const said = user(breakPrompt({ kind: 'talkbreak', previous }));

        expect(said).toMatch(/do not say what is coming up/i);
        expect(said).not.toContain('Pink Moon');
    });

    it('does not claim there is no next record when there is one', () => {
        const said = user(breakPrompt({ kind: 'talkbreak', previous, next }));

        expect(said).not.toMatch(/do not say what is coming up/i);
    });

    it('gives the model something true to do when it has no records at all', () => {
        const said = user(breakPrompt({ kind: 'talkbreak', station: 'Deadair' }));

        expect(said).toMatch(/no records to talk about/i);
    });

    it('passes the recent scripts through as an avoid-list', () => {
        const said = user(breakPrompt({ kind: 'talkbreak', previous, recent: ['That was Solid Air.'] }));

        expect(said).toContain('That was Solid Air.');
        expect(said).toMatch(/do not reuse/i);
    });

    it('states the length as words and as seconds', () => {
        // A model reasons about a spoken length better than about a count; the count is what can
        // actually be checked afterwards.
        const rules = system(breakPrompt({ kind: 'talkbreak', previous }, { maxWords: 26 }));

        expect(rules).toContain('26 words');
        expect(rules).toMatch(/10 seconds/);
    });

    it('carries the station, the presenter and the persona when they are set', () => {
        const rules = system(
            breakPrompt({ kind: 'talkbreak', previous }, { station: 'Deadair', dj: 'Sam', persona: 'Dry, never smug, no exclamation marks.' }),
        );

        expect(rules).toContain('Deadair');
        expect(rules).toContain('Sam');
        expect(rules).toContain('Dry, never smug');
    });

    it('says nothing about a presenter or a persona nobody has set', () => {
        const rules = system(breakPrompt({ kind: 'talkbreak', previous }));

        expect(rules).not.toMatch(/your name is\s*[,.]/i);
        expect(rules).not.toMatch(/describes its presenter/i);
    });

    describe('the notes', () => {
        const withFacts = { ...previous, facts: ['John Martyn was born in New Malden in 1948.'] };

        it('puts a record’s notes under that record and nowhere else', () => {
            const said = user(breakPrompt({ kind: 'talkbreak', previous: withFacts, next }));

            expect(said).toMatch(/Artist: John Martyn\n- Notes:\n {2}- John Martyn was born in New Malden in 1948\./);
            // The record with nothing known about it is shown exactly as it was before.
            expect(said).toMatch(/Artist: Nick Drake(\n\n|$)/);
        });

        it('says what the notes are for, so they are not read out as they stand', () => {
            // The second failure the notes bring: a model handed "Active as a recording artist from
            // 1948 to 2025" will say it, and that is a database entry rather than something a
            // person says. Wanted rather than required, and never a licence to cue.
            const said = user(breakPrompt({ kind: 'talkbreak', previous: withFacts }));

            expect(said).toMatch(/raw material, not lines to read out/i);
            expect(said).toMatch(/at most one/i);
            expect(said).toMatch(/never something to cue or play/i);
            // And it does NOT take back the cue the model is allowed to make: it was given the next
            // record precisely so it could name it, and the caller withholds it when it may not.
            expect(user(breakPrompt({ kind: 'talkbreak', previous: withFacts, next }))).not.toMatch(/do not say what is coming up/i);
        });

        it('says none of that for a station that knows nothing about either record', () => {
            // Every break on a fresh install. A rule about notes that do not exist is a rule about
            // nothing, and it costs the model tokens to read.
            const said = user(breakPrompt({ kind: 'talkbreak', previous, next }));

            expect(said).not.toMatch(/notes/i);
            expect(said).not.toMatch(/raw material/i);
        });

        it('treats an empty list as nothing known, rather than as an empty heading', () => {
            const said = user(breakPrompt({ kind: 'talkbreak', previous: { ...previous, facts: [] } }));

            expect(said).not.toMatch(/notes/i);
        });
    });
});

describe('readAnswer', () => {
    it('takes an ordinary answer as it is', () => {
        expect(readAnswer('That was Solid Air, from John Martyn.')).toBe('That was Solid Air, from John Martyn.');
    });

    it('unwraps a script the model put in quotation marks', () => {
        expect(readAnswer('"That was Solid Air."')).toBe('That was Solid Air.');
        expect(readAnswer('“That was Solid Air.”')).toBe('That was Solid Air.');
    });

    it('leaves a quotation INSIDE a script alone', () => {
        // The station quoting a lyric is a script; the model quoting itself is not. Only a pair
        // wrapping the whole thing is the second one.
        expect(readAnswer('He called it "the best thing I ever wrote".')).toBe('He called it "the best thing I ever wrote".');
    });

    it('drops a speaker label', () => {
        expect(readAnswer('DJ: That was Solid Air.')).toBe('That was Solid Air.');
        expect(readAnswer('Host: That was Solid Air.')).toBe('That was Solid Air.');
    });

    it('drops stage directions wherever they are', () => {
        expect(readAnswer('[warmly] That was Solid Air. *sighs*')).toBe('That was Solid Air.');
        expect(readAnswer('That was Solid Air. (laughs) Lovely.')).toBe('That was Solid Air. Lovely.');
    });

    it('keeps a parenthetical that is part of the sentence', () => {
        expect(readAnswer('That was Solid Air (the title track), from John Martyn.')).toBe('That was Solid Air (the title track), from John Martyn.');
    });

    it('takes what follows a reasoning model thinking out loud', () => {
        expect(readAnswer('<think>I should mention both records</think>That was Solid Air.')).toBe('That was Solid Air.');
    });

    it('declines an answer that is nothing but furniture', () => {
        expect(readAnswer('   ')).toBeUndefined();
        expect(readAnswer('[silence]')).toBeUndefined();
    });

    it('declines an answer that ran long rather than cutting it mid-sentence', () => {
        // A cut script is a worse thing to air than the floor's correct line, and a model that has
        // run this long has usually misunderstood the job rather than merely overshot.
        const rambling = Array.from({ length: DEFAULT_MAX_WORDS + 5 }, () => 'word').join(' ');

        expect(readAnswer(rambling)).toBeUndefined();
    });

    it('accepts an answer right at the ceiling', () => {
        const exact = Array.from({ length: DEFAULT_MAX_WORDS }, () => 'word').join(' ');

        expect(readAnswer(exact)).toBe(exact);
    });
});
