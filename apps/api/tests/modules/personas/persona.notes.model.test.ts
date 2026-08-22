// What the distil pass will and will not accept back from a model. The corpus here is the station's
// own scripts, which makes the quote check stronger than the fact pass's: a model that invented an
// observation nearly always invents the line it came from, and there is nowhere else it could have
// come from.
//
// The asymmetry between the two kinds is what most of this is about. A `said` note is a claim about
// one line and can be checked; a `trait` note is an inference across several and cannot be, which is
// why one goes into use and the other waits for a person.

import { describe, expect, it } from 'vitest';

import { distilPrompt, readNotes, verified, MAX_MODEL_NOTES, MAX_NOTE_CHARS } from '../../../src/modules/personas/persona.notes.model.js';

const scripts = [
    'That was Green Onions, and shipmate, Booker T. and the boys are the tightest band alive.',
    'Coming up, Pink Moon. Steady on, shipmate.',
    'Solid Air next, and shipmate, this one is worth the wait.',
];

const answer = (notes: unknown) => JSON.stringify({ notes });

describe('distilPrompt', () => {
    it('names both kinds and says what separates them', () => {
        const [system] = distilPrompt({ label: 'Pirate captain', style: 'a pirate captain' }, scripts);

        expect(system?.content).toMatch(/"said"/);
        expect(system?.content).toMatch(/"trait"/);
        expect(system?.content).toMatch(/Not a one-off/);
    });

    it('asks for the quote verbatim, which is the only thing making an answer checkable', () => {
        const [system] = distilPrompt({ label: 'Pirate captain', style: 'a pirate captain' }, scripts);

        expect(system?.content).toMatch(/character for character/);
        expect(system?.content).toMatch(/Do not paraphrase/);
    });

    // Stated as normal rather than as a failure, on `extractPrompt`'s measured argument: a model that
    // believes an empty answer is a wrong answer fills it, and here the filling becomes the character.
    it('tells the model that noticing nothing is an ordinary answer', () => {
        const [system] = distilPrompt({ label: 'Pirate captain', style: 'a pirate captain' }, scripts);

        expect(system?.content).toMatch(/empty list\. That is a normal answer/);
    });

    it('withholds the things the sheet already carries', () => {
        // A pass that noted the catchphrases would be writing the sheet back into the prompt, which
        // is where they already are — and would teach the character to lean on them harder.
        const [system] = distilPrompt({ label: 'Pirate captain', style: 'a pirate captain' }, scripts);

        expect(system?.content).toMatch(/Do not note their accent, their grammar or their catchphrases/);
    });

    it('puts the scripts and the character in the user turn', () => {
        const [, user] = distilPrompt({ label: 'Pirate captain', style: 'a pirate captain' }, scripts);

        expect(user?.content).toContain('Pirate captain');
        expect(user?.content).toContain('Booker T. and the boys are the tightest band alive');
    });
});

describe('readNotes', () => {
    it('keeps a note whose quote is really in the corpus', () => {
        const found = readNotes(
            answer([{ kind: 'said', note: 'called Booker T. and the boys the tightest band alive', quote: 'the tightest band alive' }]),
            scripts,
        );

        expect(found).toHaveLength(1);
        expect(found[0]?.kind).toBe('said');
    });

    // The cheapest lie detector available, and the whole reason the prompt asks for a quote at all: a
    // model that invented the observation almost always invents the line it came from.
    it('drops a note whose quote the station never said', () => {
        const found = readNotes(answer([{ kind: 'said', note: 'called them overrated', quote: 'Booker T. are overrated' }]), scripts);

        expect(found).toEqual([]);
    });

    // A quote spanning two breaks is a thing the station never said in one breath, and joining the
    // corpus with an ordinary newline would let it through.
    it('drops a quote that spans two separate breaks', () => {
        const found = readNotes(
            answer([{ kind: 'said', note: 'ran two records together', quote: 'the tightest band alive.\nComing up, Pink Moon' }]),
            scripts,
        );

        expect(found).toEqual([]);
    });

    // Unlike `fact.model.ts`'s category, which falls back. A kind decides whether the operator is
    // asked about this at all, so guessing it would either put an unverified inference on air or bury
    // a checked one in a queue.
    it('drops a note whose kind the model made up rather than guessing at it', () => {
        const found = readNotes(answer([{ kind: 'observation', note: 'says shipmate a lot', quote: 'Steady on, shipmate.' }]), scripts);

        expect(found).toEqual([]);
    });

    it('reads through the fencing and the reasoning a local model puts in front of its JSON', () => {
        const wrapped = `Here is what I noticed.\n\`\`\`json\n${answer([{ kind: 'trait', note: 'calls the listener shipmate', quote: 'Steady on, shipmate.' }])}\n\`\`\``;

        expect(readNotes(wrapped, scripts)).toHaveLength(1);
    });

    it('drops a note longer than the column will take', () => {
        const found = readNotes(answer([{ kind: 'said', note: 'x'.repeat(MAX_NOTE_CHARS + 1), quote: 'Steady on, shipmate.' }]), scripts);

        expect(found).toEqual([]);
    });

    it('deduplicates and stops at the limit', () => {
        const many = Array.from({ length: MAX_MODEL_NOTES + 4 }, (_, index) => ({
            kind: 'trait',
            note: `a habit numbered ${index}`,
            quote: 'Steady on, shipmate.',
        }));

        expect(readNotes(answer([...many, { kind: 'trait', note: 'a habit numbered 0', quote: 'Steady on, shipmate.' }]), scripts)).toHaveLength(
            MAX_MODEL_NOTES,
        );
    });

    it('answers with nothing for an answer that is not JSON at all', () => {
        expect(readNotes('I could not find anything worth noting.', scripts)).toEqual([]);
    });
});

describe('verified', () => {
    // Shared with the fact pass rather than restated, because it is the same question about the same
    // kind of thing. Pinned here so a change there cannot quietly loosen this.
    it('takes only a yes, and reads silence as a no', () => {
        expect(verified('yes')).toBe(true);
        expect(verified('  "Yes", the text says that.')).toBe(true);
        expect(verified('no')).toBe(false);
        expect(verified('')).toBe(false);
    });
});
