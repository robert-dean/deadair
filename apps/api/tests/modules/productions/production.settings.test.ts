// What an operator decides about a production before asking for one. The cases that matter are the
// two this station has actually been bitten by: every layer of `AppConfig` holds STRINGS, so a
// resolver that asks `Number.isFinite` of what it was handed reports every set value as unset; and a
// conversation is not a talk, so one length for both makes whichever it was not.

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import {
    DEFAULT_DIALOGUE_MINUTES_MAX,
    DEFAULT_DIALOGUE_MINUTES_MIN,
    DEFAULT_GAP_MS,
    DEFAULT_TARGET_MINUTES_MAX,
    DEFAULT_TARGET_MINUTES_MIN,
    dialogueKinds,
    LENGTH_STEP_MS,
    MAX_GAP_MS,
    MAX_PRODUCTION_MINUTES,
    PRODUCTION_KEYS,
    stationGapMs,
    stationTargetMs,
} from '../../../src/modules/productions/production.settings.js';

/**
 * A config that answers with STRINGS, which is what the real one does.
 *
 * A double handing back a real number here would prove nothing: it passes either way, and the bug it
 * would hide is exactly the one below.
 */
const config = (rows: Record<string, string> = {}): AppConfig =>
    ({ get: (key: string, fallback: unknown) => rows[key] ?? fallback }) as unknown as AppConfig;

const minutes = (ms: number) => ms / 60_000;

/** The roll, pinned. `0` is the bottom of the range and `0.999` the top. */
const rolls = (value: number) => () => value;

describe('how long a production runs', () => {
    it('takes the station default range when nobody set one', () => {
        expect(minutes(stationTargetMs(config(), undefined, rolls(0)))).toBe(DEFAULT_TARGET_MINUTES_MIN);
        expect(minutes(stationTargetMs(config(), undefined, rolls(0.999)))).toBe(DEFAULT_TARGET_MINUTES_MAX);
    });

    it('reads a value the operator actually set, which is the bug this had', () => {
        // `config.get(key, 10)` answers the STRING '20' for a row that exists, and
        // `Number.isFinite('20')` is false — so the setting was stored, shown in the console, and
        // silently ignored by the only thing that read it.
        const station = config({ [PRODUCTION_KEYS.targetMinutesMin]: '20', [PRODUCTION_KEYS.targetMinutesMax]: '20' });

        expect(minutes(stationTargetMs(station, undefined, rolls(0.5)))).toBe(20);
    });

    it('falls back rather than throwing on a row nobody can parse', () => {
        const unreadable = config({ [PRODUCTION_KEYS.targetMinutesMin]: 'ten', [PRODUCTION_KEYS.targetMinutesMax]: 'ten' });
        const zeroed = config({ [PRODUCTION_KEYS.targetMinutesMin]: '0', [PRODUCTION_KEYS.targetMinutesMax]: '0' });

        expect(minutes(stationTargetMs(unreadable, undefined, rolls(0)))).toBe(DEFAULT_TARGET_MINUTES_MIN);
        expect(minutes(stationTargetMs(zeroed, undefined, rolls(0)))).toBe(DEFAULT_TARGET_MINUTES_MIN);
    });

    it('gives a conversation its own range, because a turn is a fraction of a beat', () => {
        expect(minutes(stationTargetMs(config(), 'callin', rolls(0)))).toBe(DEFAULT_DIALOGUE_MINUTES_MIN);
        expect(minutes(stationTargetMs(config(), 'callin', rolls(0.999)))).toBe(DEFAULT_DIALOGUE_MINUTES_MAX);
        expect(minutes(stationTargetMs(config(), 'podcast', rolls(0)))).toBe(DEFAULT_TARGET_MINUTES_MIN);
    });

    it('follows the operator when they say which kinds are conversations', () => {
        const station = config({
            [PRODUCTION_KEYS.dialogueKinds]: 'phone-in',
            [PRODUCTION_KEYS.dialogueMinutesMin]: '5',
            [PRODUCTION_KEYS.dialogueMinutesMax]: '5',
        });

        expect(minutes(stationTargetMs(station, 'phone-in', rolls(0.5)))).toBe(5);
        // And `callin` stops being one, because the setting REPLACES the default rather than adding
        // to it — which is how every comma-separated key on the station reads.
        expect(minutes(stationTargetMs(station, 'callin', rolls(0)))).toBe(DEFAULT_TARGET_MINUTES_MIN);
    });
});

