// Every case below is a reading that would have gone to air. The ones worth reading twice are at the
// bottom: the ORDER of the passes (a lexicon entry made of symbols has to be seen before `&` becomes
// "and"), the numbers this deliberately does not touch (a plain integer, an undotted run of capitals),
// and the rule that a transposition which came out empty answers with the script instead of silence.

import { describe, expect, it } from 'vitest';

import { transposeForSpeech } from '../../../src/modules/render/speech.transpose.js';
import type { Pronunciation } from '../../../src/modules/render/pronunciation.lexicon.js';

const say = (text: string, entries: readonly Pronunciation[] = []): string => transposeForSpeech(text, entries);

describe('transposeForSpeech: what is not speech', () => {
    it('takes markdown off without taking the words', () => {
        expect(say('That was **really** something, `honestly`.')).toBe('That was really something, honestly.');
    });

    it('drops an emoji rather than reading it', () => {
        expect(say('Lovely stuff 🎧 next up.')).toBe('Lovely stuff next up.');
    });

    it('drops a URL, which is the one thing worse than saying nothing', () => {
        expect(say('More at https://example.com/shows tonight.')).toBe('More at tonight.');
    });

    it('reads typographic marks as plain ones', () => {
        expect(say('It’s a “classic” — obviously…')).toBe('It\'s a "classic", obviously...');
    });

    it('reads a dash as the pause it stands for, rather than as a character', () => {
        // Measured against the station's own scripts: a model writing in character reaches for an em
        // dash constantly, and a hyphen left in its place is read aloud by some engines.
        expect(say('Deadair—feel it.')).toBe('Deadair, feel it.');
    });

    it('makes each line its own sentence, so two headlines do not run together', () => {
        expect(say('Rain again tomorrow\nThe bridge reopens\nBack to the music.')).toBe(
            'Rain again tomorrow. The bridge reopens. Back to the music.',
        );
    });

    it('leaves punctuation a line already ended with', () => {
        expect(say('Rain again tomorrow.\nThe bridge reopens.')).toBe('Rain again tomorrow. The bridge reopens.');
    });
});

describe('transposeForSpeech: symbols that stand in for words', () => {
    it('says an ampersand', () => {
        expect(say('Simon & Garfunkel there.')).toBe('Simon and Garfunkel there.');
        expect(say('A bit of R&B next.')).toBe('A bit of R and B next.');
    });

    it('says a credit abbreviation', () => {
        expect(say('Drake feat. Wizkid next.')).toBe('Drake featuring Wizkid next.');
        expect(say('Jay-Z ft. Alicia Keys next.')).toBe('Jay-Z featuring Alicia Keys next.');
    });

    it('says the small change', () => {
        expect(say('Blur vs. Oasis, and a chat w/ the producer.')).toBe('Blur versus Oasis, and a chat with the producer.');
        expect(say('That was No. 1 for nine weeks.')).toBe('That was number one for nine weeks.');
        expect(say('Straight in at #1.')).toBe('Straight in at number one.');
        expect(say('Up 40% on last year.')).toBe('Up 40 percent on last year.');
        expect(say('Dr. Dre and St. Vincent, etc.')).toBe('Doctor Dre and Saint Vincent, et cetera');
    });

    it('says a figure of money after the figure', () => {
        expect(say('Tickets were $5.99 back then.')).toBe('Tickets were 5.99 dollars back then.');
    });

    // Aired four times as "seventeen point one dollars billion", because the marker went in after the
    // digits rather than after the amount. See `MONEY`.
    describe('an amount with a scale word', () => {
        it('says the currency after the whole amount, not between the figure and its scale', () => {
            expect(say('Meta will pay up to $17.1 Billion in the settlement.')).toBe('Meta will pay up to 17.1 Billion dollars in the settlement.');
            expect(say('A $100 billion spaceport.')).toBe('A 100 billion dollars spaceport.');
            expect(say('Settling for $2.8 million.')).toBe('Settling for 2.8 million dollars.');
        });

        it('spells an abbreviated scale out rather than leaving the engine a letter', () => {
            expect(say('It raised $100K last month.')).toBe('It raised 100 thousand dollars last month.');
            expect(say('A $5m deal.')).toBe('A 5 million dollars deal.');
            expect(say('Worth $2bn today.')).toBe('Worth 2 billion dollars today.');
        });

        // The `\b` after the abbreviation, from both sides: a spelled scale must not be eaten by the
        // letter branch, and a product name after a price is not a scale at all.
        it('leaves a word that merely starts with a scale letter alone', () => {
            expect(say('The $249.99 Plaud recorder.')).toBe('The 249.99 dollars Plaud recorder.');
            expect(say('It costs $30 more.')).toBe('It costs 30 dollars more.');
            expect(say('About $5 million.')).toBe('About 5 million dollars.');
        });

        it('still says a bare price with nothing after it', () => {
            expect(say('Down from $349.99.')).toBe('Down from 349.99 dollars.');
        });

        // Aired as "750, dollars save": the digits ended on a comma as happily as on a digit, so a
        // price at the end of a clause took the clause's punctuation into the amount.
        it('takes a thousands separator into the figure and a clause comma out of it', () => {
            expect(say('A $103,000 fee.')).toBe('A 103,000 dollars fee.');
            expect(say('It was $8, you know.')).toBe('It was 8 dollars, you know.');
            expect(say('A deal at $750, save almost $500 on it.')).toBe('A deal at 750 dollars, save almost 500 dollars on it.');
        });
    });
});

