// What the station asks a model for, and what it will accept back. Everything here is about the one
// failure mode a model has that a listener hears as the station lying: naming a record that is not
// playing, or framing a real fact as a cue for one it was never given.
//
// Pure functions, so the rules can be pinned without a model. What they cannot pin is whether a
// given model obeys them — that is what `llm.captureWrites` and the script history are for.

import { describe, expect, it } from 'vitest';

import { breakPrompt, DEFAULT_MAX_WORDS, readAnswer, TALK_BREAK_SHAPE, type PromptSettings } from '../../../src/modules/director/break.prompt.js';
import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';

const previous = { title: 'Solid Air', artist: 'John Martyn' };
const next = { title: 'Pink Moon', artist: 'Nick Drake' };

/**
 * The talk break's shape, since these cases are about the rules EVERY kind owes rather than about
 * what makes one kind different. A shape is named explicitly here for the same reason there is no
 * default in `breakPrompt` itself: a kind that forgot to bring one would silently be written as an
 * ordinary link between two records.
 */
const prompt = (request: BreakWriteRequest, settings: PromptSettings = {}) => breakPrompt(request, settings, TALK_BREAK_SHAPE);

const system = (messages: ReturnType<typeof prompt>) => messages.find(message => message.role === 'system')?.content ?? '';
const user = (messages: ReturnType<typeof prompt>) => messages.find(message => message.role === 'user')?.content ?? '';

