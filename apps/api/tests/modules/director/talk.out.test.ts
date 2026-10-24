// When a link may be said over the end of the record before it, and where in that record to start.

import { describe, expect, it } from 'vitest';

import { CUE_CLOCK_LAG_MS } from '../../../src/modules/director/talk.up.js';
import { tailFor, talkOutAt, talkOutBudget, talkOutIsOn, TALK_OUT_KEYS, type Tail } from '../../../src/modules/director/talk.out.js';
import { RUNWAY_CEILING_MS, RUNWAY_FLOOR_MS } from '../../../src/modules/lyrics/vocal.runway.js';
import type { VocalMarkers } from '../../../src/modules/lyrics/vocal.ranges.js';
import { settingsConfig } from '../../utils/settings.config.js';

const sung = (onsetMs: number, endMs: number): VocalMarkers => ({ kind: 'ranges', onsetMs, endMs, ranges: [{ startMs: onsetMs, endMs }] });
const tail = (fromMs: number, endMs: number): Tail => ({ kind: 'ms', fromMs, endMs });
const ask = (t: Tail, voiceMs = 5_000) => talkOutAt({ voiceMs, tail: t, safetyMs: 1_500, duckFadeMs: 300 });

describe('tailFor', () => {
    it('runs from the last sung word to the measured end, on the timeline the record airs on', () => {
        // Six seconds of leading silence trimmed off the head move both ends by the same six.
        expect(tailFor(sung(20_000, 180_000), { cueInMs: 6_000, cueOutMs: 210_000 })).toEqual(tail(174_000, 204_000));
    });

    it('needs a measured end, since a record nobody measured has nothing to land on', () => {
        expect(tailFor(sung(20_000, 180_000), { cueInMs: 0 })).toEqual({ kind: 'none' });
    });

    it('says nothing for an instrumental, a record it knows nothing about, or a correction of the post alone', () => {
        expect(tailFor({ kind: 'instrumental' }, { cueOutMs: 200_000 })).toEqual({ kind: 'none' });
        expect(tailFor({ kind: 'unknown' }, { cueOutMs: 200_000 })).toEqual({ kind: 'none' });
        // An operator who typed only where the singing starts, with nothing derived to say where it stops.
        expect(tailFor(sung(12_000, 12_000), { cueOutMs: 200_000 })).toEqual({ kind: 'none' });
    });

    it('says nothing when the singing runs to the end', () => {
        expect(tailFor(sung(20_000, 205_000), { cueOutMs: 200_000 })).toEqual({ kind: 'none' });
    });
});

describe('talkOutAt', () => {
    it('ends the link at the record’s end, allowing for the bed coming back up and the cue firing late', () => {
        const at = ask(tail(170_000, 200_000))!;
        expect(at + CUE_CLOCK_LAG_MS + 5_000 + 300).toBeLessThanOrEqual(200_000);
        expect(at + CUE_CLOCK_LAG_MS + 5_000 + 300).toBeGreaterThan(200_000 - 2);
    });

    it('never starts inside the room after the last sung word', () => {
        // 8.5s of tail: the link would have to start 0.5s after the last word, inside the 1.5s room.
        expect(ask(tail(191_500, 200_000), 7_000)).toBeUndefined();
        // With the room respected it fits, starting exactly as late as it can.
        expect(ask(tail(190_000, 200_000), 3_000)).toBe(200_000 - 3_000 - 300 - CUE_CLOCK_LAG_MS);
    });

    it('refuses a tail under the floor, whatever the link', () => {
        expect(ask(tail(200_000 - RUNWAY_FLOOR_MS + 1, 200_000), 100)).toBeUndefined();
    });

    it('airs in the gap a link with no tail to ride, or of no length', () => {
        expect(ask({ kind: 'none' })).toBeUndefined();
        expect(ask(tail(170_000, 200_000), 0)).toBeUndefined();
    });
});

describe('talkOutIsOn', () => {
    it('is off with nothing set, and off for the string false', () => {
        expect(talkOutIsOn(settingsConfig().config)).toBe(false);
        expect(talkOutIsOn(settingsConfig({ [TALK_OUT_KEYS.enabled]: 'false' }).config)).toBe(false);
        expect(talkOutIsOn(settingsConfig({ [TALK_OUT_KEYS.enabled]: 'true' }).config)).toBe(true);
    });
});

describe('talkOutBudget', () => {
    it('offers the words that fit after the room, the ramp and the lag', () => {
        // 10s of tail: 10000 - 1500 - 300 - 200 = 8000ms at 2.6 words a second.
        expect(talkOutBudget(tail(190_000, 200_000), 1_500)).toEqual({ tailMs: 10_000, words: 20 });
    });

    it('says nothing about a tail too short to bind on, or one any link fits', () => {
        expect(talkOutBudget(tail(200_000 - RUNWAY_FLOOR_MS + 1, 200_000), 1_500)).toBeUndefined();
        expect(talkOutBudget(tail(100_000, 100_000 + RUNWAY_CEILING_MS), 1_500)).toBeUndefined();
        expect(talkOutBudget({ kind: 'none' }, 1_500)).toBeUndefined();
    });
});