describe('transposeForSpeech: numbers', () => {
    it('says a year as a person says it', () => {
        expect(say('That was 1984.')).toBe('That was nineteen eighty-four.');
        expect(say('Recorded in 1900.')).toBe('Recorded in nineteen hundred.');
        expect(say('Recorded in 1905.')).toBe('Recorded in nineteen oh five.');
        expect(say('Back in 2003.')).toBe('Back in two thousand and three.');
        expect(say('Back in 2016.')).toBe('Back in twenty sixteen.');
    });

    it('says a decade', () => {
        expect(say('Pure 1980s.')).toBe('Pure nineteen eighties.');
        expect(say("Pure '80s.")).toBe('Pure eighties.');
        expect(say('Pure 90s stuff.')).toBe('Pure nineties stuff.');
    });

    it('says a clock face', () => {
        expect(say('It is 9:00 here.')).toBe("It is nine o'clock here.");
        expect(say('It is 9:30 here.')).toBe('It is nine thirty here.');
        expect(say('It is 9:05 here.')).toBe('It is nine oh five here.');
    });

    it('says an ordinal and the idiom that is not a fraction', () => {
        expect(say('Their 3rd album, on air 24/7.')).toBe('Their third album, on air twenty-four seven.');
        expect(say('The 21st of the month.')).toBe('The twenty-first of the month.');
    });

    it('leaves a plain number to the engine, which is why a title survives', () => {
        expect(say('That was 99 Luftballons.')).toBe('That was 99 Luftballons.');
        expect(say('That was Blink-182.')).toBe('That was Blink-182.');
        expect(say('Top 40 all the way.')).toBe('Top 40 all the way.');
    });
});

describe('transposeForSpeech: initialisms', () => {
    it('spells out a dotted form, whatever it is', () => {
        expect(say('That was M.I.A. there.')).toBe('That was M I A there.');
        expect(say('First played on the b.b.c.')).toBe('First played on the B B C');
    });

    it('spells out the handful a station says all day', () => {
        expect(say('Your DJ on UK radio, live on FM.')).toBe('Your D J on U K radio, live on F M.');
        expect(say('A new EP out today.')).toBe('A new E P out today.');
    });

    it('leaves an undotted run of capitals alone, because nothing knows how it is said', () => {
        expect(say('That was ABBA, and then MGMT.')).toBe('That was ABBA, and then MGMT.');
    });

    it('does not mistake a word for a country', () => {
        expect(say('That one is between us.')).toBe('That one is between us.');
    });
});

