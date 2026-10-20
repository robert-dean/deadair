// A beat judged without a model, which is the whole point: a model asked whether its own draft is
// good says yes, and everything worth catching here is measurable. The empty-beat case is not
// defensive — a model that spends its entire output allowance on reasoning returns exactly that, and
// this station's own logs show it happening.

import { describe, expect, it } from 'vitest';

import { checkBeat, correctionNote, countWords, DUPLICATE_OVERLAP, trigramOverlap } from '../../../src/modules/productions/production.checks.js';
import { dayPart } from '../../../src/modules/director/clock.words.js';

/** A beat of about `count` words, distinct enough not to trip the repetition check by accident. */
const words = (count: number, seed = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet') => {
    const pool = seed.split(' ');
    return Array.from({ length: count }, (_, index) => pool[index % pool.length]).join(' ');
};

const beat = (text: string, overrides: Partial<Parameters<typeof checkBeat>[0]> = {}) => checkBeat({ text, words: 200, ordinal: 1, ...overrides });

describe('checkBeat', () => {
    it('finds nothing wrong with a beat of about the right length', () => {
        expect(beat(words(200))).toEqual([]);
    });

    // Not a defensive case. A model whose output allowance is consumed by reasoning before it emits
    // any text returns exactly this, with finishReason=length.
    it('reports an empty beat and nothing else, because there is nothing else to judge', () => {
        const problems = beat('   ');

        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/came back empty/i);
    });

    describe('length', () => {
        it('catches a beat that came back as a sentence', () => {
            expect(beat(words(20))[0]).toMatch(/too short/i);
        });

        it('catches one that ran away', () => {
            expect(beat(words(600))[0]).toMatch(/far too long/i);
        });

        it('leaves a beat that is merely a bit over or under alone', () => {
            // The budget is an instruction about pace rather than a contract, and a beat ten percent
            // long is a beat that had something to say.
            expect(beat(words(220))).toEqual([]);
            expect(beat(words(170))).toEqual([]);
        });

        // Past the beat ceiling a beat is asked for more than any single completion produces, so
        // judging "too short" against the ask would burn a re-draft on every beat of a long
        // production.
        it('judges a huge ask against the expected ceiling rather than the ask', () => {
            expect(checkBeat({ text: words(300), words: 1_300, ordinal: 1 })).toEqual([]);
        });
    });

    describe('re-introducing the programme', () => {
        it('catches a mid-programme beat that welcomes the listener again', () => {
            const problems = beat('Welcome back to the show. ' + words(200));

            expect(problems.some(problem => /introduces the programme again/i.test(problem))).toBe(true);
        });

        it('stands down outside English, since the openings it knows are English phrases', () => {
            expect(checkBeat({ text: 'Welcome back to the show. ' + words(200), words: 200, ordinal: 3, language: 'de' })).toEqual([]);
        });

        it('allows it in the first beat, which is where an opening belongs', () => {
            expect(checkBeat({ text: 'Welcome to the show. ' + words(200), words: 200, ordinal: 0 })).toEqual([]);
        });

        it('allows a caller arriving mid-programme to say hello, because that is what it was asked for', () => {
            // Being put on air happens in the middle of a programme, and greeting somebody there is
            // the prompt's own instruction. A check that refused it would be marking a beat down for
            // doing as it was told, which is the bargain every guard in this tree keeps.
            const problems = checkBeat({
                text: 'Hello and welcome to... sorry, hiya. ' + words(60),
                words: 70,
                ordinal: 3,
                role: 'caller',
                firstTurn: true,
            });

            expect(problems).toEqual([]);
        });

        it('still catches the presenter re-introducing the programme on its own first turn', () => {
            // `firstTurn` is about the SPEAKER and the exemption is about a caller arriving. The host
            // has been there since the top of the show whatever its own turn count says.
            const problems = checkBeat({
                text: 'Welcome back to the show. ' + words(200),
                words: 200,
                ordinal: 3,
                role: 'host',
                firstTurn: true,
            });

            expect(problems.some(problem => /introduces the programme again/i.test(problem))).toBe(true);
        });
    });

    describe('repeating an earlier beat', () => {
        it('catches a beat that restates one already written', () => {
            const earlier = words(200);
            const problems = beat(earlier, { priorBeats: [earlier] });

            expect(problems.some(problem => /repeats an earlier one/i.test(problem))).toBe(true);
        });

        it('leaves a beat that shares a phrase or two alone', () => {
            const earlier = words(200, 'one two three four five six seven eight nine ten');
            expect(beat(words(200), { priorBeats: [earlier] })).toEqual([]);
        });

        it('says nothing about repetition for the first beat, which has nothing to repeat', () => {
            expect(checkBeat({ text: words(200), words: 200, ordinal: 0, priorBeats: [] })).toEqual([]);
        });
    });

    // A beat is re-drafted at most once, so the one correction it gets has to carry everything wrong
    // with it: fixing the length and being told about the repetition on a second pass that never
    // comes is worse than useless.
    it('reports every problem at once rather than the first one it finds', () => {
        const earlier = words(200);
        const problems = beat('Welcome back to the show. ' + earlier.split(' ').slice(0, 20).join(' '), { priorBeats: [earlier] });

        expect(problems.length).toBeGreaterThan(1);
        // Length first: it is the one that changes what the beat has room to say.
        expect(problems[0]).toMatch(/too short/i);
    });
});

