// What an operator decides about a production before asking for one. The cases that matter are the
// two this station has actually been bitten by: every layer of `AppConfig` holds STRINGS, so a
// resolver that asks `Number.isFinite` of what it was handed reports every set value as unset; and a
// conversation is not a talk, so one length for both makes whichever it was not.

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import {
    DEFAULT_DIALOGUE_MINUTES,
    DEFAULT_TARGET_MINUTES,
    dialogueKinds,
    PRODUCTION_KEYS,
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
