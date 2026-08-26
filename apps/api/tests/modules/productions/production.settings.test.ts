// What an operator decides about a production before asking for one. The cases that matter are the
// two this station has actually been bitten by: every layer of `AppConfig` holds STRINGS, so a
// resolver that asks `Number.isFinite` of what it was handed reports every set value as unset; and a
// conversation is not a talk, so one length for both makes whichever it was not.

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import {
    DEFAULT_DIALOGUE_MINUTES,
    DEFAULT_GAP_MS,
    DEFAULT_TARGET_MINUTES,
    dialogueKinds,
    MAX_GAP_MS,
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

describe('how long a production runs', () => {
    it('takes the station default when nobody set one', () => {
        expect(minutes(stationTargetMs(config()))).toBe(DEFAULT_TARGET_MINUTES);
    });

    it('reads a value the operator actually set, which is the bug this had', () => {
        // `config.get(key, 10)` answers the STRING '20' for a row that exists, and
        // `Number.isFinite('20')` is false — so the setting was stored, shown in the console, and
        // silently ignored by the only thing that read it.
        expect(minutes(stationTargetMs(config({ [PRODUCTION_KEYS.targetMinutes]: '20' })))).toBe(20);
    });

    it('falls back rather than throwing on a row nobody can parse', () => {
        expect(minutes(stationTargetMs(config({ [PRODUCTION_KEYS.targetMinutes]: 'ten' })))).toBe(DEFAULT_TARGET_MINUTES);
        expect(minutes(stationTargetMs(config({ [PRODUCTION_KEYS.targetMinutes]: '0' })))).toBe(DEFAULT_TARGET_MINUTES);
    });

    it('gives a conversation its own default, because a turn is a third of a beat', () => {
        expect(minutes(stationTargetMs(config(), 'callin'))).toBe(DEFAULT_DIALOGUE_MINUTES);
        expect(minutes(stationTargetMs(config(), 'podcast'))).toBe(DEFAULT_TARGET_MINUTES);
    });

    it('follows the operator when they say which kinds are conversations', () => {
        const station = config({ [PRODUCTION_KEYS.dialogueKinds]: 'phone-in', [PRODUCTION_KEYS.dialogueMinutes]: '5' });

        expect(minutes(stationTargetMs(station, 'phone-in'))).toBe(5);
        // And `callin` stops being one, because the setting REPLACES the default rather than adding
        // to it — which is how every comma-separated key on the station reads.
        expect(minutes(stationTargetMs(station, 'callin'))).toBe(DEFAULT_TARGET_MINUTES);
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