// Only the `polished` mode runs this pass, so on a station writing `outlined` productions the
// daypart is prevention alone. It is here for the stations that opt in, and because the complaint it
// answers is the one thing in a beat a listener can check against their own window.
describe('the half of the day a beat was told about', () => {
    const afternoon = dayPart(Date.UTC(2026, 7, 13, 14, 30), 'UTC');
    const evening = dayPart(Date.UTC(2026, 7, 13, 20, 0), 'UTC');

    it('asks nothing of a beat that was never told when it airs', () => {
        expect(beat(`${words(200)} tonight`)).toEqual([]);
    });

    it('reports a beat that calls the afternoon tonight', () => {
        const problems = beat(`${words(200)} tonight`, { dayPart: afternoon });

        expect(problems[0]).toMatch(/calls it "tonight" when it goes out this afternoon/i);
    });

    it('permits an evening called tonight, on the same line the break guard draws', () => {
        expect(beat(`${words(200)} tonight`, { dayPart: evening })).toEqual([]);
    });

    // The half a daypart cannot judge: "midday" is the afternoon at ten past twelve and the
    // afternoon at half past four, so the check above passes both.
    it('reports a beat that says midday when it goes out at half past four', () => {
        const problems = beat(`${words(200)} midday`, { moment: { at: Date.UTC(2026, 7, 13, 16, 30), zone: 'UTC' } });

        expect(problems[0]).toMatch(/says "midday", which is hours from when it goes out/i);
    });

    it('permits the same word in the middle of the day', () => {
        expect(beat(`${words(200)} midday`, { moment: { at: Date.UTC(2026, 7, 13, 12, 15), zone: 'UTC' } })).toEqual([]);
    });

    it('asks nothing of a beat with no moment on it', () => {
        expect(beat(`${words(200)} midday`, { dayPart: afternoon })).toEqual([]);
    });

    // The file's own contract: the problems that change what the beat SAYS come before the ones
    // that change how long it is, because one re-draft has to carry everything and a model reads a
    // list with finite attention.
    it('reports the daypart ahead of the length, because it changes what the beat says', () => {
        const problems = beat(`tonight ${words(40)}`, { dayPart: afternoon, words: 200 });

        expect(problems.length).toBeGreaterThan(1);
        expect(problems[0]).toMatch(/goes out this afternoon/i);
        expect(problems[1]).toMatch(/too short/i);
    });
});