describe('breakPrompt', () => {
    it('is a system turn and a user turn, in that order', () => {
        const messages = prompt({ kind: 'talkbreak', previous });

        expect(messages.map(message => message.role)).toEqual(['system', 'user']);
    });

    it('bans naming any record it was not given, and asks for certainty separately', () => {
        // Two rules rather than one, because they fail independently: inventing a credit and
        // mis-cueing a real record are different mistakes and a single instruction gets neither.
        const rules = system(prompt({ kind: 'talkbreak', previous, next }));

        expect(rules).toMatch(/never name, cue, or allude to any other song/i);
        expect(rules).toMatch(/not certain/i);
    });

    it('shows the model both records it was given', () => {
        const said = user(prompt({ kind: 'talkbreak', previous, next }));

        expect(said).toContain('Solid Air');
        expect(said).toContain('John Martyn');
        expect(said).toContain('Pink Moon');
        expect(said).toContain('Nick Drake');
    });

    it('says outright that there is no next record when there is not', () => {
        // A model handed one record will reach for a second. The caller withheld the next one
        // because it could not be trusted, and silence about that is not the same as saying so.
        const said = user(prompt({ kind: 'talkbreak', previous }));

        expect(said).toMatch(/do not say what is coming up/i);
        expect(said).not.toContain('Pink Moon');
    });

    it('does not claim there is no next record when there is one', () => {
        const said = user(prompt({ kind: 'talkbreak', previous, next }));

        expect(said).not.toMatch(/do not say what is coming up/i);
    });

    it('gives the model something true to do when it has no records at all', () => {
        const said = user(prompt({ kind: 'talkbreak', station: 'Deadair' }));

        expect(said).toMatch(/no records to talk about/i);
    });

    it('passes the recent scripts through as an avoid-list', () => {
        const said = user(prompt({ kind: 'talkbreak', previous, recent: ['That was Solid Air.'] }));

        expect(said).toContain('That was Solid Air.');
        expect(said).toMatch(/do not reuse/i);
    });

    describe('a signature the station has already used', () => {
        const persona = { style: 'a pirate', catchphrases: ['Arrr, and there it goes', 'Make of that what you will'] };

        // The half of "at most one, and not every time" that had nothing behind it. It is in the
        // user turn because which signatures are spent is a fact about tonight, where the sheet is
        // who the station is — and `readAnswer` refuses a script that ignores it.
        it('names the spent one and asks for a new line rather than only forbidding the old', () => {
            const recent = ['Aye. Arrr, and there it goes.'];
            const said = user(prompt({ kind: 'talkbreak', previous, recent }, { persona }));

            expect(said).toContain('You have already said "Arrr, and there it goes" recently');
            expect(said).toMatch(/make up a new one of your own/i);
            // The one it has NOT spent stays available, and is not named here as though it were.
            expect(said).not.toContain('You have already said "Make of that what you will"');
        });

        it('says nothing about signatures the station has not used, because that is a rule about nothing', () => {
            const said = user(prompt({ kind: 'talkbreak', previous, recent: ['That was Solid Air.'] }, { persona }));

            expect(said).not.toMatch(/already said/i);
        });
    });

    it('states the length as words and as seconds', () => {
        // A model reasons about a spoken length better than about a count; the count is what can
        // actually be checked afterwards.
        const rules = system(prompt({ kind: 'talkbreak', previous }, { maxWords: 26 }));

        expect(rules).toContain('26 words');
        expect(rules).toMatch(/10 seconds/);
    });

    it('carries the station, the presenter and the persona when they are set', () => {
        const rules = system(
            prompt(
                { kind: 'talkbreak', previous },
                { station: 'Deadair', dj: 'Sam', persona: { style: 'a dry crate-digger', quirks: ['Never smug'], catchphrases: ['Worth the dig'] } },
            ),
        );

        expect(rules).toContain('Deadair');
        expect(rules).toContain('Sam');
        expect(rules).toContain('a dry crate-digger');
        expect(rules).toContain('Never smug');
        expect(rules).toContain('Worth the dig');
    });

    it('replaces the station-voice role sentence rather than saying both', () => {
        // A model handed "you are the voice of a radio station" AND "you are a pirate captain"
        // hedges between them. The persona takes the slot; it does not queue behind it.
        const rules = system(prompt({ kind: 'talkbreak', previous }, { persona: { style: 'a pirate captain' } }));

        expect(rules).toContain('You are a pirate captain');
        expect(rules).not.toContain('You are the voice of a radio station');
    });

    it('restates the dialect AFTER the content rules, which is the whole reason it exists', () => {
        // The failure is caused by the rules: a host reads seven careful instructions about naming
        // records accurately and answers them in careful, plain English.
        const rules = system(prompt({ kind: 'talkbreak', previous }, { persona: { style: 'a pirate captain', diction: ['Ye for you'] } }));

        expect(rules.indexOf('Plain English is wrong here')).toBeGreaterThan(rules.indexOf('Only ever refer to the records listed below'));
    });

    it('says nothing about a presenter or a persona nobody has set', () => {
        const rules = system(prompt({ kind: 'talkbreak', previous }));

        expect(rules).not.toMatch(/your name is\s*[,.]/i);
        expect(rules).not.toMatch(/describes its presenter/i);
    });

    describe('the notes', () => {
        const withFacts = { ...previous, facts: ['John Martyn was born in New Malden in 1948.'] };

        it('puts a record’s notes under that record and nowhere else', () => {
            const said = user(prompt({ kind: 'talkbreak', previous: withFacts, next }));

            expect(said).toMatch(/Artist: John Martyn\n- Notes:\n {2}- John Martyn was born in New Malden in 1948\./);
            // The record with nothing known about it is shown exactly as it was before.
            expect(said).toMatch(/Artist: Nick Drake(\n\n|$)/);
        });

        it('says what the notes are for, so they are not read out as they stand', () => {
            // The second failure the notes bring: a model handed "Active as a recording artist from
            // 1948 to 2025" will say it, and that is a database entry rather than something a
            // person says. Wanted rather than required, and never a licence to cue.
            const said = user(prompt({ kind: 'talkbreak', previous: withFacts }));

            expect(said).toMatch(/raw material, not lines to read out/i);
            expect(said).toMatch(/at most one/i);
            expect(said).toMatch(/never something to cue or play/i);
            // And it does NOT take back the cue the model is allowed to make: it was given the next
            // record precisely so it could name it, and the caller withholds it when it may not.
            expect(user(prompt({ kind: 'talkbreak', previous: withFacts, next }))).not.toMatch(/do not say what is coming up/i);
        });

        it('says none of that for a station that knows nothing about either record', () => {
            // Every break on a fresh install. A rule about notes that do not exist is a rule about
            // nothing, and it costs the model tokens to read.
            const said = user(prompt({ kind: 'talkbreak', previous, next }));

            expect(said).not.toMatch(/notes/i);
            expect(said).not.toMatch(/raw material/i);
        });

        it('treats an empty list as nothing known, rather than as an empty heading', () => {
            const said = user(prompt({ kind: 'talkbreak', previous: { ...previous, facts: [] } }));

            expect(said).not.toMatch(/notes/i);
        });
    });

    // What a KIND may change, and what it may not. The shared half is everything that keeps a break
    // truthful, and no shape can opt out of it.
    describe('the stories, for a break that reports', () => {
        const stories = [
            { headline: 'Bridge reopens after four years.', summary: 'It reopened this morning.' },
            { headline: 'Council votes and adjourns.' },
        ];

        it('lists them in the order they were given', () => {
            const said = user(prompt({ kind: 'news', stories }));

            expect(said).toContain('Bridge reopens after four years.');
            expect(said.indexOf('Bridge reopens')).toBeLessThan(said.indexOf('Council votes'));
        });

        it('offers a summary as background rather than as a line to read out', () => {
            const said = user(prompt({ kind: 'news', stories }));

            expect(said).toContain('Background: It reopened this morning.');
            expect(said).toMatch(/not as lines to read out/i);
        });

        it('bans the ways a model gets news wrong: adding, explaining, predicting, merging', () => {
            const said = user(prompt({ kind: 'news', stories }));

            expect(said).toMatch(/do not add detail/i);
            expect(said).toMatch(/do not explain what it means/i);
            expect(said).toMatch(/do not say what will happen next/i);
            expect(said).toMatch(/do not merge two stories/i);
        });

        it('says nothing about stories for a break that has none, because a rule about nothing is noise', () => {
            const said = user(prompt({ kind: 'talkbreak', previous, next }));

            expect(said).not.toMatch(/Read these as news/i);
        });

        it('does not offer the publisher as something to credit', () => {
            const said = user(prompt({ kind: 'news', stories: [{ headline: 'Bridge reopens.', source: 'World news' }] }));

            expect(said).not.toContain('World news');
        });
    });

    describe('a kind bringing its own shape', () => {
        const greeting = {
            job: 'You greet somebody who has just tuned in.',
            showsPrevious: false,
            opening: () => 'Somebody has just started listening.',
        };

        it('says what this sort of break is, in place of the link sentence', () => {
            const rules = system(breakPrompt({ kind: 'welcome', previous, next }, {}, greeting));

            expect(rules).toContain('You greet somebody who has just tuned in.');
            expect(rules).not.toContain('one short spoken link between records');
        });

        it('withholds the record just finished rather than asking the model to ignore it', () => {
            // Shown and forbidden is an invitation: a model handed a record will find a way to cue
            // it, which for a greeting means cueing something the listener never heard.
            const said = user(breakPrompt({ kind: 'welcome', previous, next }, {}, greeting));

            expect(said).toContain('Somebody has just started listening.');
            expect(said).not.toContain(previous.title);
            expect(said).toContain(next.title);
        });

        it('keeps every rule a break owes whatever it is', () => {
            const rules = system(breakPrompt({ kind: 'welcome', next }, {}, greeting));

            expect(rules).toMatch(/Only ever refer to the records listed below/);
            expect(rules).toMatch(/Write only the words to be spoken/);
            expect(rules).toMatch(new RegExp(`under ${DEFAULT_MAX_WORDS} words`));
        });
    });
});

