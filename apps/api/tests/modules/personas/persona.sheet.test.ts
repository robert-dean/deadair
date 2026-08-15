// A persona's character sheet, which is pure and therefore the one part of a persona that can be
// pinned without a model, a database or a voice. Two things are worth holding still here: the caps,
// because a sheet that crowds out the grounding rules is how a persona starts costing the station
// accuracy, and the marker matching, which is what makes "still in character" a check rather than a
// hope.

import { describe, expect, it } from 'vitest';

import {
    dictionMarkersIn,
    keepsCharacter,
    matchesDictionMarker,
    MIN_DICTION_MARKERS,
    personaLines,
    personaVoiceReminder,
    PERSONA_SHEET_LIMITS,
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
        expect(lines[1]).toContain(`At least ${MIN_DICTION_MARKERS}`);
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

    it('asks for the grammar of its examples and not their sentences', () => {
        const lines = personaLines({ samples: ['Ahoy, me hearty.'] });

        expect(lines.join('\n')).toContain('reuse the grammar, never the sentences');
        expect(lines).toContain('- "Ahoy, me hearty."');
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

    it('is not fooled by a single hit, which is as likely to be a coincidence as a dialect', () => {
        expect(keepsCharacter({ dictionMarkers: ['you', 'ye', 'matey'] }, 'That was Pink Moon, and you can hear it again later.')).toBe(false);
    });

    // A sheet whose diction says "always contract" had every one of its markers unmatchable against
    // a model's own apostrophe, so it declined exactly the script it asked for.
    it('accepts a contracted script from a sheet whose markers are contractions', () => {
        const sheet = { dictionMarkers: ["you're", "that's", "it's", 'record'] };

        expect(keepsCharacter(sheet, 'That’s Pink Moon, and you’re hearing it here.')).toBe(true);
    });
});