describe('transposeForSpeech: the operator’s list', () => {
    const entries: readonly Pronunciation[] = [
        { written: 'P!nk', spoken: 'Pink' },
        { written: 'AC/DC', spoken: 'A C D C' },
        { written: 'Sade', spoken: 'Shar-day' },
    ];

    it('runs before the symbols, so a name made of them still matches', () => {
        // The proof: `!` and `/` would both be gone by the time the symbol pass has finished, and
        // neither entry could ever fire again.
        expect(say('P!nk into AC/DC.', entries)).toBe('Pink into A C D C.');
    });

    it('applies alongside the rules rather than instead of them', () => {
        expect(say('Sade & friends, 1984.', entries)).toBe('Shar-day and friends, nineteen eighty-four.');
    });
});

describe('transposeForSpeech: settling', () => {
    it('turns a separator into a pause and drops decoration', () => {
        expect(say('Either/or, honestly ~ your call.')).toBe('Either or, honestly your call.');
    });

    it('does not leave a space in front of its punctuation', () => {
        expect(say('Lovely stuff 🎧, next up.')).toBe('Lovely stuff, next up.');
    });

    it('answers with the script when the passes leave nothing', () => {
        // A "script" of nothing but decoration. Saying it oddly is recoverable; a segment that
        // renders silence is a hole in the hour.
        expect(say('***')).toBe('***');
        expect(say('🎧')).toBe('🎧');
    });

    it('answers with the same words when there is nothing to change', () => {
        expect(say('That was Fleetwood Mac, and this is the news.')).toBe('That was Fleetwood Mac, and this is the news.');
    });
});

// A cue reaching here has already been cleared: `SpeechService.sayable` removed every one the chosen
// engine did not claim, so this file's only job is not to destroy what is left. That is harder than
// it sounds, because the drop-list two lines above it exists to eat exactly this shape.
describe('transposeForSpeech: performance cues', () => {
    it('leaves a cue intact, brackets and all', () => {
        expect(say('That was Nick Drake. [laugh] No idea what follows that.')).toBe('That was Nick Drake. [laugh] No idea what follows that.');
    });

    it('still drops every other bracket, which is what the sparing is carved out of', () => {
        // The brackets and not the word, which is this file's long-standing division of labour: it
        // handles what a string can be PRONOUNCED as, and removing a stage direction wholesale is
        // `readAnswer`'s job one step upstream. What matters here is that `[warmly]` does not come
        // out looking like notation an engine should act on.
        expect(say('[warmly] Hello there.')).toBe('warmly Hello there.');
    });

    it('spares a lone bracket no more than it did before', () => {
        expect(say('A [ stray bracket.')).toBe('A stray bracket.');
    });

    // The bug the one-alternation form was chosen to avoid. A sentinel like `#CUELAUGH#` loses its
    // hashes to the drop-list, and putting the brackets back around a bare `CUE(\w+)` rewrites any
    // capitalised word containing those three letters.
    it('does not mangle a capitalised word that happens to contain CUE', () => {
        expect(say('RESCUED from the bargain bin.')).toBe('RESCUED from the bargain bin.');
    });

    it('normalises the case a cue was written in, since the engine is given one spelling', () => {
        expect(say('[LAUGH] Right then.')).toBe('[laugh] Right then.');
    });

    it('keeps a cue through the passes that rewrite what is around it', () => {
        expect(say('[sigh] Sade & friends, 1984.', [{ written: 'Sade', spoken: 'Shar-day' }])).toBe(
            '[sigh] Shar-day and friends, nineteen eighty-four.',
        );
    });

    // Not a fault, and pinned rather than discovered: a line ending in `]` does not match the
    // sentence-final test in `joinLines`, so it gains the full stop every other line would.
    it('punctuates a line that ends on a cue like any other line', () => {
        expect(say('Here we go [laugh]\nAnd we are back.')).toBe('Here we go [laugh]. And we are back.');
    });
});
