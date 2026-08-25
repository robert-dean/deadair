// The station's voice names are a vocabulary held in three places that cannot import each other: the
// persona seeds say which names exist, and each bundled speech plugin says what they sound like on
// its own engine. Nothing at runtime checks that they agree, and the failure is silent in the worst
// way — a persona whose slot has no row falls back to the engine's default and warns once into a log
// nobody is reading, so the symptom is a character that sounds like the last one.
//
// It only bites on a change: adding a persona, renaming one, or adding a third engine. Which is
// exactly when a test is worth having and a runtime check is not.

import { describe, expect, it } from 'vitest';

import { SEED_PERSONAS } from '../../../src/modules/personas/persona.defaults.js';
import { SEED_CALLERS } from '../../../src/modules/personas/caller.defaults.js';
import { DEFAULT_VOICE_ROWS as KOKORO_ROWS } from '../../../../../plugins/kokoro/src/kokoro.manifest.js';
import { DEFAULT_VOICE_ROWS as CHATTERBOX_ROWS } from '../../../../../plugins/chatterbox/src/chatterbox.manifest.js';

/** The one slot in a shipped map that is not a persona. See `docs/todo/personas.md` §1. */
const ROLE_SLOTS = ['newsreader'];

// Everybody who has a sheet, which is what a shipped map has to cover. The callers are a separate
// seed list and the same rule applies to them twice over: a caller with no row of its own reads in
// the engine's default voice, which on a production is the presenter's own voice answering itself.
const SEED_CHARACTERS = [...SEED_PERSONAS, ...SEED_CALLERS];

const engines = [
    { name: 'kokoro', rows: KOKORO_ROWS },
    { name: 'chatterbox', rows: CHATTERBOX_ROWS },
];

describe('the seeded characters', () => {
    it('each name a voice, because a roster that all sounds the same is the failure this fixed', () => {
        const silent = SEED_CHARACTERS.filter(persona => persona.voice === undefined).map(persona => persona.key);

        expect(silent).toEqual([]);
    });

    it('name their own key, so there is one list to keep straight rather than two', () => {
        const mismatched = SEED_CHARACTERS.filter(persona => persona.voice !== persona.key).map(persona => persona.key);

        expect(mismatched).toEqual([]);
    });

    it('are hosts and callers, and a caller is never seeded on air', () => {
        // The seeded active persona is the classic host, and `PersonaRepository.seed` picks it by
        // key — so a caller could only end up active through a key collision, which is exactly the
        // sort of thing a second seed list makes possible. The database refuses it as well.
        expect(SEED_CALLERS.every(caller => caller.kind === 'caller')).toBe(true);
        expect(SEED_PERSONAS.every(host => host.kind === 'host')).toBe(true);
        expect(SEED_CHARACTERS.map(persona => persona.key)).toHaveLength(new Set(SEED_CHARACTERS.map(persona => persona.key)).size);
    });
});

describe.each(engines)('the $name voice map', ({ rows }) => {
    it('has a row for every seeded persona', () => {
        // The one that actually bites. A persona added without a row here is a character that
        // silently reads in the default voice on this engine.
        const named = new Set(rows.map(row => row.name));
        const missing = SEED_CHARACTERS.filter(persona => persona.voice !== undefined && !named.has(persona.voice)).map(persona => persona.key);

        expect(missing).toEqual([]);
    });

    it('has no row for a persona that no longer exists', () => {
        // The other direction, which costs nothing on air and is worth catching anyway: a renamed
        // persona leaves an orphan behind, and an orphan is indistinguishable from a role slot.
        const keys = new Set<string>([...SEED_CHARACTERS.map(persona => persona.key), ...ROLE_SLOTS]);
        const orphans = rows.map(row => row.name).filter(name => !keys.has(name));

        expect(orphans).toEqual([]);
    });

    it('gives no two characters the same voice', () => {
        // Sharing is fine between characters a schedule keeps apart and wrong between two a listener
        // hears in one hour, and nothing here knows which is which — so the rule is simply that a
        // shipped map does not do it. An operator who wants to share says so themselves.
        const engineVoices = rows.map(row => row.engine);

        expect(engineVoices).toHaveLength(new Set(engineVoices).size);
    });

    it('sets a speed only where it is in range, or not at all', () => {
        // Out of range is clamped at read time rather than refused, so a typo here would be silently
        // rounded rather than caught. This is the place to catch it.
        for (const row of rows) {
            if (row.speed === undefined) continue;
            const speed = Number(row.speed);

            expect(Number.isFinite(speed), `${row.name} has a speed of "${row.speed}"`).toBe(true);
            expect(speed, `${row.name} is too slow`).toBeGreaterThanOrEqual(0.25);
            expect(speed, `${row.name} is too fast`).toBeLessThanOrEqual(4);
        }
    });
});

describe('the two engines', () => {
    it('offer the same slots, which is what makes switching engines a settings change', () => {
        // The whole of what the voice indirection buys. If these drift, an operator who switches
        // loses whichever characters the new engine never heard of — and finds out by listening.
        const [kokoro, chatterbox] = engines.map(engine => [...engine.rows.map(row => row.name)].sort());

        expect(kokoro).toEqual(chatterbox);
    });
});