// A programme that is always exactly the same length is the one thing about a schedule a listener
// notices without being able to say why. The range is the answer, and what it must not do is answer
// differently on two reads of the SAME production — which it cannot, because the pick is made once
// at commission and stored in `productions.target_ms`.
describe('the length a production is picked at', () => {
    const range = (min: string, max: string) => config({ [PRODUCTION_KEYS.targetMinutesMin]: min, [PRODUCTION_KEYS.targetMinutesMax]: max });

    it('lands on both ends and never outside them', () => {
        for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
            const picked = minutes(stationTargetMs(range('8', '12'), undefined, rolls(roll)));

            expect(picked).toBeGreaterThanOrEqual(8);
            expect(picked).toBeLessThanOrEqual(12);
        }

        expect(minutes(stationTargetMs(range('8', '12'), undefined, rolls(0)))).toBe(8);
        expect(minutes(stationTargetMs(range('8', '12'), undefined, rolls(0.999)))).toBe(12);
    });

    it('lands on a whole step, so two productions are audibly different lengths rather than nearly', () => {
        for (const roll of [0.1, 0.37, 0.64, 0.9]) {
            expect(stationTargetMs(range('2', '4'), undefined, rolls(roll)) % LENGTH_STEP_MS).toBe(0);
        }
    });

    it('answers one length when both ends agree, which is how an operator asks for a fixed one', () => {
        expect(minutes(stationTargetMs(range('6', '6'), undefined, rolls(0)))).toBe(6);
        expect(minutes(stationTargetMs(range('6', '6'), undefined, rolls(0.999)))).toBe(6);
    });

    it('reads the two ends as a pair however they were typed, rather than refusing them', () => {
        // The resolver rule this whole file follows: a row that is already stored costs the station
        // its preference, never its ability to make anything. The console refuses the pair where
        // somebody types it.
        expect(minutes(stationTargetMs(range('12', '8'), undefined, rolls(0)))).toBe(8);
        expect(minutes(stationTargetMs(range('12', '8'), undefined, rolls(0.999)))).toBe(12);
    });

    it('clamps an end past the band a programme can be', () => {
        expect(minutes(stationTargetMs(range('900', '900'), undefined, rolls(0)))).toBe(MAX_PRODUCTION_MINUTES);
    });
});

describe('which kinds have callers', () => {
    it('is the call-in alone unless the station says otherwise', () => {
        expect([...dialogueKinds(config())]).toEqual(['callin']);
    });

    it('takes the list the operator wrote, trimmed and lowercased', () => {
        expect([...dialogueKinds(config({ [PRODUCTION_KEYS.dialogueKinds]: ' Callin , PHONE-IN ' }))]).toEqual(['callin', 'phone-in']);
    });

    it('is empty when an operator empties it, which is a station with no conversations', () => {
        expect([...dialogueKinds(config({ [PRODUCTION_KEYS.dialogueKinds]: '' }))]).toEqual([]);
    });
});

describe('the pause between joined beats', () => {
    it('is the station default when nobody has said', () => {
        expect(stationGapMs(config())).toBe(DEFAULT_GAP_MS);
    });

    it('reads a figure an operator stored, which arrives as a string', () => {
        expect(stationGapMs(config({ [PRODUCTION_KEYS.gapMs]: ' 350 ' }))).toBe(350);
    });

    it('takes zero, which is a station whose turns run straight into each other', () => {
        expect(stationGapMs(config({ [PRODUCTION_KEYS.gapMs]: '0' }))).toBe(0);
    });

    it('CLAMPS rather than refusing, because this reads a row that is already stored', () => {
        // The console refuses an out-of-range figure where somebody can see it change. Here, a
        // setting that would not load stops the join behind it.
        expect(stationGapMs(config({ [PRODUCTION_KEYS.gapMs]: '9000' }))).toBe(MAX_GAP_MS);
        expect(stationGapMs(config({ [PRODUCTION_KEYS.gapMs]: '-40' }))).toBe(0);
    });

    it('falls back on something unparseable rather than joining with a NaN gap', () => {
        expect(stationGapMs(config({ [PRODUCTION_KEYS.gapMs]: 'a beat' }))).toBe(DEFAULT_GAP_MS);
    });
});
