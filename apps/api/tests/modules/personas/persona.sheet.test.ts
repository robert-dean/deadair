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
    isPersonaBrevity,
    isPersonaLatitude,
    keepsCharacter,
    latitudeOf,
    LATITUDE_LICENCE,
    LATITUDE_MAX_WORDS,
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

    // A marker falls most naturally in front of everything, which is the answer nine consecutive
    // breaks opening "Yikes!" gave to "where it falls naturally". It passes `keepsCharacter` — one
    // distinct marker is one distinct marker wherever it sits — so the sheet has to ask.
    it('says where a marker goes, because a word on the front is a label rather than a voice', () => {
        const lines = personaLines({ diction: ['Ye for you'], dictionMarkers: ['ye', 'aye'] });

        expect(lines[2]).toMatch(/inside a sentence, not stuck on the front/i);
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

    // Measured: a break under `wisecrack` wrote "ambitiously" where the sheet lists "ambitious",
    // scored no evidence at all and went to the floor. A model asked for a word inflects it to fit
    // the sentence, and a marker list is written in one form because writing six is unreadable.
    describe('an inflected marker', () => {
        it('counts the same word wearing an ordinary ending', () => {
            expect(matchesDictionMarker('ambitious', 'That was ambitiously produced')).toBe(true);
            expect(matchesDictionMarker('record', 'Two records off the same shelf')).toBe(true);
            expect(matchesDictionMarker('howl', "It's been howling at the door")).toBe(true);
            expect(matchesDictionMarker('press', 'The pressed copies went out late')).toBe(true);
        });

        it('still refuses a different word that merely starts the same way', () => {
            expect(matchesDictionMarker('aye', 'The player was cut short')).toBe(false);
            expect(matchesDictionMarker('you', 'Young bands do this')).toBe(false);
            expect(matchesDictionMarker('low', 'That one is lovely')).toBe(false);
        });
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

    // Three of these four are PROHIBITIONS and one is a requirement, and only the requirement is in
    // tension with reporting the news neutrally. A bulletin used to drop the sheet entirely to
    // escape that one, which re-permitted the failure this whole file was built for — `I said what I
    // said` closing a talk break, a welcome and a news bulletin.
    describe('a kind excused the dialect', () => {
        const lean = { dialect: 'optional' } as const;

        it('lets a deliberately plain script through, which is the only reason this exists', () => {
            expect(characterFault(sheet, 'That was Pink Moon by Nick Drake. Coming up, Solid Air.', lean)).toBeUndefined();
        });

        it('still refuses a quoted sample', () => {
            expect(characterFault(sheet, 'Wow. Four minutes of my life and yours, gone. Anyway.', lean)).toBe('quoted-sample');
        });

        it('still refuses forbidden wording', () => {
            expect(characterFault(sheet, 'Here is the news, so buckle up.', lean)).toBe('avoided-wording');
        });

        it('still refuses a signature the station has just spent', () => {
            const recent = ['Wow. Anyway, that was Danzig. I said what I said.'];

            expect(characterFault(sheet, 'A bridge reopened. I said what I said.', { ...lean, recent })).toBe('spent-catchphrase');
        });

        it('requires the dialect when nobody said otherwise', () => {
            // The default has to stay `required`, or every other kind of break silently loses the
            // one check a persona exists for.
            expect(characterFault(sheet, 'That was Pink Moon by Nick Drake.')).toBe('out-of-character');
            expect(characterFault(sheet, 'That was Pink Moon by Nick Drake.', { dialect: 'required' })).toBe('out-of-character');
        });
    });
});

// Brevity is an instruction and nothing enforces it, which is the whole design: the word ceiling
// DECLINES rather than trims, so a tighter one for a terse character would refuse the median break
// and hand every one of theirs to the phrasings. These tests pin that it reaches the prompt, that it
// reaches it LAST, and that nothing else in the sheet moved to make room for it.
describe('brevity', () => {
    it("says nothing at all when the character has the station's usual length", () => {
        expect(personaLines({ quirks: ['Plays the record and shuts up'] })).toEqual(['In character: Plays the record and shuts up.']);
    });

    it('asks for less, and is the LAST thing the sheet says', () => {
        const lines = personaLines({ diction: ['Ye for you'], brevity: 'one-line' });

        // Last, so it sits against the caller's job line and the rules under it rather than among
        // the facets of a voice.
        expect(lines.at(-1)).toContain('One short sentence');
        expect(lines[0]).toContain('How you speak');
    });

    it('has a distinct instruction per rung', () => {
        const short = personaLines({ brevity: 'short' }).at(-1);
        const oneLine = personaLines({ brevity: 'one-line' }).at(-1);

        expect(short).not.toBe(oneLine);
        expect(short).toContain('leave the space');
    });

    it('ignores a rung nothing recognises, rather than putting it in front of a model', () => {
        // The column is plain text, so a row edited by hand can hold anything.
        expect(personaLines({ brevity: 'verbose' as never })).toEqual([]);
        expect(isPersonaBrevity('verbose')).toBe(false);
        expect(isPersonaBrevity('one-line')).toBe(true);
    });

    it('does not make a character checkable, since it is an instruction and not a claim', () => {
        // A sheet whose only entry is brevity has still named no markers, so nothing is refused for
        // running long — that is what `readAnswer`'s ceiling is for, and it is unchanged.
        expect(keepsCharacter({ brevity: 'one-line' }, 'A very long line indeed, going on at some considerable length.')).toBe(true);
    });
});

// The rung above the station's ordinary discipline, which brevity deliberately never grew. It is a
// separate field because what it moves is PERMISSION rather than length: the ceiling, the shape's own
// rules, and at the top rung what the character may say. The sheet only ever OFFERS one — the shape
// vetoes and the station's content policy outranks it, both of which are pinned in `break.prompt`.
describe('latitude', () => {
    it('answers nothing for a character held to the ordinary discipline', () => {
        expect(latitudeOf(undefined)).toBeUndefined();
        expect(latitudeOf({ quirks: ['Plays the record and shuts up'] })).toBeUndefined();
    });

    it('answers the rung a sheet carries', () => {
        expect(latitudeOf({ latitude: 'loose' })).toBe('loose');
        expect(latitudeOf({ latitude: 'unleashed' })).toBe('unleashed');
    });

    it('reads a rung nothing recognises as no room at all, rather than throwing on the way to a model', () => {
        // The column is plain text, so a row edited by hand can hold anything — the same reason
        // `isPersonaBrevity` guards the rung beside it.
        expect(latitudeOf({ latitude: 'feral' as never })).toBeUndefined();
        expect(isPersonaLatitude('feral')).toBe(false);
        expect(isPersonaLatitude('unleashed')).toBe(true);
    });

    it('rises with the rung', () => {
        // That these are ABOVE the station's own ceiling is pinned where the two meet, in
        // `break.prompt.test.ts` — a persona test reaching into the director for that constant would
        // be the dependency this file does not have.
        expect(LATITUDE_MAX_WORDS.unleashed).toBeGreaterThan(LATITUDE_MAX_WORDS.loose);
    });

    it('stays out of the sheet the caller renders, because a kind may not be offering it', () => {
        // `personaLines` is rendered by every kind of break. A bulletin reading its own persona's
        // sheet must not find a licence to ramble in it.
        expect(personaLines({ latitude: 'unleashed' })).toEqual([]);
    });

    it('composes with brevity rather than contradicting it', () => {
        // A terse character can be unfiltered — "Awful. Next." — so the two are not one dial. A
        // ceiling is a limit and not an instruction, and one nobody reaches costs nothing.
        expect(personaLines({ brevity: 'one-line', latitude: 'unleashed' }).at(-1)).toContain('One short sentence');
        expect(latitudeOf({ brevity: 'one-line', latitude: 'unleashed' })).toBe('unleashed');
    });

    it('makes no claim a script can be refused for, exactly like brevity', () => {
        expect(keepsCharacter({ latitude: 'unleashed' }, 'Anything at all.')).toBe(true);
        expect(characterFault({ latitude: 'unleashed' }, 'Anything at all.')).toBeUndefined();
    });

    // It said "never about the person listening" for as long as it existed, and that came out: a
    // sheet may legitimately point a character at the listener — the shipped `wisecrack` is — and a
    // prompt carrying both that quirk and a licence forbidding it is two rules that disagree, which
    // a model resolves by hedging between them. The licence decides the register; the sheet decides
    // the target. See `LATITUDE_LICENCE`.
    it('licences the register and names a target without forbidding one', () => {
        expect(LATITUDE_LICENCE).toMatch(/swear if you would swear/i);
        expect(LATITUDE_LICENCE).toMatch(/rude about the record, the industry and yourself/i);
        expect(LATITUDE_LICENCE).not.toMatch(/never about the person listening/i);
    });
});