describe('trigramOverlap', () => {
    it('is 1 for a text against itself', () => {
        expect(trigramOverlap(words(50), words(50))).toBe(1);
    });

    it('is 0 for two texts with nothing in common', () => {
        expect(trigramOverlap('one two three four', 'alpha bravo charlie delta')).toBe(0);
    });

    it('ignores case and punctuation, so a repeat cannot hide behind them', () => {
        expect(trigramOverlap('The 808 was cheap.', 'the 808 was cheap!')).toBe(1);
    });

    // Judged against the SHORTER side: a short beat lifted wholesale from a long one shares only a
    // fraction of the long one's phrases, and the other way round would miss it.
    it('catches a short beat lifted whole out of a long one', () => {
        const long = words(200);
        const lifted = long.split(' ').slice(0, 40).join(' ');

        expect(trigramOverlap(long, lifted)).toBeGreaterThanOrEqual(DUPLICATE_OVERLAP);
    });

    it('answers 0 rather than dividing by zero when there is nothing to compare', () => {
        expect(trigramOverlap('', 'one two three')).toBe(0);
        expect(trigramOverlap('two words', 'one two three')).toBe(0);
    });
});

describe('countWords', () => {
    it('counts spoken words and ignores the whitespace around them', () => {
        expect(countWords('  one   two\nthree ')).toBe(3);
        expect(countWords('   ')).toBe(0);
    });
});

describe('correctionNote', () => {
    // A model handed its own draft and a list of complaints edits around them and keeps the shape
    // that produced them, which is what fails again on a beat that was too short.
    it('asks for a rewrite from scratch rather than a fix', () => {
        const note = correctionNote(['too short', 'repeats an earlier beat']);

        expect(note).toMatch(/rewrite it from scratch/i);
        expect(note).toContain('- too short');
        expect(note).toContain('- repeats an earlier beat');
    });
});

// Two things a beat does that only show up when it is SPOKEN, both measured on live runs.
describe('carrying on rather than reciting', () => {
    const runIn = 'and that is exactly what the second-hand shops never understood about the machine';

    it('catches a beat that opens by repeating the words it was handed', () => {
        // The live failure: beats 3 and 4 both opened with the previous beat's closing sentence
        // verbatim. Handed a quotation, a model reads it before saying anything of its own.
        const problems = beat(`${runIn}. Boom, that is how we flip the script. ` + words(180), { runIn });

        expect(problems.some(problem => /repeating the words it was told to carry on from/i.test(problem))).toBe(true);
    });

    it('leaves a beat that genuinely continues alone', () => {
        expect(beat(words(200), { runIn })).toEqual([]);
    });

    // The whole-beat overlap check cannot see this: one sentence in two hundred words is far under
    // the duplicate threshold, which is why the run-in is compared against the OPENING specifically.
    it('is not something the whole-beat duplicate check would have caught', () => {
        // One sentence out of two hundred words is far under the duplicate threshold, which is the
        // whole reason the run-in is compared against the OPENING rather than the beat.
        const echoing = `${runIn}. ` + words(190);
        const earlier = words(200, 'one two three four five six seven eight nine ten');

        const problems = beat(echoing, { runIn, priorBeats: [earlier] });
        expect(problems.some(problem => /repeating the words it was told/i.test(problem))).toBe(true);
        expect(problems.some(problem => /repeats an earlier one/i.test(problem))).toBe(false);
    });
});

describe('markup in something that is read aloud', () => {
    // Measured: the presenter's exclamations came back as *yikes* and *wow*, which the speech engine
    // reads exactly as written.
    it('catches emphasis, headings, bullets and backticks', () => {
        for (const bad of ['*yikes* ', '## A heading\n', '- a bullet\n', '`code` ']) {
            expect(beat(bad + words(200)).some(problem => /formatting/i.test(problem))).toBe(true);
        }
    });

    it('leaves ordinary punctuation alone, which is most of speech', () => {
        expect(beat("Don't @ me — seriously, what was that? " + words(190))).toEqual([]);
    });
});

