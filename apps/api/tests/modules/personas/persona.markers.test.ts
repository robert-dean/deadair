// Whether the station's own sheets make a claim their check can actually test.
//
// `keepsCharacter` is only ever as good as the words a sheet gives it, and the way a marker list
// goes wrong is not that it is empty — the code has an honest answer for that — but that it is full
// of words the character does not own. The failure is invisible from inside one sheet: every break
// passes, the log says nothing, and the only symptom is a listener saying the eighties jock never
// once says anything eighties. That is what happened, and this file is what would have caught it.
//
// ## Cross-fire, rather than a list of banned words
//
// "A word only this character would say" cannot be enumerated in advance, but it can be MEASURED
// against the roster the station ships: a marker that fires on somebody else's sample lines is, by
// definition, not evidence of this one. The roster doubles as the corpus, so every seed added later
// tightens the test for every seed already here.
//
// The plain-English pass beside it catches the cruder half (`you`, `your`, `it's`, `here`) and is
// deliberately the WEAKER of the two — the sheet this was all learned on scored ZERO against it,
// because its markers were not ordinary English at all. They were ordinary radio, which only a
// roster of other radio voices can see.
//
// ## Why the bar is a budget and not zero
//
// Two characters who talk about the same things legitimately share vocabulary: the crate-digger and
// the caller with a theory are both about pressings and session credits, and no honest marker list
// separates them completely. A flat zero would force invented words. So the bar is per sheet, it is
// the measurement as it stands, and it is asserted as a CEILING — improving a sheet is always
// allowed and regressing one fails. Every entry below is debt with a name on it rather than a
// tolerance, which is the point of writing them out.

import { describe, expect, it } from 'vitest';

import { SEED_CALLERS } from '../../../src/modules/personas/caller.defaults.js';
import { SEED_PERSONAS } from '../../../src/modules/personas/persona.defaults.js';
import { dictionMarkersIn, keepsCharacter, MIN_DICTION_MARKERS } from '../../../src/modules/personas/persona.sheet.js';

const ROSTER = [...SEED_PERSONAS, ...SEED_CALLERS];

/**
 * Warm, correct, character-free announcer English: breaks that would pass any editor and place the
 * speaker nowhere at all. Written by hand rather than generated, because the whole claim is that a
 * READER would call every one of these plain.
 */
const PLAIN_ENGLISH = [
    "That was Blue Monday from New Order. Coming up next, we've got Kate Bush with Running Up That Hill.",
    "You're listening to the station, and that's Prince there with Kiss. Stay with us.",
    'A great record just then from Talking Heads. Here is the next one for you now.',
    "It's just after nine, and there's plenty more music on the way this hour.",
    'Tears for Fears there. I hope you enjoyed that one as much as I did.',
    'We have got a good hour ahead of us. Do not go anywhere.',
    'That is the sound of Fleetwood Mac, and there is more where that came from.',
    'Next up, something a little different for you. Turn it up.',
];

/**
 * What each sheet is currently allowed, and why. Anything not named here is held at zero.
 *
 * `crossfire` is how many OTHER characters this sheet's check passes on, out of the rest of the
 * roster. `plain` is how many of {@link PLAIN_ENGLISH} it passes on.
 */
