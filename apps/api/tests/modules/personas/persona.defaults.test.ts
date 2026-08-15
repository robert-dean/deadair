// The seeds are the only personas most stations will ever have, and every mistake available in one
// is silent: a template naming a placeholder nothing can fill is dropped from the pool and looks
// exactly like a phrasing the station has never happened to pick, and a sheet with one usable marker
// declines every script the model writes and looks exactly like a model that is switched off.

import { describe, expect, it } from 'vitest';

import { SEED_PERSONAS } from '../../../src/modules/personas/persona.defaults.js';
import { avoidedWording, echoedSample, keepsCharacter, MIN_DICTION_MARKERS, personaLines } from '../../../src/modules/personas/persona.sheet.js';
import { parseTemplates, unknownPlaceholders, usable } from '../../../src/modules/director/break.templates.js';
import { spoken } from '../../../src/modules/director/talk.break.writer.js';

const previous = { title: 'Solid Air', artist: 'John Martyn' };
const next = { title: 'Pink Moon', artist: 'Nick Drake' };

const withTemplates = SEED_PERSONAS.filter(persona => (persona.templates ?? '').trim().length > 0);

describe('the seeded personas', () => {
    it('all have a key, a label and somebody to be', () => {
        for (const persona of SEED_PERSONAS) {
            expect(persona.key, 'every seed needs a key').toMatch(/^[a-z]+$/);
            expect(persona.label.length, `${persona.key} needs a label`).toBeGreaterThan(0);
            expect(persona.style.length, `${persona.key} needs a style`).toBeGreaterThan(0);
        }
    });

    it('have keys nobody duplicated, since the station stores them unique', () => {
        const keys = SEED_PERSONAS.map(persona => persona.key);

        expect(new Set(keys).size).toBe(keys.length);
    });

    it('name no voice, because only the installed engine knows which ids exist', () => {
        for (const persona of SEED_PERSONAS) {
            expect(persona.voice, `${persona.key} must not pin a voice`).toBeUndefined();
        }
    });

    it('render a sheet the model can actually use', () => {
        for (const persona of SEED_PERSONAS) {
            expect(personaLines(persona).length, `${persona.key} rendered an empty sheet`).toBeGreaterThan(0);
        }
    });

    it('carry enough markers to be checkable without being unfair', () => {
        // A sheet with one marker declines almost every script, which reads from the console as a
        // model that is off rather than a persona that is strict.
        for (const persona of SEED_PERSONAS) {
            expect(persona.dictionMarkers?.length ?? 0, `${persona.key} has too few markers to judge a break by`).toBeGreaterThanOrEqual(
                MIN_DICTION_MARKERS * 3,
            );
        }
    });

    // The calibration test, and the one that caught the floor being wrong. `samples` are the lines
    // the prompt hands a model saying "reuse the grammar" — so a sample its own sheet would decline
    // is the station asking for something and then refusing it. At a floor of two, six of these
    // failed, including both of `wisecrack`'s, and the floor was what was wrong rather than the
    // writing. Anything that raises MIN_DICTION_MARKERS or tightens the match has to face this.
    it('write sample lines their own guard would let on air', () => {
        for (const persona of SEED_PERSONAS) {
            for (const sample of persona.samples ?? []) {
                expect(keepsCharacter(persona, sample), `${persona.key} would decline its own sample: "${sample}"`).toBe(true);
            }
        }
    });

    // The sibling calibration, for the rule that a sample may not be echoed. A catchphrase is the one
    // thing a sheet asks to be REUSED, so a sheet whose sample carries its own signature long enough
    // to trip the echo rule has quietly forbidden the one phrase it wanted back — and it would look
    // from the console exactly like a model refusing to use it.
    it('write signatures long enough to say without echoing a sample line', () => {
        for (const persona of SEED_PERSONAS) {
            for (const catchphrase of persona.catchphrases ?? []) {
                const echoed = echoedSample(persona, catchphrase);

                expect(echoed, `${persona.key}'s "${catchphrase}" is unusable: it echoes "${echoed}"`).toBeUndefined();
            }
        }
    });

    // `avoid` is now read back against what the model wrote, so a seed that forbids its own wording
    // declines every break that follows the example it was given.
    it('forbid no wording their own samples use', () => {
        for (const persona of SEED_PERSONAS) {
            for (const sample of persona.samples ?? []) {
                expect(avoidedWording(persona, sample), `${persona.key}'s sample uses wording it forbids: "${sample}"`).toEqual([]);
            }
        }
    });
});

describe('the phrasings the seeded personas carry', () => {
    it('name nothing the station cannot fill', () => {
        for (const persona of withTemplates) {
            for (const template of parseTemplates(persona.templates)) {
                expect(unknownPlaceholders(template), `${persona.key}: "${template}"`).toEqual([]);
            }
        }
    });

    it('can write a break between two records', () => {
        for (const persona of withTemplates) {
            const fits = usable(parseTemplates(persona.templates), { previous, next, station: 'Deadair' }, spoken);

            expect(fits.length, `${persona.key} could not phrase a break between two records`).toBeGreaterThan(0);
        }
    });

    it('can write one at the end of an order, with nothing to promise', () => {
        // The case a station reaches every time a refill has not landed yet. A persona whose every
        // phrasing needs a `next` is silent there.
        for (const persona of withTemplates) {
            const fits = usable(parseTemplates(persona.templates), { previous, station: 'Deadair' }, spoken);

            expect(fits.length, `${persona.key} could not back-announce on its own`).toBeGreaterThan(0);
        }
    });

    it('can write one at the top of an order, with nothing behind it', () => {
        for (const persona of withTemplates) {
            const fits = usable(parseTemplates(persona.templates), { next, station: 'Deadair' }, spoken);

            expect(fits.length, `${persona.key} could not introduce a record on its own`).toBeGreaterThan(0);
        }
    });

    it('has one that knows what time it is', () => {
        // Not required of a persona an operator writes, but a seed that ignores the clock makes the
        // station's own clock bands look broken on every station that adopts it.
        for (const persona of withTemplates) {
            const timed = usable(parseTemplates(persona.templates), { previous, next, station: 'Deadair', clock: 'just after nine' }, spoken).filter(
                one => one.script.includes('just after nine'),
            );

            expect(timed.length, `${persona.key} has no phrasing that can say the time`).toBeGreaterThan(0);
        }
    });
});
