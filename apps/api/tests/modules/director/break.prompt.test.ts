// What the station asks a model for, and what it will accept back. Everything here is about the one
// failure mode a model has that a listener hears as the station lying: naming a record that is not
// playing, or framing a real fact as a cue for one it was never given.
//
// Pure functions, so the rules can be pinned without a model. What they cannot pin is whether a
// given model obeys them — that is what `llm.captureWrites` and the script history are for.

import { describe, expect, it } from 'vitest';

import {
    breakPrompt,
    DEFAULT_MAX_WORDS,
    readAnswer,
    TALK_BREAK_SHAPE,
    writeDecline,
    type PromptSettings,
} from '../../../src/modules/director/break.prompt.js';
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

    it('asks for one point, and says what the words that buys are for', () => {
        // Both halves, because asking for less was only half a rule: every other instruction in this
        // prompt points downwards, and the captured breaks came in at half the ceiling with nothing
        // telling the model what the other half was for.
        const rules = system(prompt({ kind: 'talkbreak', previous, next }));

        expect(rules).toMatch(/Make one point/);
        expect(rules).toMatch(/yours to spend on saying it like yourself/);
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

        expect(said).toMatch(/not been given a record/i);
        expect(said).toMatch(/identifies the station and nothing more/i);
    });

    it('forbids a record from an earlier break when it was given none of its own', () => {
        // The observed failure and the reason this rule is keyed on the records rather than on the
        // prompt being otherwise empty: shown no record and a list of recent scripts, a model takes
        // the list as material. A welcome went out in front of one record talking about another,
        // lifted from the break above it.
        const said = user(prompt({ kind: 'talkbreak', recent: ['Agent Orange has a track about an AC-47.'] }));

        expect(said).toMatch(/not one that appears in anything you said earlier/i);
    });

    it('still says so when a shape opened the turn with something of its own', () => {
        // The bug itself: this used to be keyed on `parts` being empty, so any shape carrying an
        // `opening` — which is every welcome — silently skipped the one rule holding it to the
        // records it was actually given.
        const withOpening = breakPrompt({ kind: 'welcome' }, {}, { ...TALK_BREAK_SHAPE, opening: () => 'Somebody has just tuned in.' });

        expect(user(withOpening)).toMatch(/not been given a record/i);
    });

    it('does not tell a bulletin to say nothing but the station name', () => {
        // A bulletin has no records either and has stories to read: the identify-the-station half
        // would be telling it not to do its job.
        const said = user(prompt({ kind: 'news', stories: [{ headline: 'A thing happened' }] }));

        expect(said).toMatch(/not been given a record/i);
        expect(said).not.toMatch(/identifies the station and nothing more/i);
    });

    it('passes the recent scripts through as an avoid-list', () => {
        const said = user(prompt({ kind: 'talkbreak', previous, recent: ['That was Solid Air.'] }));

        expect(said).toContain('That was Solid Air.');
        expect(said).toMatch(/do not reuse/i);
    });

    // "Do not reuse their opening" sat over the list above for as long as the list existed, and nine
    // consecutive breaks opened with the same word anyway. Naming them is the same move the spent
    // signatures make one block down, and the reason that one lands.
    describe('the openings the station has just used', () => {
        it('names them and asks for a different run-up', () => {
            const said = user(
                prompt({
                    kind: 'talkbreak',
                    previous,
                    recent: ['Yikes! Solid Air just landed.', 'Deadair’s next spin is Pink Moon.'],
                }),
            );

            expect(said).toContain('"Yikes"');
            expect(said).toContain('"Deadair’s next spin is"');
            expect(said).toMatch(/start this one somewhere else/i);
        });

        it('counts one habit once, however it was punctuated', () => {
            const said = user(prompt({ kind: 'talkbreak', previous, recent: ['Yikes! One.', 'yikes, two.', 'Yikes — three.'] }));

            expect(said.match(/"Yikes"/g)).toHaveLength(1);
        });

        it('says nothing when there is nothing behind the station', () => {
            expect(user(prompt({ kind: 'talkbreak', previous }))).not.toMatch(/start this one somewhere else/i);
        });
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

    // The room for a character is not at the end of the break, it is in what the break does not
    // have to say. Measured on this station: only 2 of 137 answers reached the word ceiling and the
    // median came in at 28, so the ceiling was never what bounded a break — what it spent those 28
    // words on was, and it spent them on both titles, both artists and a note read out.
    describe('leaving the character somewhere to live', () => {
        it('asks for one point rather than everything it was shown', () => {
            expect(system(prompt({ kind: 'talkbreak', previous, next }))).toMatch(/make one point/i);
        });

        // On the shape rather than in the shared list, because it is true of a link between two
        // records and false of a bulletin: a news writer reading "make one point" has been handed a
        // licence to drop two of its three stories.
        it('keeps a kind’s own rule off the kinds that do not owe it', () => {
            const bulletin = { job: 'You read the news.', showsPrevious: false };

            expect(system(breakPrompt({ kind: 'news', next }, {}, bulletin))).not.toMatch(/make one point/i);
        });

        // The other half of the same doctrine, pointed at the shape of the break rather than its
        // length. Measured over 45 captured breaks: almost every one was "X by Y drops next" with a
        // fact bolted on, which is the most correct thing a model can write when every instruction
        // it has describes a break in terms of the two records.
        it('asks for a reaction rather than an announcement', () => {
            const said = system(prompt({ kind: 'talkbreak', previous, next }));

            expect(said).toMatch(/talk, do not announce/i);
            expect(said).toMatch(/naming the record is not the break/i);
        });

        // The correction to the rule above, and the reason it needed one. "Naming them is the least
        // useful thing you can do" was the whole instruction, and a model reading it stopped naming
        // them: roughly three quarters of thirty-nine consecutive breaks named neither record.
        it('still asks for the record to be named, which the announcement rule once talked it out of', () => {
            const said = system(prompt({ kind: 'talkbreak', previous, next }));

            expect(said).toMatch(/name a record/i);
            expect(said).toMatch(/say its title, or who it is by/i);
            // And the ask comes before the caveat, so the caveat reads as qualifying it.
            expect(said.indexOf('Name a record')).toBeLessThan(said.indexOf('Talk, do not announce'));
        });

        it('keeps that off a kind that is not linking two records', () => {
            const bulletin = { job: 'You read the news.', showsPrevious: false };

            expect(system(breakPrompt({ kind: 'news', next }, {}, bulletin))).not.toMatch(/talk, do not announce/i);
        });

        it('lets a break hand over one record when it was shown two', () => {
            const said = user(prompt({ kind: 'talkbreak', previous, next }));

            expect(said).toMatch(/do not have to mention both records/i);
        });

        it('says nothing of the sort when there is only one record to talk about', () => {
            // A rule about choosing between two records is noise when there is one, and the top of
            // an order is every station's first break.
            expect(user(prompt({ kind: 'talkbreak', next }))).not.toMatch(/both records/i);
            expect(user(prompt({ kind: 'talkbreak', previous }))).not.toMatch(/both records/i);
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
            // person says. Never a licence to cue, either.
            const said = user(prompt({ kind: 'talkbreak', previous: withFacts }));

            expect(said).toMatch(/never read out as it stands/i);
            expect(said).toMatch(/never more than one/i);
            expect(said).toMatch(/never something to cue or play/i);
            // And it does NOT take back the cue the model is allowed to make: it was given the next
            // record precisely so it could name it, and the caller withholds it when it may not.
            expect(user(prompt({ kind: 'talkbreak', previous: withFacts, next }))).not.toMatch(/do not say what is coming up/i);
        });

        // "Work at most one of them in" was read as an instruction to work one in, and notes reached
        // 108 of 137 captured prompts: the answers recited dates and credits, which at 28 words is a
        // third of the break spent on the part no listener needed.
        it('offers the notes rather than asking for one', () => {
            const said = user(prompt({ kind: 'talkbreak', previous: withFacts }));

            expect(said).toMatch(/you do not have to use any of them/i);
            expect(said).toMatch(/most breaks are better without one/i);
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

    // The show behind the current record. Every assertion here is really about one risk: a list is
    // the one shape a model will simply read out, which is the failure "make one point" exists to
    // stop and the same one the notes rule above was rewritten for.
    describe('what the broadcast has already played', () => {
        const played = [
            { title: 'Yeah!', artist: 'USHER' },
            { title: 'One More Time', artist: 'Daft Punk' },
        ];

        it('shows them newest first, as title and lead artist', () => {
            const said = user(prompt({ kind: 'talkbreak', previous, next, played }));

            expect(said).toMatch(/Earlier in the show you played these, most recent first:/);
            expect(said).toMatch(/- Yeah! by USHER\n- One More Time by Daft Punk/);
        });

        it('offers them rather than asking for one, and says what they are for', () => {
            const said = user(prompt({ kind: 'talkbreak', previous, played }));

            expect(said).toMatch(/not a list to get through/i);
            expect(said).toMatch(/you do not have to mention any of them/i);
            // The positive half: without it a model is handed material and told only what not to do
            // with it, which is how the notes rule failed the first time.
            expect(said).toMatch(/only if you have something to say about it/i);
        });

        it('says nothing at all when the broadcast has played nothing yet', () => {
            // The first break of a show, and every break on a station whose history read failed.
            expect(user(prompt({ kind: 'talkbreak', previous, next }))).not.toMatch(/earlier in the show/i);
            expect(user(prompt({ kind: 'talkbreak', previous, played: [] }))).not.toMatch(/earlier in the show/i);
        });

        // A kind opts in, and the two that do not are the interesting half. A welcome is for somebody
        // who heard none of it — the same reason it withholds the record that just finished — and a
        // bulletin handed a list of records will find a way to read it out.
        it('is withheld from a kind whose shape did not ask for it', () => {
            const quiet = { ...TALK_BREAK_SHAPE, showsPlayed: false };
            const said = user(breakPrompt({ kind: 'welcome', previous, played }, {}, quiet));

            expect(said).not.toMatch(/earlier in the show/i);
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

        it("offers the publisher's words as the story rather than as a line to read out", () => {
            const said = user(prompt({ kind: 'news', stories }));

            expect(said).toContain('Story: It reopened this morning.');
            expect(said).toMatch(/not as lines to read out/i);
        });

        // The whole point of the article half: a bulletin written from headlines alone is a list of
        // titles, which is what it was.
        it('asks for a sentence of what happened rather than only the headline', () => {
            const said = user(prompt({ kind: 'news', stories }));

            expect(said).toMatch(/a sentence of what actually happened/i);
        });

        // They overlap almost entirely — a teaser is usually the article's own first sentence — and
        // showing a model one fact twice under two labels is how it gets read out as two stories.
        it('shows the article where there is one and the teaser otherwise, never both', () => {
            const said = user(
                prompt({
                    kind: 'news',
                    stories: [{ headline: 'Bridge reopens.', summary: 'A teaser nobody needs.', body: 'The council voted at dawn.' }],
                }),
            );

            expect(said).toContain('Story: The council voted at dawn.');
            expect(said).not.toContain('A teaser nobody needs.');
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

    describe('what half of the day it is', () => {
        const morning = { words: 'this morning', validFrom: 0, validUntil: 1 };

        it('says nothing when the moment did not know', () => {
            // Every break whose row carries no `airsAt`, which is an ordinary state rather than a
            // gap. A prompt that guessed would be guessing about the one thing it is here to pin.
            expect(user(prompt({ kind: 'talkbreak', previous }))).not.toMatch(/where your listener is/);
        });

        it('tells the presenter which half of the day it is', () => {
            // `clock` is twelve-hour with no am or pm on purpose, so this is the half a model does
            // not otherwise have. Twelve of thirty-nine breaks written on a morning opened "Tonight".
            const said = user(prompt({ kind: 'talkbreak', previous, dayPart: morning }));

            expect(said).toContain('It is this morning where your listener is');
        });

        it('forbids the other parts of the day rather than only naming this one', () => {
            // The negative half is the one that was missing. A model told only that it is morning
            // has been given a fact; told not to call it anything else, it has been given a rule.
            expect(user(prompt({ kind: 'talkbreak', previous, dayPart: morning }))).toMatch(/do not call it any other part of the day/i);
        });

        it('comes before the clock, so the coarse fact frames the exact one', () => {
            const said = user(prompt({ kind: 'talkbreak', previous, dayPart: morning, clock: { ...morning, words: 'just after nine' } }));

            expect(said.indexOf('this morning')).toBeLessThan(said.indexOf('just after nine'));
        });
    });

    describe('a station that has to stay clean', () => {
        it('says nothing about language when the station has no such policy', () => {
            expect(system(prompt({ kind: 'talkbreak', previous }))).not.toMatch(/broadcast-clean/i);
        });

        it('tells the presenter both halves, since they fail independently', () => {
            // A model told only not to swear will still quote an explicit title or lyric back, which
            // is the same words arriving by a route the first half does not cover.
            const rules = system(prompt({ kind: 'talkbreak', previous }, { cleanLanguage: true }));

            expect(rules).toMatch(/broadcast-clean/i);
            expect(rules).toMatch(/profanity/i);
            expect(rules).toMatch(/explicit lyric or title/i);
        });

        it('keeps it among the standing rules rather than after the persona reminder', () => {
            // The diction reminder is last on purpose, because the failure it addresses is caused BY
            // the rules. A content rule appended after it would take that position away.
            const rules = system(
                prompt(
                    { kind: 'talkbreak', previous },
                    { cleanLanguage: true, persona: { style: 'a pirate captain', diction: ['nautical'], dictionMarkers: ['arr'] } },
                ),
            );

            expect(rules.indexOf('broadcast-clean')).toBeLessThan(rules.indexOf('Plain English is wrong here'));
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

// The failure measured on air: thirty-nine consecutive model talk breaks under one persona, roughly
// three quarters of which named neither record. "Tonight the groove lands. Friend, a cue from Jerez
// rises. The pressing shows a twin mark" is one of them verbatim, and it is unmistakably the
// character speaking — which is exactly why every existing check passed it. The listener still has
// no idea what is playing.
describe('readAnswer, against the records it was shown', () => {
    it('declines a break that is about neither record', () => {
        const script = 'Tonight the groove lands. Friend, a cue rises. The pressing shows a twin mark.';

        expect(readAnswer(script, { names: [previous, next] })).toBeUndefined();
    });

    it('takes one that named the record just finished', () => {
        const script = 'Solid Air still sounds like the room it was recorded in.';

        expect(readAnswer(script, { names: [previous, next] })).toBe(script);
    });

    it('takes one that named the artist rather than the title', () => {
        // One of the two is plenty. A presenter who says "that was Nick Drake" has identified it.
        const script = 'Nick Drake never sounded like he was performing, and that is the whole trick.';

        expect(readAnswer(script, { names: [previous, next] })).toBe(script);
    });

    it('forgives a title said the way a presenter says it', () => {
        // Deliberately generous. The failure being caught is a break that mentions no record at all,
        // not one that dropped a parenthetical — and every refusal costs the station the model's
        // sentence, so a strict comparison here would be paid for in breaks nobody needed to lose.
        const reaper = { title: "(Don't Fear) The Reaper", artist: 'Blue Öyster Cult' };

        expect(readAnswer('The Reaper is a gentler record than anybody remembers.', { names: [reaper] })).toBeDefined();
    });

    it('asks nothing of a break that was shown no records', () => {
        // Every welcome, and a link at the top of an order. A break cannot be refused for failing to
        // name something it was never given.
        expect(readAnswer('Good evening, and welcome in.', { names: [undefined, undefined] })).toBeDefined();
        expect(readAnswer('Good evening, and welcome in.', {})).toBeDefined();
    });

    it('says which fault it was, since this one is the prompt rather than the persona', () => {
        const declined = writeDecline('Tonight the groove lands, friend.', { names: [previous, next] });

        expect(declined?.fault).toBe('named-nothing');
        expect(declined?.reason).toMatch(/neither of the records/i);
    });

    it('reports naming nothing ahead of being out of character, because it is the more basic fault', () => {
        // Both are true of this script. Reporting it as out-of-character would send an operator to
        // the personas page for something the prompt caused.
        const declined = writeDecline('Tonight the groove lands.', { names: [previous, next], persona: { dictionMarkers: ['ye'] } });

        expect(declined?.fault).toBe('named-nothing');
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

// The reason that reaches `script_history.reason` and the log beside it. It exists because the row
// could not tell a 203-word bulletin from a model that answered with nothing: both were reported as
// the writer having had nothing to say, and only one of them is about a ceiling.
describe('writeDecline', () => {
    const pirate = { dictionMarkers: ['ye', 'aye', 'matey'] };

    it('says nothing at all about an answer the station can say', () => {
        expect(writeDecline('Aye, that were Solid Air, matey.', { persona: pirate })).toBeUndefined();
    });

    it('tells an empty answer apart from one that ran long', () => {
        const rambling = Array.from({ length: DEFAULT_MAX_WORDS + 5 }, () => 'word').join(' ');

        expect(writeDecline('   ', {})?.fault).toBe('nothing-said');
        expect(writeDecline(rambling, {})?.fault).toBe('ran-long');
    });

    it('honours the caller’s own ceiling rather than the default', () => {
        const long = Array.from({ length: DEFAULT_MAX_WORDS + 5 }, () => 'word').join(' ');

        expect(writeDecline(long, { maxWords: DEFAULT_MAX_WORDS * 2 })).toBeUndefined();
    });

    // In `readAnswer`'s own order, so the reason is what actually happened: a script the station was
    // never going to say is not worth asking whether it was in character.
    it('reports the length before the character, for an answer that failed both', () => {
        const plain = Array.from({ length: DEFAULT_MAX_WORDS + 5 }, () => 'word').join(' ');

        expect(writeDecline(plain, { persona: pirate })?.fault).toBe('ran-long');
    });

    it('names which character fault it was, for one the station could otherwise have said', () => {
        expect(writeDecline('That was Solid Air, from John Martyn.', { persona: pirate })?.fault).toBe('out-of-character');
        expect(writeDecline('Aye, matey, buckle up.', { persona: { ...pirate, avoid: ['buckle up'] } })?.fault).toBe('avoided-wording');
    });

    it('carries a sentence an operator can read beside the fault', () => {
        expect(writeDecline('   ', {})?.reason).toMatch(/nothing/i);
        expect(writeDecline(Array.from({ length: 99 }, () => 'word').join(' '), {})?.reason).toMatch(/word ceiling/i);
    });
});