const BUDGET: Record<string, { crossfire?: number; plain?: number; why: string }> = {
    // Not yet rewritten. All four are the same shape as the sheet that started this: a strong
    // distinctive half diluted by stock radio phrasing (`coming up`, `right now`, `that's`, `stay`),
    // which is what the numbers are counting.
    millennium: { crossfire: 8, plain: 3, why: 'stock hand-over phrasing not yet replaced' },
    quietstorm: { crossfire: 8, plain: 1, why: 'shares the late-night register with two other sheets' },
    bossjock: { crossfire: 7, plain: 1, why: 'stock hand-over phrasing not yet replaced' },
    howler: { crossfire: 6, why: 'the dropped-g suffix is shared dialect, not a mistake' },
    slacker: { crossfire: 6, why: 'flat filler is the character, and other sheets use filler too' },
    grumbler: { crossfire: 6, why: 'a caller speaks in filler by design' },
    gumshoe: { crossfire: 5, plain: 1, why: '`listen` is ordinary English' },
    shockjock: { crossfire: 3, why: 'shares its loud register with the howler, and its filler with the slacker and the grumbler' },
    pedant: { crossfire: 2, why: 'formal register overlaps the other callers' },
    forecast: { plain: 1, why: '`good` is a forecast term and an ordinary adjective' },

    // Residue on the sheets that HAVE been rewritten, kept because removing it would cost the
    // character a word it genuinely owns.
    cratedigger: { crossfire: 2, why: 'record vocabulary is shared with the pedant by subject' },
    latenight: { crossfire: 1, why: 'one collision with the night-shift caller, who is awake at the same hour' },
    pirate: { crossfire: 1, why: "`in'` is shared dialect with the howler" },
    playbyplay: { crossfire: 1, why: 'one collision with the night-shift caller' },
    // Its catchphrase is stock radio phrasing, and `keepsCharacter` counts a catchphrase as
    // evidence beside a marker — so "Stay with us" in plain English passes this sheet's check
    // without any marker firing at all. The same failure as a free marker, one field over.
    countdown: { plain: 1, why: 'the catchphrase itself is stock radio phrasing' },
};

const budgetFor = (key: string, kind: 'crossfire' | 'plain') => BUDGET[key]?.[kind] ?? 0;

/**
 * The seeds that deliberately name no markers, and so make no checkable claim.
 *
 * `keepsCharacter` passes such a sheet on purpose, which means the two measurements below are
 * VACUOUSLY true of it — it would score a perfect 23 and 8 while checking nothing at all. Exempting
 * it is therefore the only honest reading, and naming it here is what keeps the exemption from
 * spreading: a sheet in this list that grows markers fails, and a sheet outside it that loses them
 * fails too, so neither state can be reached without editing this line.
 */
const NO_CLAIM = new Set(['classic']);

const CHECKED = ROSTER.filter(persona => !NO_CLAIM.has(persona.key));

describe('the seeded roster makes checkable character claims', () => {
    it.each(ROSTER.map(persona => [persona.key, persona] as const))('%s names markers to be checked on', (_key, persona) => {
        // Not a style rule. A seed is what a fresh install lands on, and one shipping no markers
        // hands every operator a persona that cannot be told apart from plain English. An OPERATOR's
        // own sheet may name none — `keepsCharacter` passes it deliberately — but the station's own
        // characters are the ones claiming to be characters, and the exception has to be stated.
        const named = persona.dictionMarkers?.length ?? 0;

        if (NO_CLAIM.has(persona.key)) expect(named, `${persona.key} is listed as making no claim, so it may not name markers`).toBe(0);
        else expect(named).toBeGreaterThanOrEqual(MIN_DICTION_MARKERS);
    });

    it.each(ROSTER.map(persona => [persona.key, persona] as const))('%s can demonstrate its own markers', (_key, persona) => {
        // The sample lines are what the prompt shows a model as this character talking, so a sample
        // that would itself be declined is a sheet asking for something it cannot demonstrate. This
        // is what stops the two ceilings below being met with markers so exotic that nothing can
        // satisfy them.
        for (const sample of persona.samples ?? []) expect(keepsCharacter(persona, sample), `${persona.key}: ${sample}`).toBe(true);
    });
});

describe('a marker is a word only its own character would say', () => {
    it.each(CHECKED.map(persona => [persona.key, persona] as const))('%s does not pass on plain announcer English', (_key, persona) => {
        const passed = PLAIN_ENGLISH.filter(line => keepsCharacter(persona, line));
        const detail = passed.map(line => `[${dictionMarkersIn(persona.dictionMarkers, line).join(', ')}] ${line}`).join('\n');

        expect(passed.length, `${persona.key} passes its own check on character-free English:\n${detail}`).toBeLessThanOrEqual(
            budgetFor(persona.key, 'plain'),
        );
    });

    it.each(CHECKED.map(persona => [persona.key, persona] as const))('%s does not pass on another character', (_key, persona) => {
        const fired = ROSTER.filter(other => other.key !== persona.key).filter(other => (other.samples ?? []).some(s => keepsCharacter(persona, s)));

        expect(fired.length, `${persona.key} passes its own check on the voices of: ${fired.map(f => f.key).join(', ')}`).toBeLessThanOrEqual(
            budgetFor(persona.key, 'crossfire'),
        );
    });
});