// The conspiracy host's first live call: his caller picked up the host's dialect from the turns in
// front of him ("I reckon"), and nothing in a production read either sheet back.
describe('wording a speaker never uses', () => {
    const avoid = ['reckon', "y'all", 'anything about a real person'];

    it('names the forbidden words, so the one re-draft knows which to lose', () => {
        const problems = beat(`Well, I reckon y'all know the rest. ${words(200)}`, { avoid });

        expect(problems[0]).toMatch(/"reckon", "y'all"/);
        expect(problems[0]).toMatch(/never says/);
    });

    it('comes ahead of a length complaint, since it is about what the beat says', () => {
        const problems = beat('I reckon so.', { avoid });

        expect(problems[0]).toMatch(/"reckon"/);
        expect(problems[1]).toMatch(/too short/i);
    });

    // Only the phrase-shaped half of an avoid list can match, exactly as it is for a break.
    it('never matches an entry that describes a subject rather than naming words', () => {
        expect(beat(words(200), { avoid: ['anything about a real person'] })).toEqual([]);
    });

    it('asks nothing of a speaker whose sheet forbids nothing', () => {
        expect(beat(`I reckon so. ${words(200)}`)).toEqual([]);
    });
});

describe('weather nobody gave the call', () => {
    const host = { role: 'host' as const };

    it('catches a host describing the sky, and names the word', () => {
        const problems = beat(`Sunny out there this afternoon, and Dale is on the line. ${words(200)}`, host);

        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('"Sunny"');
        expect(problems[0]).toMatch(/no weather/i);
    });

    it('asks it of a production with no cast, whose presenter is the only voice on it', () => {
        expect(beat(`A muggy one tonight. ${words(200)}`)[0]).toContain('"muggy"');
    });

    it('lets a caller describe their own weather, since they are somewhere else', () => {
        expect(beat(`It has been raining all week out here. ${words(200)}`, { role: 'caller' })).toEqual([]);
    });

    it('holds a studio guest to it like the host, since a guest is under the station’s sky', () => {
        expect(beat(`Sunny out there this afternoon. ${words(200)}`, { role: 'guest' })[0]).toContain('"Sunny"');
    });

    it('lets the host answer weather a caller raised', () => {
        const raised = ['It has been raining all week out here.'];

        expect(beat(`Raining there too, is it? Pouring down here. ${words(200)}`, { ...host, raised })).toEqual([]);
    });

    it('lets the host talk about the weather when the brief asked for it', () => {
        expect(beat(`Windy out there, so tell me about the roof. ${words(200)}`, { ...host, raised: ['Callers on the windy weekend'] })).toEqual([]);
    });

    it('lets a record the host brought be named', () => {
        const records = [{ title: 'Sunny', artist: 'Bobby Hebb' }];

        expect(beat(`Sunny by Bobby Hebb is the one we are on about. ${words(200)}`, { ...host, records })).toEqual([]);
        expect(beat(`Sunny by Bobby Hebb is the one we are on about. ${words(200)}`, host)[0]).toContain('"Sunny"');
    });

    it('does not read a sound drop as a forecast', () => {
        expect(beat(`[sfx:thunderstorm] Back to the phones. ${words(200)}`, host)).toEqual([]);
    });

    it('asks nothing of a station that does not broadcast in English', () => {
        expect(beat(`Draußen ist es sonnig und 22 Grad. ${words(200)}`, { ...host, language: 'de' })).toEqual([]);
    });
});

// No beat is handed the record after it, so a beat that cues one named a record the model chose.
// The live case: "THE DRUMS IN THIS NEXT SONG ARE TOTAL MAYHEM! ... Blue Monday by New Order."
describe('a record cued as coming next', () => {
    it('refuses a beat that introduces the next song', () => {
        const problems = beat(`${words(30)} The drums in this next song are total mayhem, Blue Monday by New Order.`, { words: 40 });

        expect(problems[0]).toMatch(/"this next song"/);
        expect(problems[0]).toMatch(/nothing plays under a programme/);
    });

    it('lets ordinary talk about what comes next through', () => {
        expect(beat(`${words(30)} Up next, Wayne has a question nobody should ask on air, coming up after this.`, { words: 40 })).toEqual([]);
    });

    it('stands down on a station that does not broadcast in English', () => {
        expect(beat(`${words(30)} this next song is loud`, { words: 40, language: 'de' })).toEqual([]);
    });
});

