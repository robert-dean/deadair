// A persona's character sheet, which is pure and therefore the one part of a persona that can be
// pinned without a model, a database or a voice. Two things are worth holding still here: the caps,
// because a sheet that crowds out the grounding rules is how a persona starts costing the station
// accuracy, and the marker matching, which is what makes "still in character" a check rather than a
// hope.

import { describe, expect, it } from 'vitest';

import {
    avoidedWording,
    characterFault,
    dictionMarkersIn,
    echoedSample,
    keepsCharacter,
    matchesDictionMarker,
    MAX_SAMPLE_ECHO_WORDS,
    MIN_DICTION_MARKERS,
    personaLines,
    personaVoiceReminder,
    PERSONA_SHEET_LIMITS,
    spentCatchphrases,
} from '../../../src/modules/personas/persona.sheet.js';

describe('personaLines', () => {
    it('renders nothing at all for a sheet carrying nothing', () => {
        expect(personaLines({})).toEqual([]);
    });

    it('leads with the dialect, because it governs every sentence and the rest do not', () => {
        const lines = personaLines({ diction: ['Ye for you'], quirks: ['Every record is plunder'] });

        expect(lines[0]).toContain('every sentence');
        expect(lines[0]).toContain('Ye for you');
        expect(lines[1]).toContain('Every record is plunder');
    });

    // They are what `keepsCharacter` counts, so a sheet that did not send them was grading a writer
    // on a rubric it could not read.
    it('names the markers it will be counting, right after the diction they evidence', () => {
        const lines = personaLines({ diction: ['Ye for you'], dictionMarkers: ['ye', 'aye', 'matey'] });

        expect(lines[1]).toContain('ye, aye, matey');
        expect(lines[1]).toContain(`at least ${MIN_DICTION_MARKERS}`);
        // Not a list to work through: a break using all of them is a parody of the character.
        expect(lines[1]).toContain('never all at once');
    });

    it('renders no marker line for a sheet that named none, which is the sheet that makes no claim', () => {
        expect(personaLines({ diction: ['Ye for you'] })).toHaveLength(1);
    });

    it('caps each list, so a sheet stays a sheet', () => {
        const quirks = Array.from({ length: PERSONA_SHEET_LIMITS.quirks + 4 }, (_, at) => `quirk ${at}`);
        const rendered = personaLines({ quirks }).join('\n');

        expect(rendered).toContain(`quirk ${PERSONA_SHEET_LIMITS.quirks - 1}`);
        expect(rendered).not.toContain(`quirk ${PERSONA_SHEET_LIMITS.quirks}`);
    });

    it('drops blanks and repeats rather than rendering them', () => {
        const lines = personaLines({ quirks: ['  ', 'Never oversell', 'never OVERSELL', ''] });

        expect(lines).toHaveLength(1);
        expect(lines[0]).toBe('In character: Never oversell.');
    });

    it('asks for a catchphrase sparingly rather than for every break', () => {
        expect(personaLines({ catchphrases: ['Arrr'] })[0]).toContain('at most one, and not every time');
    });

    // The positive half of the rule the user turn enforces. A model told only what it may not say
    // fills the hole with a sample line, which is the failure one rule over.
    it('offers a line of the writer’s own as better than repeating a signature', () => {
        expect(personaLines({ catchphrases: ['Arrr'] })[0]).toContain('A new line of your own');
    });

    it('asks for the grammar of its examples and not their sentences', () => {
        const lines = personaLines({ samples: ['Ahoy, me hearty.'] });

        expect(lines.join('\n')).toContain('reuse the grammar, never the sentences');
        expect(lines).toContain('- "Ahoy, me hearty."');
    });

    // An instruction whose enforcement is invisible is one a model has no reason to weigh against
    // the pull of the example sitting in front of it. `echoedSample` is what makes this true.
    it('says what happens to a lifted line, because now something happens to it', () => {
        expect(personaLines({ samples: ['Ahoy, me hearty.'] }).join('\n')).toContain('thrown away');
    });

    it('takes a tighter example count when a caller has less room', () => {
        const lines = personaLines({ samples: ['one', 'two', 'three'] }, { maxExamples: 1 });

        expect(lines.filter(line => line.startsWith('- '))).toHaveLength(1);
    });
});