describe('readAnswer, against a persona', () => {
    const pirate = { dictionMarkers: ['ye', 'aye', 'matey', "in'", 'hearty'] };

    it('declines a good line that came back in plain English', () => {
        // The one failure a sheet's diction is asked for, and the one a model handed a page of
        // content rules actually makes. The floor underneath speaks in the same character, so
        // declining costs the station nothing.
        expect(readAnswer('That was Solid Air, from John Martyn.', { persona: pirate })).toBeUndefined();
    });

    it('takes one that stayed in dialect', () => {
        const script = "Aye, ye just heard Solid Air, and there be more comin'.";

        expect(readAnswer(script, { persona: pirate })).toBe(script);
    });

    it('accepts anything from a sheet that named no markers, which made no checkable claim', () => {
        expect(readAnswer('That was Solid Air.', { persona: { diction: ['Ye for you'] } })).toBe('That was Solid Air.');
    });

    // A pasted signature is the evidence the marker check counts, so a break that was plain English
    // plus a quoted sign-off passed every time. See `characterFault`.
    it('declines a signature the station has just used, and takes the same one when it has not', () => {
        const sheet = { ...pirate, catchphrases: ['Arrr, and there it goes'] };
        const script = 'Ye just heard Solid Air. Arrr, and there it goes.';

        expect(readAnswer(script, { persona: sheet, recent: ['Aye. Arrr, and there it goes.'] })).toBeUndefined();
        expect(readAnswer(script, { persona: sheet, recent: ['Aye, that were Pink Moon, matey.'] })).toBe(script);
    });

    it('declines a line lifted out of the sheet’s own examples', () => {
        const sheet = { ...pirate, samples: ['Aye, ye just heard the best thing on this ship all night.'] };

        expect(readAnswer('Aye, ye just heard the best thing on this ship all night.', { persona: sheet })).toBeUndefined();
    });

    it('declines wording the sheet forbids, which was sent on every prompt and read back on none', () => {
        const sheet = { ...pirate, avoid: ['buckle up'] };

        expect(readAnswer('Aye, matey — buckle up.', { persona: sheet })).toBeUndefined();
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
