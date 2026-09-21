// The ceiling on how long a record from the programme that just ended may keep a scheduled block
// waiting. Two things are worth holding still: that a stored row can never switch on something
// harsher than it says, and the second clock, which is what stops a changeover that lands late in a
// block from cutting the record on air the instant it lands.

import { describe, expect, it } from 'vitest';

import {
    DEFAULT_CAP_OVERRUN,
    DEFAULT_OVERRUN_MINUTES,
    hasOverrun,
    OVERRUN_MINUTES_RANGE,
    resolveOverrunMinutes,
} from '../../../src/modules/schedule/changeover.overrun.js';

const MINUTE = 60_000;

describe('the defaults', () => {
    it('is off, so an upgrade never starts cutting records', () => {
        expect(DEFAULT_CAP_OVERRUN).toBe(false);
    });
});

describe('resolveOverrunMinutes', () => {
    it('reads the string a settings layer holds', () => {
        expect(resolveOverrunMinutes('8')).toBe(8);
    });

    it('answers the default for a row nobody can parse, and for no row at all', () => {
        expect(resolveOverrunMinutes('soon')).toBe(DEFAULT_OVERRUN_MINUTES);
        expect(resolveOverrunMinutes(undefined)).toBe(DEFAULT_OVERRUN_MINUTES);
        expect(resolveOverrunMinutes('')).toBe(DEFAULT_OVERRUN_MINUTES);
    });

    it('keeps zero, which means cut at the boundary rather than off', () => {
        expect(resolveOverrunMinutes('0')).toBe(0);
    });

    it('clamps a stored row into the range rather than refusing it', () => {
        expect(resolveOverrunMinutes('-3')).toBe(OVERRUN_MINUTES_RANGE.min);
        expect(resolveOverrunMinutes('600')).toBe(OVERRUN_MINUTES_RANGE.max);
        expect(resolveOverrunMinutes('4.9')).toBe(4);
    });
});

describe('hasOverrun', () => {
    const now = Date.UTC(2026, 8, 21, 10, 5);

    it('is true once a record from before the boundary has run the limit into the block', () => {
        // On since 09:50, block began at 10:00, and it is 10:05.
        expect(hasOverrun(5, now - 15 * MINUTE, now, 5)).toBe(true);
    });

    it('is false while it is still inside the limit', () => {
        expect(hasOverrun(4, now - 14 * MINUTE, now, 5)).toBe(false);
    });

    it('cuts at the boundary itself when the limit is zero', () => {
        expect(hasOverrun(0, now - 3 * MINUTE, now, 0)).toBe(true);
    });

    // The case the second clock is for. A hold that lapses at 11:40 inside a block that began at
    // 10:00 changes the station over an hour and forty minutes into the block. By the block's clock
    // the record on air overran long ago; by its own it has been on for two minutes.
    it('never counts a record as overrunning for longer than it has been on', () => {
        expect(hasOverrun(100, now - 2 * MINUTE, now, 5)).toBe(false);
        expect(hasOverrun(100, now - 5 * MINUTE, now, 5)).toBe(true);
    });
});