// The live banter named its invented record bare in two of three turns: "Um. It's scary. Blue Monday
// by New Order." No frame in front of it, so only the shape of a credit gives it away.
describe('a record named that nobody handed the programme', () => {
    const cast = { names: ['Wayne', 'Garth', "Wayne's World"] };

    it('refuses "Title by Artist" when the programme was handed no records', () => {
        const problems = beat(`${words(30)} Um. It's scary. Blue Monday by New Order.`, { words: 40, ...cast });

        expect(problems[0]).toMatch(/names "Blue Monday by New Order", a record you were not given/);
    });

    it('refuses a quoted title and one with small words inside it', () => {
        expect(beat(`${words(30)} I keep humming "Ace of Spades" by Motörhead.`, { words: 40 })[0]).toMatch(/"Ace of Spades by Motörhead"/);
        expect(beat(`${words(30)} nothing beats The Killing Moon by Echo and the Bunnymen.`, { words: 40 })[0]).toMatch(
            /"The Killing Moon by Echo and the Bunnymen"/,
        );
    });

    it('lets through a record the programme was handed, by its records, its brief or its notes', () => {
        const text = `${words(30)} and that is why Holy Wars by Megadeth still matters.`;

        expect(beat(text, { words: 40, records: [{ title: 'Holy Wars', artist: 'Megadeth' }] })).toEqual([]);
        expect(beat(text, { words: 40, handed: ['a call about Megadeth'] })).toEqual([]);
        expect(beat(text, { words: 40, handed: ['Holy Wars came out in 1990.'] })).toEqual([]);
    });

    it('reads somebody on the programme doing something as a person, not a credit', () => {
        expect(beat(`${words(30)} I was totally Brought In by Wayne today.`, { words: 40, ...cast })).toEqual([]);
        expect(beat(`${words(30)} Blown Away by Garth's gadget again.`, { words: 40, ...cast })).toEqual([]);
    });

    it('reads ordinary English as English', () => {
        expect(beat(`${words(30)}. Inspired by Wayne, I built a camera. I was blown away by Garth.`, { words: 40 })).toEqual([]);
        expect(beat(`${words(30)} the drums are SO LOUD BY NOW that I cannot hear.`, { words: 40 })).toEqual([]);
    });

    it('stands down on a station that does not broadcast in English', () => {
        expect(beat(`${words(30)} Blue Monday by New Order.`, { words: 40, language: 'de' })).toEqual([]);
    });
});

// Measured against the live station's last 455 production beats: the frame in front and a stray quote
// mark were caught with the record, and the correction should name the record alone.
describe('naming the record back', () => {
    it('leaves out the "this is" in front of it and a quote mark round it', () => {
        expect(beat(`${words(30)} and this, It is Paranoid by Black Sabbath.`, { words: 40 })[0]).toMatch(/names "Paranoid by Black Sabbath"/);
        expect(beat(`${words(30)} always 'Africa' by Toto.`, { words: 40 })[0]).toMatch(/names "Africa by Toto"/);
    });
});

