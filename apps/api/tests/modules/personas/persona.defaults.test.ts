// The seeds are the only personas most stations will ever have, and every mistake available in one
// is silent: a template naming a placeholder nothing can fill is dropped from the pool and looks
// exactly like a phrasing the station has never happened to pick, and a sheet with one usable marker
// declines every script the model writes and looks exactly like a model that is switched off.

import { describe, expect, it } from 'vitest';

import { SEED_PERSONAS } from '../../../src/modules/personas/persona.defaults.js';
import { SEED_CALLERS } from '../../../src/modules/personas/caller.defaults.js';
import {
    avoidedWording,
    echoedSample,
    keepsCharacter,
    MIN_DICTION_MARKERS,
    personaLines,
    PERSONA_SHEET_LIMITS,
} from '../../../src/modules/personas/persona.sheet.js';
import { parseTemplates, unknownPlaceholders, usable } from '../../../src/modules/director/break.templates.js';
import { spoken } from '../../../src/modules/director/talk.break.writer.js';

const previous = { title: 'Solid Air', artist: 'John Martyn' };
const next = { title: 'Pink Moon', artist: 'Nick Drake' };

const withTemplates = SEED_PERSONAS.filter(persona => (persona.templates ?? '').trim().length > 0);

/**
 * Both rosters, and every guard about a SHEET now runs over it.
 *
 * The sheet cases used to run over the hosts alone, which is where they were pointed when they were
 * written rather than a judgement that a caller's sheet cannot make the same mistakes. It can, and it
 * did: `dedication`'s first sample opened with its own signature word for word, which is the one
 * phrase the sheet wanted back and had quietly forbidden itself.
 *
 * What stays on {@link SEED_PERSONAS} is the two claims that are about being a HOST rather than about
 * a sheet: the phrasings below, since a caller carries none on purpose (`caller.defaults.ts` argues
 * it), and the identity guards above, whose caller halves are held by `voice.slots.test.ts`.
 */