describe('personaVoiceReminder', () => {
    it('is nothing for a sheet with no dialect to restate', () => {
        expect(personaVoiceReminder({ quirks: ['Never oversell'] })).toBeUndefined();
    });

    it('restates the dialect and says plain English is wrong even for a fact', () => {
        const reminder = personaVoiceReminder({ diction: ['Ye for you', 'Drop the g from -ing', 'Aye for yes'] }) ?? '';

        expect(reminder).toContain('Ye for you');
        // Two clauses, not the whole sheet: this shares the recency position with the content rules
        // rather than taking it from them.
        expect(reminder).not.toContain('Aye for yes');
        expect(reminder).toContain('stating a fact');
    });
});

describe('matchesDictionMarker', () => {
    it('matches whole words rather than fragments', () => {
        expect(matchesDictionMarker('aye', 'Aye, that be the one')).toBe(true);
        expect(matchesDictionMarker('aye', 'The player was cut short')).toBe(false);
    });

    it('treats a trailing apostrophe as a suffix, so every dropped-g verb counts', () => {
        expect(matchesDictionMarker("in'", "We be sailin' on")).toBe(true);
        expect(matchesDictionMarker("in'", 'We are sailing on')).toBe(false);
    });

    it('does not match inside a longer contraction', () => {
        expect(matchesDictionMarker('ye', "That's yer lot")).toBe(false);
    });

    it('ignores a blank marker rather than matching everything', () => {
        expect(matchesDictionMarker('   ', 'anything at all')).toBe(false);
    });

    // A model writes `that’s` far more often than `that's`, and a sheet is typed by hand. Both
    // directions, because the two failures used to hide each other.
    describe('a curly apostrophe', () => {
        it('matches a marker the sheet wrote straight', () => {
            expect(matchesDictionMarker("that's", 'That’s Sepultura, and it’s a big one')).toBe(true);
            expect(matchesDictionMarker("in'", 'You’re listenin’ to it')).toBe(true);
        });

        it('matches a script that wrote it straight, whichever way round the sheet has it', () => {
            expect(matchesDictionMarker('that’s', "That's Sepultura")).toBe(true);
        });

        // The other half: the word boundary excluded a straight apostrophe and not a curly one, so
        // "you" was found inside "you’re" and the guard passed on an accident.
        it('still keeps a bare word out of a longer contraction', () => {
            expect(matchesDictionMarker('you', 'You’re listening to this')).toBe(false);
            expect(matchesDictionMarker('you', "You're listening to this")).toBe(false);
            expect(matchesDictionMarker('you', 'This one is for you')).toBe(true);
        });
    });
});

describe('dictionMarkersIn', () => {
    it('answers the distinct markers a script carries', () => {
        const found = dictionMarkersIn(['ye', 'aye', 'plunder'], 'Aye, ye have heard the last o’ that plunder, ye hearties');

        expect(found.sort()).toEqual(['aye', 'plunder', 'ye']);
    });

    it('is empty when nothing was asked for', () => {
        expect(dictionMarkersIn(undefined, 'Anything')).toEqual([]);
    });
});

