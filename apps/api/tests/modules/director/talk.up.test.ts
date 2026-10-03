// When a link may be said over the start of the next record, and where in it to start.

import { describe, expect, it } from 'vitest';

import {
    CUE_CLOCK_DRIFT,
    DEFAULT_TALK_UP_SAFETY_MS,
    resolveTalkUp,
    SETTLE_MS,
    talkUpAt,
    TALK_UP_KEYS,
} from '../../../src/modules/director/talk.up.js';
import { RUNWAY_CEILING_MS, RUNWAY_FLOOR_MS } from '../../../src/modules/lyrics/vocal.runway.js';
import { settingsConfig } from '../../utils/settings.config.js';

const ask = (runwayMs: number, voiceMs = 5_000) => talkUpAt({ voiceMs, runway: { kind: 'ms', ms: runwayMs }, safetyMs: 1_500, duckFadeMs: 300 });

describe('talkUpAt', () => {
    it('ends the link at the post, allowing for the bed coming back up and the cue clock running slow', () => {
        const at = ask(12_000)!;
        // The cue lands about 3.5% later than asked, so the last word lands at the post rather than past it.
        expect(at * (1 + CUE_CLOCK_DRIFT) + 5_000 + 300).toBeLessThanOrEqual(12_000 - 1_500);
        expect(at * (1 + CUE_CLOCK_DRIFT) + 5_000 + 300).toBeGreaterThan(12_000 - 1_500 - 2);
    });

    it('airs in the gap a link that would not finish before the singing', () => {
        expect(ask(8_000, 7_000)).toBeUndefined();
    });

    it('can start a link at the top of the record when that is what fits', () => {
        expect(ask(6_800, 5_000)).toBe(0);
    });

    it('refuses a runway under the floor, whatever the link', () => {
        expect(ask(RUNWAY_FLOOR_MS - 1, 100)).toBeUndefined();
    });

    it('starts near the top of a long intro instead of hanging silent until the post', () => {
        expect(ask(RUNWAY_CEILING_MS + 10_000)).toBe(SETTLE_MS);
    });

    it('says nothing for an instrumental or a record it knows nothing about', () => {
        expect(talkUpAt({ voiceMs: 3_000, runway: { kind: 'instrumental' }, safetyMs: 1_500, duckFadeMs: 300 })).toBeUndefined();
        expect(talkUpAt({ voiceMs: 3_000, runway: { kind: 'unknown' }, safetyMs: 1_500, duckFadeMs: 300 })).toBeUndefined();
    });

    it('says nothing about a link of no length', () => {
        expect(ask(12_000, 0)).toBeUndefined();
    });
});

describe('resolveTalkUp', () => {
    it('is off with nothing set, and off for the string false', () => {
        expect(resolveTalkUp(settingsConfig().config).enabled).toBe(false);
        expect(resolveTalkUp(settingsConfig({ [TALK_UP_KEYS.enabled]: 'false' }).config).enabled).toBe(false);
        expect(resolveTalkUp(settingsConfig({ [TALK_UP_KEYS.enabled]: 'true' }).config).enabled).toBe(true);
    });

    it('clamps the room before the singing to its range, and defaults it', () => {
        expect(resolveTalkUp(settingsConfig().config).safetyMs).toBe(DEFAULT_TALK_UP_SAFETY_MS);
        expect(resolveTalkUp(settingsConfig({ [TALK_UP_KEYS.safetyMs]: '50' }).config).safetyMs).toBe(500);
        expect(resolveTalkUp(settingsConfig({ [TALK_UP_KEYS.safetyMs]: '99999' }).config).safetyMs).toBe(5_000);
    });
});
