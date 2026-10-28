// When a link may be said over the start of the next record, and where in it to start.

import { describe, expect, it } from 'vitest';

import {
    CUE_CLOCK_LAG_MS,
    DEFAULT_TALK_UP_SAFETY_MS,
    resolveTalkUp,
    SETTLE_MS,
    talkUpAt,
    talkUpBudget,
    TALK_UP_KEYS,
} from '../../../src/modules/director/talk.up.js';
import { DEFAULT_DUCK_FADE_MS, DUCK_FADE_KEY, DUCK_FADE_RANGE } from '../../../src/modules/playout/gain.js';
import { RUNWAY_CEILING_MS, RUNWAY_FLOOR_MS } from '../../../src/modules/lyrics/vocal.runway.js';
import { settingsConfig } from '../../utils/settings.config.js';

const ask = (runwayMs: number, voiceMs = 5_000) => talkUpAt({ voiceMs, runway: { kind: 'ms', ms: runwayMs }, safetyMs: 1_500, duckFadeMs: 300 });

describe('talkUpAt', () => {
    it('ends the link at the post, allowing for the bed coming back up and the cue firing a tick or two late', () => {
        const at = ask(12_000)!;
        // The cue lands up to two ticks later than asked, so the last word lands at the post rather than past it.
        expect(at + CUE_CLOCK_LAG_MS + 5_000 + 300).toBeLessThanOrEqual(12_000 - 1_500);
        expect(at + CUE_CLOCK_LAG_MS + 5_000 + 300).toBeGreaterThan(12_000 - 1_500 - 2);
    });

    it('allows the same lag 6s in as 60s in, since the clock no longer runs slow', () => {
        const long = talkUpAt({ voiceMs: 5_000, runway: { kind: 'ms', ms: 17_000 }, safetyMs: 1_500, duckFadeMs: 300 })!;
        expect(17_000 - 1_500 - (long + CUE_CLOCK_LAG_MS + 5_000 + 300)).toBeLessThan(2);
    });

    it('airs in the gap a link that would not finish before the singing', () => {
        expect(ask(8_000, 7_000)).toBeUndefined();
    });

    it('can start a link at the top of the record when that is what fits', () => {
        expect(ask(7_000, 5_000)).toBe(0);
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

    it("reads the duck's ramp with the rest, so one pass times every link against one figure", () => {
        expect(resolveTalkUp(settingsConfig().config).duckFadeMs).toBe(DEFAULT_DUCK_FADE_MS);
        expect(resolveTalkUp(settingsConfig({ [DUCK_FADE_KEY]: '800' }).config).duckFadeMs).toBe(800);
        expect(resolveTalkUp(settingsConfig({ [DUCK_FADE_KEY]: '5' }).config).duckFadeMs).toBe(DUCK_FADE_RANGE.min);
        expect(resolveTalkUp(settingsConfig({ [DUCK_FADE_KEY]: 'slow' }).config).duckFadeMs).toBe(DEFAULT_DUCK_FADE_MS);
    });
});

describe('talkUpBudget', () => {
    it('offers the words that fit before the post after the room, the ramp and the lag', () => {
        // 10000 - 1500 - 300 - 200 = 8000ms at 2.6 words a second.
        expect(talkUpBudget({ kind: 'ms', ms: 10_000 }, 1_500, 300)).toEqual({ runwayMs: 10_000, words: 20 });
    });

    it('offers fewer for a slower ramp, the same figure the placement allows for', () => {
        expect(talkUpBudget({ kind: 'ms', ms: 10_000 }, 1_500, 1_300)).toEqual({ runwayMs: 10_000, words: 18 });
    });
});