describe('keepsCharacter', () => {
    it('keeps a sheet that named no markers, because it made no checkable claim', () => {
        expect(keepsCharacter({ diction: ['Ye for you'] }, 'That was Pink Moon, from Nick Drake.')).toBe(true);
    });

    it('refuses a script that came back in plain English', () => {
        const sheet = { dictionMarkers: ['ye', 'aye', 'matey', "in'"] };

        expect(keepsCharacter(sheet, 'That was Pink Moon by Nick Drake. Coming up next, Solid Air.')).toBe(false);
    });

    it('accepts one that stayed in dialect', () => {
        const sheet = { dictionMarkers: ['ye', 'aye', 'matey', "in'"] };

        expect(keepsCharacter(sheet, "Aye, ye just heard Pink Moon, and there be more comin'.")).toBe(true);
    });

    // The floor is one, because two declined the station's own sample lines. See MIN_DICTION_MARKERS.
    it('accepts a single hit, now that the markers are named in the prompt that asked for them', () => {
        expect(keepsCharacter({ dictionMarkers: ['you', 'ye', 'matey'] }, 'Ye just heard Pink Moon.')).toBe(true);
    });

    it('still refuses a script with no trace of the character at all', () => {
        expect(keepsCharacter({ dictionMarkers: ['ye', 'aye', 'matey'] }, 'That was Pink Moon, and it is on again later.')).toBe(false);
    });

    // A marker can appear in plain English by chance; a signature phrase cannot. A break ending in
    // the persona's own catchphrase was being declined as out of character.
    it('counts a catchphrase as evidence beside a marker', () => {
        const sheet = { dictionMarkers: ['genuinely', 'apparently'], catchphrases: ['Make of that what you will'] };

        expect(keepsCharacter(sheet, 'Four minutes of Kreator. Make of that what you will.')).toBe(true);
    });

    it('matches a catchphrase through the writer’s own apostrophe', () => {
        const sheet = { dictionMarkers: ['ye'], catchphrases: ["Here's another"] };

        expect(keepsCharacter(sheet, 'Here’s another one for the pile.')).toBe(true);
    });

    // Catchphrases add evidence and never create the requirement: the prompt asks for one "at most
    // once, and not every time", so a script that used none did as it was told.
    it('makes no claim from catchphrases alone, when the sheet named no markers', () => {
        expect(keepsCharacter({ catchphrases: ['Arrr'] }, 'That was Pink Moon, from Nick Drake.')).toBe(true);
    });

    // A sheet whose diction says "always contract" had every one of its markers unmatchable against
    // a model's own apostrophe, so it declined exactly the script it asked for.
    it('accepts a contracted script from a sheet whose markers are contractions', () => {
        const sheet = { dictionMarkers: ["you're", "that's", "it's", 'record'] };

        expect(keepsCharacter(sheet, 'That’s Pink Moon, and you’re hearing it here.')).toBe(true);
    });
});

// The observed failure this whole group exists for: fifteen of seventeen consecutive model breaks
// under one persona ended with a sample line or a signature reproduced word for word, and every one
// of them passed `keepsCharacter` — because a pasted catchphrase is exactly the evidence it counts.
describe('echoedSample', () => {
    const sheet = { samples: ["Okay that was rough and I picked it, so that's on me. Honestly? I'd do it again."] };

    it('catches a sample read back whole', () => {
        expect(echoedSample(sheet, "Okay that was rough and I picked it, so that's on me. Honestly? I'd do it again.")).toBeDefined();
    });

    // Both of these aired. The truncated one is why this counts a RUN rather than the whole line.
    it('catches a sample lifted as a clause into a new sentence', () => {
        expect(echoedSample(sheet, 'Oh boy, Anvil droppin’ Paranormal! Okay that was rough and I picked it.')).toBeDefined();
    });

    it('sees through punctuation, capitals and the writer’s own apostrophe', () => {
        expect(echoedSample(sheet, 'okay — that was rough, and I picked it… so that’s on me')).toBeDefined();
    });

    it('leaves a line that only shares the character’s grammar, which is what the sheet asked for', () => {
        expect(echoedSample(sheet, 'Okay, that one was my fault entirely, and I stand by it.')).toBeUndefined();
    });

    it(`lets a run of ${MAX_SAMPLE_ECHO_WORDS} words through, so a signature inside a sample is still usable`, () => {
        const short = { samples: ["You're locked in, and that's one of those records that refuses to get old."] };

        expect(echoedSample(short, "You're locked in. Nothing else to say about it.")).toBeUndefined();
    });

    it('makes no claim for a sheet with no samples', () => {
        expect(echoedSample({}, 'Anything at all.')).toBeUndefined();
    });
});