const SEED_CHARACTERS = [...SEED_PERSONAS, ...SEED_CALLERS];

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

    it('each name a voice, so the roster does not all read in the same one', () => {
        // The opposite of what this asserted for as long as it existed, on the reasoning that only
        // the installed engine knows which ids exist. True of an ENGINE id and not of the STATION
        // name this column holds — and the cost of the old rule was nineteen written characters
        // that a listener could not tell apart. Both bundled speech plugins ship a row for every key
        // below; `voice.slots.test.ts` is what holds the three lists together.
        for (const persona of SEED_PERSONAS) {
            expect(persona.voice, `${persona.key} names no voice`).toBe(persona.key);
        }
    });

    it('name one shared soundboard rather than a set each, so a stock pack reaches all of them', () => {
        // The seeds used to name their own key, which meant six directories an operator had to keep
        // in step and a shared pack that reached nobody. They point at ONE set now, which is what
        // sets bought: drop files in a single folder and every character that wants a rack has one.
        //
        // Still a promise about a PATH — the import makes the set named after the directory — so the
        // key has to be a directory name. A space or a slash is a folder the scan reads as a
        // different set, or as two.
        //
        // Deliberately not "every seed names one", which is the opposite call to `voice` above: a
        // presenter without a rack is most of radio.
        for (const persona of SEED_PERSONAS) {
            if (persona.soundboard === undefined) continue;
            expect(persona.soundboard, `${persona.key} names a set that is not a directory name`).toMatch(/^[a-z0-9-]+$/);
            expect(persona.soundboard, `${persona.key} should share the station's own set`).toBe('station');
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
        //
        // `classic` names none at all, which is a third state rather than a smaller version of this
        // one: it is the default host, its dialect is ordinary warm English, and the markers it used
        // to carry were contractions that made its check pass on anything. See the comment on the
        // sheet, and `persona.markers.test.ts`, which is where that exemption is stated and held. It
        // is the host roster's alone — every caller names markers, because a caller with no dialect
        // is a turn nothing can tell from the presenter's.
        for (const persona of SEED_CHARACTERS) {
            if ((persona.dictionMarkers?.length ?? 0) === 0) continue;

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
        for (const persona of SEED_CHARACTERS) {
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
        for (const persona of SEED_CHARACTERS) {
            for (const catchphrase of persona.catchphrases ?? []) {
                const echoed = echoedSample(persona, catchphrase);

                expect(echoed, `${persona.key}'s "${catchphrase}" is unusable: it echoes "${echoed}"`).toBeUndefined();
            }
        }
    });

    // Two lines of one sheet saying opposite things about one word: the marker line asks for it in
    // every break and the catchphrase line rations it. `spentCatchphrases` resolves it in the
    // dialect's favour so an operator's sheet cannot be refused for obeying itself, but a seed
    // should not be posing the question. `wisecrack` shipped "Anyway" as both.
    it('carry no signature that is also one of their own diction markers', () => {
        for (const persona of SEED_CHARACTERS) {
            const markers = new Set((persona.dictionMarkers ?? []).map(marker => marker.toLowerCase()));

            for (const catchphrase of persona.catchphrases ?? []) {
                expect(markers.has(catchphrase.toLowerCase()), `${persona.key} says "${catchphrase}" is both a marker and a signature`).toBe(false);
            }
        }
    });

    // Two characters with one name is not a small mistake in a phone-in. `production.cast.ts` copies
    // `djName` onto a cast member and `production.prompt.ts` renders each one as `${name}, ${role}`
    // in a single system turn, so a host and a caller sharing a name hand a local model two speakers
    // it cannot tell apart — and the pairs that collided were the ones most likely to be cast
    // together: the countdown host and the caller who wants proof were both Dale, and the night-desk
    // detective and the listener awake at four were both Sam.
    //
    // FIRST names, because that is what the failure is made of. "Sam Kessler" and "Sam" are two
    // names to a string comparison and one name to anybody listening.
    it('go by names nobody else on either roster answers to', () => {
        const claimed = new Map<string, string>();

        for (const persona of SEED_CHARACTERS) {
            const name = persona.djName?.trim().split(/\s+/)[0]?.toLowerCase();

            if (name === undefined || name.length === 0) continue;

            const already = claimed.get(name);

            expect(already, `${persona.key} goes by the same name as ${already}: "${persona.djName}"`).toBeUndefined();
            claimed.set(name, persona.key);
        }
    });

    // Membership rather than content, since what a character is on about is a judgement. What is
    // checkable is that the field was filled in at all: a seed with none is a character the operator
    // sees a box for and never hears anything out of.
    //
    // This case used to carry an exemption, for the shipping-forecast announcer, whose quirks said in
    // as many words that it has no opinions — a preoccupation is an interior life and a bulletin with
    // one is a different character wearing the same cadence. That seed has been retired, so the
    // exemption has nothing to be about and the rule is flat again. A seed that ships empty is still
    // worth having, since it is the state an operator's own new character starts in; whoever writes
    // the next one puts the branch back rather than leaving the field to be inferred.
    it('all have something they keep coming back to', () => {
        for (const persona of SEED_CHARACTERS) {
            expect(persona.preoccupations?.length ?? 0, `${persona.key} has nothing on its mind`).toBeGreaterThan(2);
        }
    });

    // Past the cap an entry reaches no prompt, and a duplicate is silently dropped by the sheet's own
    // normalizer — both of which look from the console like a list that is longer than the rotation
    // it actually has.
    it('keep every subject inside the cap, and none of them twice', () => {
        for (const persona of SEED_CHARACTERS) {
            const subjects = persona.preoccupations ?? [];
            const distinct = new Set(subjects.map(subject => subject.trim().toLowerCase()));

            expect(subjects.length, `${persona.key} has subjects past the cap that no break will see`).toBeLessThanOrEqual(
                PERSONA_SHEET_LIMITS.preoccupations,
            );
            expect(distinct.size, `${persona.key} lists the same subject twice`).toBe(subjects.length);
        }
    });

    // The same trap as the samples below, one field up: a subject carrying wording the sheet forbids
    // goes into the prompt as the thing to talk about and comes back as the thing that gets the
    // script refused.
    it('name no subject in wording they forbid', () => {
        for (const persona of SEED_CHARACTERS) {
            for (const subject of persona.preoccupations ?? []) {
                expect(avoidedWording(persona, subject), `${persona.key} is on about wording it forbids: "${subject}"`).toEqual([]);
            }
        }
    });

    // `avoid` is now read back against what the model wrote, so a seed that forbids its own wording
    // declines every break that follows the example it was given.
    it('forbid no wording their own samples use', () => {
        for (const persona of SEED_CHARACTERS) {
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
