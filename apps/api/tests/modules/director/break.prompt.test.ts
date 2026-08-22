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
    maxWordsFor,
    overusedWords,
    readAnswer,
    TALK_BREAK_SHAPE,
    writeDecline,
    type PromptSettings,
} from '../../../src/modules/director/break.prompt.js';
import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import { NEWS_SHAPE } from '../../../src/modules/director/model.news.break.writer.js';
import { WELCOME_SHAPE } from '../../../src/modules/director/model.welcome.writer.js';
import { LATITUDE_INSTRUCTIONS, LATITUDE_LICENCE, LATITUDE_MAX_WORDS } from '../../../src/modules/personas/persona.sheet.js';

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

    // The station's only delivery control. `SpeechRequest` is text, a voice and a format, so nothing
    // downstream can ask an engine for a reading and the marks in the words are the whole of it.
    describe('punctuating for the delivery', () => {
        it('asks for it, and names what each mark does', () => {
            const rules = system(prompt({ kind: 'talkbreak', previous, next }));

            expect(rules).toMatch(/Punctuation is your only stage direction/i);
            expect(rules).toMatch(/question mark lifts the line/i);
        });

        // Both are refusals rather than preferences, and both are about code that already exists:
        // `sayInitialisms` spells out its list case-sensitively, and `tidyAnswer` strips a `*...*` or
        // a `[...]` as a stage direction before the script is ever stored.
        it('rules out the two things a model reaches for instead', () => {
            const rules = system(prompt({ kind: 'talkbreak', previous, next }));

            expect(rules).toMatch(/Capitals do not sound like anything/i);
            expect(rules).toMatch(/asterisks and brackets are stripped/i);
        });

        // Shared rather than on a shape, which is the claim worth pinning: a bulletin is read aloud
        // by the same engine as a link, so the one kind whose shape overrides the most still owes it.
        it('is owed by every kind, including the bulletin and the welcome', () => {
            for (const shape of [TALK_BREAK_SHAPE, NEWS_SHAPE, WELCOME_SHAPE]) {
                const rules = system(breakPrompt({ kind: 'talkbreak', previous, next }, {}, shape));

                expect(rules, `${shape.job} was not asked to punctuate`).toMatch(/Punctuation is your only stage direction/i);
            }
        });
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

    // The opening rule one scale larger. Fixing the openings moved the repetition into the middle of
    // the sentence rather than removing it: over thirty-nine consecutive breaks under one persona,
    // every break opened differently and "groove" appeared in 26 of them, "friend" in 35, "signal"
    // in 17. The markers are not exempt, because the marker check is what rewards saying them.
    describe('the words the station has worn out', () => {
        const worn = [
            'Tonight the groove lands. Friend, a cue rises.',
            'Listen, friend. The groove cuts deep, and a signal hums under it.',
            'Friend, the groove of that record hides a quiet signal.',
            'That groove marks the same pressing, friend.',
        ];

        it('names a word the presenter has said in nearly every recent break', () => {
            expect(overusedWords(worn)).toContain('groove');
            expect(overusedWords(worn)).toContain('friend');
        });

        it('leaves a word that turned up once', () => {
            expect(overusedWords(worn)).not.toContain('pressing');
        });

        it('counts scripts rather than uses, so one repetitive sentence is not a habit', () => {
            // Four uses in one break is a rhythm problem inside that break. A habit is the same word
            // turning up again the next time, which is the only version a listener hears.
            const once = ['Groove, groove, groove and more groove.', 'That one still holds up.', 'A quiet record, quietly played.'];

            expect(overusedWords(once)).not.toContain('groove');
        });

        it('says nothing at all from too few breaks to see a habit in', () => {
            // Below three, every content word trivially clears the share and the station would open
            // every second break complaining about a word it had said once.
            expect(overusedWords(['The groove lands.', 'The groove lands again.'])).toEqual([]);
            expect(overusedWords(undefined)).toEqual([]);
        });

        it('leaves the grammar alone, since a sentence needs it', () => {
            const plain = ['That was a fine record.', 'That was another fine one.', 'That was the last of them.'];

            expect(overusedWords(plain)).not.toContain('that');
            expect(overusedWords(plain)).not.toContain('was');
        });

        it('asks rather than forbids, because the sheet genuinely wants its own vocabulary', () => {
            const said = user(prompt({ kind: 'talkbreak', previous, next, recent: worn }));

            expect(said).toMatch(/you have leaned on/i);
            expect(said).toMatch(/reach past them this time/i);
            // And it is not phrased as a ban, which would refuse the character for being itself.
            expect(said).not.toMatch(/do not say "groove"/i);
        });

        it('says none of it for a station with nothing behind it', () => {
            expect(user(prompt({ kind: 'talkbreak', previous, next }))).not.toMatch(/you have leaned on/i);
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

    // The silence the notes rule never covered. For as long as it existed the prompt only ever said
    // what to do WITH notes, so a record arriving with none left a character sheet asking for
    // specifics as the only instruction in the room. Measured over thirty-nine breaks under a
    // persona whose own quirks say "start from a note you were actually given": invented pressing
    // plants, a catalogue number shared with another record, "the year 1958", "a techno echo from
    // 1986". None of those records carried a single note.
    describe('a record the station knows nothing about', () => {
        const withFacts = { ...previous, facts: ['John Martyn was born in New Malden in 1948.'] };

        it('says so, and names the record it is talking about', () => {
            const said = user(prompt({ kind: 'talkbreak', previous, next }));

            expect(said).toMatch(/knows nothing about "Solid Air" or "Pink Moon"/);
        });

        it('forbids the specifics a model reaches for, rather than only saying "be careful"', () => {
            const said = user(prompt({ kind: 'talkbreak', previous }));

            expect(said).toMatch(/no pressings or catalogue numbers/i);
            expect(said).toMatch(/no connection to any other record/i);
        });

        it('leaves the presenter their own opinion, which is the whole job', () => {
            expect(user(prompt({ kind: 'talkbreak', previous }))).toMatch(/what you think of it is yours to say/i);
        });

        // The dangerous case, and the reason this is per record rather than a blanket: told one true
        // note about the record behind it, a model will invent a matching one about the record in
        // front. A rule that only fired when BOTH were empty would never see that happen.
        it('names only the record with nothing known, when the other one has notes', () => {
            const said = user(prompt({ kind: 'talkbreak', previous: withFacts, next }));

            expect(said).toMatch(/knows nothing about "Pink Moon"/);
            expect(said).not.toMatch(/knows nothing about "Solid Air"/);
        });

        it('says none of it when both records came with notes', () => {
            const said = user(prompt({ kind: 'talkbreak', previous: withFacts, next: { ...next, facts: ['Recorded in two nights.'] } }));

            expect(said).not.toMatch(/knows nothing about/i);
        });

        it('says none of it for a break that was shown no record at all', () => {
            // A welcome. There is nothing to be silent about, and the prompt already has its own
            // sentence for that moment.
            expect(user(prompt({ kind: 'welcome' }))).not.toMatch(/knows nothing about/i);
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

    // A shape that has no use for the notes withholds them, rather than showing them and asking for
    // restraint — the same doctrine `showsPrevious` is on. The kind that does this is the bulletin,
    // and both of the false discography claims this station has aired arrived through its handover:
    // "released in May three thousand nine hundred thirty-three", "each playing half the album".
    describe('a kind that is not shown the notes', () => {
        const bulletin = { job: 'You read the news.', showsPrevious: false, showsFacts: false };
        const withFacts = { ...next, facts: ['Recorded over two nights in 1971.'] };

        it('shows the record and withholds what is known about it', () => {
            const said = user(breakPrompt({ kind: 'news', next: withFacts }, {}, bulletin));

            expect(said).toContain('Pink Moon');
            expect(said).not.toContain('two nights');
            expect(said).not.toMatch(/- Notes:/);
        });

        it('says nothing about how to use notes it cannot see', () => {
            const said = user(breakPrompt({ kind: 'news', next: withFacts }, {}, bulletin));

            expect(said).not.toMatch(/never read out as it stands/i);
        });

        it('still forbids inventing about that record, which is the risk that remains', () => {
            // True of the prompt the model can actually see: from inside a bulletin the station does
            // know nothing about the record it is handing back to.
            const said = user(breakPrompt({ kind: 'news', next: withFacts }, {}, bulletin));

            expect(said).toMatch(/knows nothing about "Pink Moon"/);
        });

        it('leaves the notes alone for every kind that did not ask', () => {
            expect(user(prompt({ kind: 'talkbreak', previous, next: withFacts }))).toContain('two nights');
        });
    });

    // The notebook is the half of a character that was not there when its sheet was written, and the
    // whole design is which TURN each half lands in: a trait is who the presenter is, a saying is
    // what the presenter did, and putting them in one place makes a fact about last Tuesday part of
    // the character or the character a detail of this hour.
    describe('what a character has accumulated', () => {
        const pirate = { style: 'a pirate captain who runs a radio station', diction: ['drop your Gs'] };
        const notebook = {
            trait: ['has taken to calling the listener a shipmate'],
            said: ['called Booker T. the tightest band alive'],
        };

        it('puts a trait in the system turn, with the sheet', () => {
            const messages = prompt({ kind: 'talkbreak', previous, next }, { persona: pirate, notebook });

            expect(system(messages)).toContain('has taken to calling the listener a shipmate');
            expect(user(messages)).not.toContain('shipmate');
        });

        it('puts a saying in the user turn, and says plainly that it is optional', () => {
            // The played list's own wording, and for the measured reason: handed a list, a model gets
            // through the list. What this is for is a break that CAN refer back, not one that must.
            const messages = prompt({ kind: 'talkbreak', previous, next }, { persona: pirate, notebook });

            expect(user(messages)).toContain('called Booker T. the tightest band alive');
            expect(user(messages)).toMatch(/do not have to mention any of them/i);
            expect(system(messages)).not.toContain('Booker T.');
        });

        it('leaves the prompt untouched for a character with an empty notebook', () => {
            // `personaLines`' own guarantee held one level up: a station that has accumulated nothing
            // must read exactly as it did before any of this existed.
            const bare = prompt({ kind: 'talkbreak', previous, next }, { persona: pirate });
            const empty = prompt({ kind: 'talkbreak', previous, next }, { persona: pirate, notebook: { trait: [], said: [] } });

            expect(empty).toEqual(bare);
        });

        it('says nothing at all for a station presenting as nobody', () => {
            // A note about a character no one is presenting has nothing to attach to, and the trait
            // line claims a history the station is not currently speaking from.
            const messages = prompt({ kind: 'talkbreak', previous, next }, { notebook });

            expect(system(messages)).not.toContain('shipmate');
        });

        it('withholds both halves from a bulletin', () => {
            // `showsFacts`' argument one source further out: a model reporting the news and handed a
            // list of the character's own past sayings will read one out, and it is worse than a
            // discography note because nothing about it is even trying to be true today.
            const bulletin = { job: 'You read the news.', showsPrevious: false, showsNotebook: false };
            const messages = breakPrompt({ kind: 'news', next }, { persona: pirate, notebook }, bulletin);

            expect(system(messages)).not.toContain('shipmate');
            expect(user(messages)).not.toContain('Booker T.');
            // The SHEET still goes, so a bulletin still sounds like this station's presenter. What is
            // withheld is the accumulation, not the character.
            expect(system(messages)).toContain('drop your Gs');
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

    // A character whose whole appeal is going somewhere, which the station had no way to express: the
    // 40-word ceiling and "make one point" are right for its ordinary voice and are exactly what a
    // shock jock is hired to ignore. What a rung buys is the station ASKING for more; every refusal
    // underneath still holds, which is what the `readAnswer` cases below pin.
    describe('a persona given room', () => {
        const pirate = { style: 'a pirate captain', diction: ['Ye for you'], dictionMarkers: ['arr'] };
        const loose = { ...pirate, latitude: 'loose' as const };
        const unleashed = { ...pirate, latitude: 'unleashed' as const };

        it('states the rung’s ceiling rather than the station’s', () => {
            const rules = system(prompt({ kind: 'talkbreak', previous, next }, { persona: loose }));

            expect(rules).toMatch(new RegExp(`under ${LATITUDE_MAX_WORDS.loose} words`));
            expect(rules).not.toMatch(new RegExp(`under ${DEFAULT_MAX_WORDS} words`));
        });

        it('tells the character what the room is for', () => {
            expect(system(prompt({ kind: 'talkbreak', previous, next }, { persona: loose }))).toContain(LATITUDE_INSTRUCTIONS.loose);
        });

        it('stops asking for one point, since asking for both would only make it hedge', () => {
            const rules = system(prompt({ kind: 'talkbreak', previous, next }, { persona: loose }));

            expect(rules).not.toMatch(/Make one point/);
            expect(rules).toMatch(/Take the thought as far as it goes/);
        });

        it('still demands a record be named, which is the rule the room does not touch', () => {
            // `mustNameRecord` refuses a break that names neither either way, so dropping the ask
            // from the prompt would be refusing a script for an instruction it never received.
            expect(system(prompt({ kind: 'talkbreak', previous, next }, { persona: unleashed }))).toMatch(/Name a record, and then say what/);
        });

        it('permits the language only at the top rung', () => {
            expect(system(prompt({ kind: 'talkbreak', previous }, { persona: unleashed }))).toContain(LATITUDE_LICENCE);
            expect(system(prompt({ kind: 'talkbreak', previous }, { persona: loose }))).not.toContain(LATITUDE_LICENCE);
        });

        it('loses that permission to the station’s own policy', () => {
            // The whole of "a persona narrows within station policy and never widens it". A station
            // that has said it is broadcast-clean is not talked out of it by whoever is presenting.
            const rules = system(prompt({ kind: 'talkbreak', previous }, { persona: unleashed, cleanLanguage: true }));

            expect(rules).not.toContain(LATITUDE_LICENCE);
            expect(rules).toMatch(/broadcast-clean/i);
        });

        it('is not offered by a kind that did not ask for it', () => {
            // The shape has the veto and the sheet only offers: a bulletin's accuracy is not a
            // character choice, and a welcome is a greeting rather than a slot for a monologue.
            const bulletin = { job: 'You read the news.', showsPrevious: false };
            const rules = system(breakPrompt({ kind: 'news', next }, { persona: unleashed }, bulletin));

            expect(rules).toMatch(new RegExp(`under ${DEFAULT_MAX_WORDS} words`));
            expect(rules).not.toContain(LATITUDE_INSTRUCTIONS.unleashed);
            expect(rules).not.toContain(LATITUDE_LICENCE);
        });

        it('reads a hand-edited row that names no rung as no room at all', () => {
            const rules = system(prompt({ kind: 'talkbreak', previous }, { persona: { ...pirate, latitude: 'feral' as never } }));

            expect(rules).toMatch(new RegExp(`under ${DEFAULT_MAX_WORDS} words`));
            expect(rules).toMatch(/Make one point/);
        });
    });
});

// The one number that exists in two files at two moments: what the model is told, and what the guard
// refuses at. They disagree silently, and a disagreement has no symptom other than a character that
// stopped sounding like itself — every break declined for doing exactly what it was asked.
describe('maxWordsFor', () => {
    const shape = TALK_BREAK_SHAPE;
    const unleashed = { style: 'a shock jock', latitude: 'unleashed' as const };

    it('is the station’s ceiling for a persona with no room', () => {
        expect(maxWordsFor({}, shape)).toBe(DEFAULT_MAX_WORDS);
        expect(maxWordsFor({ persona: { style: 'a warm host' } }, shape)).toBe(DEFAULT_MAX_WORDS);
    });

    it('is the rung’s ceiling for a persona with it', () => {
        expect(maxWordsFor({ persona: unleashed }, shape)).toBe(LATITUDE_MAX_WORDS.unleashed);
    });

    it('answers the caller’s own ceiling for a kind that does not offer the room', () => {
        expect(maxWordsFor({ persona: unleashed, maxWords: 55 }, { job: 'You read the news.', showsPrevious: false })).toBe(55);
    });

    it('never lowers a ceiling a kind set for itself', () => {
        // A rung is a floor under the kind's own answer rather than a correction to it.
        expect(maxWordsFor({ persona: unleashed, maxWords: 140 }, shape)).toBe(140);
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

// Measured on air on 19 August, segment `e26a93f0`, labelled `Talk break: Madhouse into Run to the
// Hills`: the script back-announced the record that had not played yet. It passed every check there
// was — in character, inside the ceiling, and naming a record it had genuinely been shown — because
// nothing asked which SIDE of the break that record was on.
describe('readAnswer, against the side of the break a record is on', () => {
    const madhouse = { title: 'Madhouse', artist: 'Anthrax' };
    const hills = { title: 'Run to the Hills', artist: 'Iron Maiden' };
    const between = { previous: madhouse, next: hills };

    it('declines a break that back-announces the record still to come', () => {
        const script = 'That was Iron Maiden’s “Run to the Hills,” the kind of title that sounds like a bargain bin headline.';

        expect(readAnswer(script, { cues: between })).toBeUndefined();
    });

    it('declines a break that cues the record already played as if it were coming', () => {
        expect(readAnswer('Coming up, Madhouse, and it never did settle down.', { cues: between })).toBeUndefined();
    });

    it('takes a back-announce of the record that actually finished', () => {
        const script = 'That was Madhouse, and it still sounds like a fight in a stairwell.';

        expect(readAnswer(script, { cues: between })).toBe(script);
    });

    it('takes a forward cue of the record actually coming up', () => {
        const script = 'Coming up, Run to the Hills, which has outlived everyone who sneered at it.';

        expect(readAnswer(script, { cues: between })).toBe(script);
    });

    it('leaves a correct double cue alone, since naming both is not naming one wrongly', () => {
        const script = 'That was Madhouse into Run to the Hills, and the join is half the fun.';

        expect(readAnswer(script, { cues: between })).toBe(script);
    });

    it('says nothing about a record mentioned with no cue attached to it', () => {
        // The check is on the FRAME, not on the noun. A break may perfectly well mention the record
        // coming up without claiming it played, which is most of what a link is for.
        const script = 'Madhouse still lands, and Iron Maiden are on the way to prove a point about stamina.';

        expect(readAnswer(script, { cues: between })).toBe(script);
    });

    it("does not refuse the station's own phrasing, which cues both records by design", () => {
        // The floor's real output from 19 August, verbatim. A check that refused what the
        // deterministic writer produces would be refusing the thing it falls through TO, and the
        // model would be held to a standard the station cannot meet itself.
        const cues = { previous: { title: 'Cemetery Gates', artist: 'Pantera' }, next: { title: 'Symphony Of Destruction', artist: 'Megadeth' } };
        const script = 'That was Cemetery Gates, from Pantera. Ambitious. Next, Megadeth with Symphony Of Destruction.';

        expect(readAnswer(script, { cues })).toBe(script);
    });

    it('does not refuse over an identifier the two records share', () => {
        // Two records by one artist cannot be told apart by the artist's name, so a match on it is
        // not evidence of anything and must not cost the station a break.
        const cues = { previous: { title: 'Peace Sells', artist: 'Megadeth' }, next: { title: 'Hangar 18', artist: 'Megadeth' } };

        expect(readAnswer('That was Megadeth, and they have not finished with you yet.', { cues })).toBeDefined();
    });

    it('asks nothing when only one side of the break is known', () => {
        // With one record there is no wrong side to confuse it with, and the prompt already tells a
        // one-record break not to say what is coming up.
        expect(readAnswer('That was Run to the Hills.', { cues: { previous: madhouse } })).toBeDefined();
        expect(readAnswer('That was Madhouse.', { cues: { next: hills } })).toBeDefined();
        expect(readAnswer('That was Run to the Hills.', {})).toBeDefined();
    });

    it('says which fault it was, and says it in terms of the listener', () => {
        const script = 'That was Iron Maiden’s “Run to the Hills,” and what a way to go out.';
        const declined = writeDecline(script, { cues: between });

        expect(declined?.fault).toBe('cued-wrong');
        expect(declined?.reason).toMatch(/wrong side of the break/i);
    });

    it('reports naming nothing ahead of cueing wrongly, because it is the more basic fault', () => {
        const declined = writeDecline('Tonight the groove lands, friend.', { names: [madhouse, hills], cues: between });

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

    it('refuses at the ceiling it was given, which is what a rung moves', () => {
        // The same fifty words either way. The persona did not make the answer acceptable; the
        // ceiling the writer built from `maxWordsFor` did, and if the two ever come apart this is
        // the case that fails rather than a station quietly falling to its phrasings.
        const rambling = Array.from({ length: 50 }, (_unused, index) => `word${index}`).join(' ');

        expect(readAnswer(rambling, { maxWords: DEFAULT_MAX_WORDS })).toBeUndefined();
        expect(readAnswer(rambling, { maxWords: maxWordsFor({ persona: { style: 'a shock jock', latitude: 'loose' } }, TALK_BREAK_SHAPE) })).toBe(
            rambling,
        );
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

    it('declines an answer that ran long with nothing whole to keep short of the ceiling', () => {
        // One unbroken sentence, which is the case the ceiling still refuses: the only cut available
        // is mid-clause, and that is a worse thing to air than the floor's correct line.
        const rambling = Array.from({ length: DEFAULT_MAX_WORDS + 5 }, () => 'word').join(' ');

        expect(readAnswer(rambling)).toBeUndefined();
    });

    it('accepts an answer right at the ceiling', () => {
        const exact = Array.from({ length: DEFAULT_MAX_WORDS }, () => 'word').join(' ');

        expect(readAnswer(exact)).toBe(exact);
    });
});

/**
 * The ceiling as a CUT, which is a reversal and was measured rather than reasoned: of the six answers
 * this station ever refused for length, every one had made its point and then padded, so what the old
 * rule threw away was the eighty good words in front of "make of that what you will".
 */
describe('readAnswer, past the ceiling', () => {
    /** One sentence of exactly `words` words, beginning with a capital so a boundary is findable. */
    const sentence = (index: number, words: number): string => `Sentence ${index} ${Array.from({ length: words - 3 }, () => 'word').join(' ')} here.`;

    const rambled = [1, 2, 3, 4, 5].map(index => sentence(index, 10)).join(' ');
    const kept = [1, 2, 3, 4].map(index => sentence(index, 10)).join(' ');

    it('cuts back to the last whole sentence that fits', () => {
        expect(readAnswer(rambled)).toBe(kept);
    });

    it('reports nothing refused about an answer it merely cut', () => {
        expect(writeDecline(rambled, {})).toBeUndefined();
    });

    it('cuts at the ceiling the writer built rather than the default', () => {
        expect(readAnswer(rambled, { maxWords: DEFAULT_MAX_WORDS * 2 })).toBe(rambled);
    });

    // A trim keeps the words in FRONT of the overrun, which only reads as the break the model wrote
    // while there is a break left. An opening clause is worth less than the floor's whole sentence.
    it('declines a trim so short it is no longer the break the model wrote', () => {
        const frontloaded = `${sentence(1, 5)} ${sentence(2, 60)}`;

        expect(readAnswer(frontloaded)).toBeUndefined();
        expect(writeDecline(frontloaded, {})?.fault).toBe('ran-long');
    });

    // The half that keeps the cut honest: what airs is the fitted script, so the fitted script is
    // what the rest of the guard has to judge. A break whose only record was in the tail named none.
    it('judges the words it will actually air, not the ones the model sent', () => {
        const madhouse = { title: 'Madhouse', artist: 'Anthrax' };
        const named = `${[1, 2, 3, 4].map(index => sentence(index, 10)).join(' ')} That was Madhouse, from Anthrax.`;

        expect(readAnswer(named, { names: [madhouse] })).toBeUndefined();
        expect(writeDecline(named, { names: [madhouse] })?.fault).toBe('named-nothing');
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