describe('avoidedWording', () => {
    // Aired under a sheet forbidding it in exactly those words, because nothing read the answer back
    // against the list the prompt had just sent.
    it('catches wording the sheet forbids', () => {
        expect(avoidedWording({ avoid: ['buckle up', 'folks'] }, 'Wow. Anyway, buckle up for what’s next.')).toEqual(['buckle up']);
    });

    it('matches words rather than characters, so a near miss is not a fault', () => {
        expect(avoidedWording({ avoid: ['folks', 'amazing'] }, 'Recorded in Folkstone, and amazingly cheap.')).toEqual([]);
    });

    // A sheet's avoid list mixes literal wording with descriptions of a subject, and only the first
    // kind is checkable. The second is an instruction to a model, and stays one.
    it('says nothing about an entry describing a subject rather than naming words', () => {
        expect(avoidedWording({ avoid: ["anything about a listener's body, money or family"] }, 'You sound broke.')).toEqual([]);
    });
});

describe('spentCatchphrases', () => {
    const sheet = { catchphrases: ['I said what I said', "Don't @ me"] };

    it('spends a signature the station has just used', () => {
        expect(spentCatchphrases(sheet, ['Wow. Ozzy just slammed that one. I said what I said.'])).toEqual(['I said what I said']);
    });

    it('spends nothing on a station with nothing behind it', () => {
        expect(spentCatchphrases(sheet, undefined)).toEqual([]);
        expect(spentCatchphrases(sheet, [])).toEqual([]);
    });

    // The seeded `wisecrack` carried "Anyway" as both, so the guard would have refused a script for
    // using a word the marker line demands of every break. Diction governs every sentence; a
    // signature is rationed. A word doing both jobs is doing the bigger one.
    it('never spends a signature that is also a diction marker', () => {
        const both = { catchphrases: ['Anyway', 'Make of that what you will'], dictionMarkers: ['anyway', 'apparently'] };
        const recent = ['Anyway, that was Kreator. Make of that what you will.'];

        expect(spentCatchphrases(both, recent)).toEqual(['Make of that what you will']);
    });
});

describe('characterFault', () => {
    const sheet = {
        dictionMarkers: ['wow', 'anyway', 'alright'],
        catchphrases: ['I said what I said'],
        avoid: ['buckle up'],
        samples: ['Wow. Four minutes of my life and yours, gone. Anyway, this next one is genuinely great.'],
    };

    it('finds no fault in a line that is the character speaking', () => {
        expect(characterFault(sheet, 'Wow. That one’s been in the rack since March and I forgot why.')).toBeUndefined();
    });

    // The whole point of the change: every one of these carries a marker, so all three passed before.
    it('names the quotation rather than passing it on the marker inside it', () => {
        expect(characterFault(sheet, 'Wow. Four minutes of my life and yours, gone. Anyway.')).toBe('quoted-sample');
    });

    it('names the forbidden wording', () => {
        expect(characterFault(sheet, 'Alright, buckle up for this next one.')).toBe('avoided-wording');
    });

    it('refuses a signature the station has just used, which is what makes "not every time" real', () => {
        const recent = ['Wow. Anyway, that was Danzig. I said what I said.'];

        expect(characterFault(sheet, 'Alright, next up is Pantera. I said what I said.', { recent })).toBe('spent-catchphrase');
    });

    // The bargain: refused only for repeating something it was shown and told not to repeat.
    it('allows the same signature when the station has not just used it', () => {
        expect(characterFault(sheet, 'Alright, next up is Pantera. I said what I said.', { recent: ['That was Ozzy. Wow.'] })).toBeUndefined();
    });

    it('still finds the plain-English line, which is the fault it started as', () => {
        expect(characterFault(sheet, 'That was Pink Moon by Nick Drake. Coming up, Solid Air.')).toBe('out-of-character');
    });

    it('finds no fault at all in a sheet that made no checkable claim', () => {
        expect(characterFault({ diction: ['Ye for you'] }, 'Anything at all.')).toBeUndefined();
    });
});