// The other direction of "this next song". A programme knows the record before it no better than the
// one after, so "that was X" is the same invention. Run over the live station's 409 talk breaks that
// back-announce, it named a record or an artist in all 301 it fired on.
describe('a record back-announced that nobody handed the programme', () => {
    const cast = { names: ['Wayne', 'Garth', "Wayne's World"] };
    const said = (text: string, over: Partial<Parameters<typeof checkBeat>[0]> = {}) => beat(`${words(30)} ${text}`, { words: 40, ...cast, ...over });

    it('refuses "that was X", "that\'s been X" and "you just heard X"', () => {
        expect(said('Party on. That was Blue Monday, Wayne!')[0]).toMatch(/says "That was Blue Monday", but .* what played before it/);
        expect(said("Wow, that's been Dr. Feelgood, man.")[0]).toMatch(/says "that's been Dr. Feelgood"/);
        expect(said('and you just heard "Paranoid" right there.')[0]).toMatch(/says "you just heard Paranoid"/);
    });

    it('names the record once when the back-announce credits it too', () => {
        const problems = said('That was Blue Monday by New Order.');

        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/says "That was Blue Monday", but .* what played before it/);
    });

    it('lets through a record the programme was handed', () => {
        expect(said('That was Holy Wars, mate.', { records: [{ title: 'Holy Wars', artist: 'Megadeth' }] })).toEqual([]);
        expect(said('That was Holy Wars, mate.', { handed: ['a call about Holy Wars'] })).toEqual([]);
    });

    it('reads somebody on the programme, a day and plain English as what they are', () => {
        expect(said('Shyeah, that was Wayne being Wayne.')).toEqual([]);
        expect(said("That was Garth's idea, not mine.")).toEqual([]);
        expect(said('That was Monday, and I am still scared.')).toEqual([]);
        expect(said('That was close. That was so close, Wayne.')).toEqual([]);
    });

    // Garth's turns are in capitals by design, and a shout is not a credit.
    it('reads a shouted line as a shout', () => {
        expect(said('THAT WAS AMAZING! I am air-drumming.')).toEqual([]);
    });
});

// The shapes the station's own talk breaks back-announce in that have no capitalised run straight
// after the frame. A frame with no name after it ("that was heavy", "that was a choice") is not asked:
// across those breaks it was a reaction far more often than a record.
describe('a back-announce that names its record some other way', () => {
    const said = (text: string, over: Partial<Parameters<typeof checkBeat>[0]> = {}) =>
        beat(`${words(30)} ${text}`, { words: 40, names: ['Wayne', 'Garth', 'Rosa'], ...over });

    it('refuses a lowercase title with a credit after it', () => {
        expect(said('That was honeybee, from Olivia Rodrigo. Brave.')[0]).toMatch(/says "That was honeybee, from Olivia Rodrigo"/);
    });

    it('refuses a title that opens with a bracket', () => {
        expect(said("That was (I Can't Get No) Satisfaction, mate.")[0]).toMatch(/says "That was \(I Can't Get No\) Satisfaction"/);
    });

    it('refuses a quoted title a few words after the frame', () => {
        expect(said('That was the deadmau5 “Animal Rights”, ambitious.')[0]).toMatch(/says "That was the deadmau5 Animal Rights"/);
    });

    it('refuses a credit later in a sentence about something heard', () => {
        expect(said('we just heard that totally rad stuff from ZZ Top, man.')[0]).toMatch(/says "we just heard that totally rad stuff from ZZ Top"/);
    });

    it('refuses an act named in front of the frame', () => {
        expect(said('I, I mean, that Iron Maiden, that was bloody powerful.')[0]).toMatch(/says "that Iron Maiden, that was"/);
    });

    it('lets through a reaction, an opinion, a relative clause and a person', () => {
        expect(said('Bloody hell, that was heavy. That was a choice, Wayne.')).toEqual([]);
        expect(said('That was a gift from God, baby.')).toEqual([]);
        expect(said('That was a postcard, from Paris.', { names: ['Paris'] })).toEqual([]);
        expect(said('a quartet that has been rather consistent since the “Call of Duty” EP.')).toEqual([]);
        expect(said('I mean, that Rosa, that was lovely.')).toEqual([]);
    });

    it('lets through a credit the programme was handed', () => {
        expect(said('That was honeybee, from Olivia Rodrigo.', { handed: ['Olivia Rodrigo wrote it at nineteen.'] })).toEqual([]);
    });
});
