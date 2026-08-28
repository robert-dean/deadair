// The guard is a proportion and a floor, and both are cheap to get subtly wrong
// in the direction that does nothing. What it has to catch is the renumber —
// a complete, healthy walk in which not one id matches anything stored — which
// arrives as `known === unseen` and is exactly the input the existing empty-walk
// refusal cannot see.
//
// `resolveSweepMaxPercent` is tested with STRINGS on purpose. Every layer of
// `AppConfig` holds text, so a resolver that only ever sees real numbers in its
// tests passes whatever it does at runtime.

import { describe, expect, it } from 'vitest';

import {
    DEFAULT_SWEEP_MAX_PERCENT,
    resolveSweepMaxPercent,
    SWEEP_GUARD_MIN_KNOWN,
    sweepIsSafe,
} from '../../../../src/modules/catalog/ingest/catalog.sweep.guard.js';

/** Comfortably past the floor, so a case is about the proportion and nothing else. */
const KNOWN = SWEEP_GUARD_MIN_KNOWN * 10;

describe('sweepIsSafe', () => {
    it('refuses a walk that recognised none of what is bound', () => {
        // The renumber. Every id in the seen-set is new, so the walk looks
        // complete and healthy and agrees with nothing.
        expect(sweepIsSafe(KNOWN, KNOWN, DEFAULT_SWEEP_MAX_PERCENT)).toBe(false);
    });

    it('allows the ordinary case, where a walk recognised nearly everything', () => {
        expect(sweepIsSafe(KNOWN, 3, DEFAULT_SWEEP_MAX_PERCENT)).toBe(true);
    });

    it('allows a walk that saw everything', () => {
        expect(sweepIsSafe(KNOWN, 0, DEFAULT_SWEEP_MAX_PERCENT)).toBe(true);
    });

    it('allows exactly the threshold and refuses one past it', () => {
        // The boundary is inclusive: at the limit the operator asked for this
        // much to be retired, so retiring precisely that much is the answer.
        expect(sweepIsSafe(200, 100, 50)).toBe(true);
        expect(sweepIsSafe(200, 101, 50)).toBe(false);
    });

    it('is not fooled by a percentage that does not divide evenly', () => {
        // 33% of 200 is 66, so 66 is in and 67 is out. Integer arithmetic rather
        // than a float comparison is what keeps that answer stable.
        expect(sweepIsSafe(200, 66, 33)).toBe(true);
        expect(sweepIsSafe(200, 67, 33)).toBe(false);
    });

    it('leaves a small library alone, where a proportion says nothing', () => {
        // Losing three of four copies is 75% and completely ordinary. A guard
        // that fired here would be turned off before it was ever needed.
        expect(sweepIsSafe(4, 3, DEFAULT_SWEEP_MAX_PERCENT)).toBe(true);
        expect(sweepIsSafe(SWEEP_GUARD_MIN_KNOWN - 1, SWEEP_GUARD_MIN_KNOWN - 1, 1)).toBe(true);
    });

    it('applies from the floor upward', () => {
        expect(sweepIsSafe(SWEEP_GUARD_MIN_KNOWN, SWEEP_GUARD_MIN_KNOWN, DEFAULT_SWEEP_MAX_PERCENT)).toBe(false);
    });

    it('is off at 100, which is the only thing that turns it off', () => {
        expect(sweepIsSafe(KNOWN, KNOWN, 100)).toBe(true);
    });

    it('says nothing about a plugin with no bindings at all', () => {
        // Under the floor, so it allows — and there is nothing to sweep anyway.
        expect(sweepIsSafe(0, 0, DEFAULT_SWEEP_MAX_PERCENT)).toBe(true);
    });
});

describe('resolveSweepMaxPercent', () => {
    it('reads the stored text, which is the only way a set value ever arrives', () => {
        expect(resolveSweepMaxPercent('75')).toBe(75);
        expect(resolveSweepMaxPercent(' 75 ')).toBe(75);
    });

    it('takes the default for a value nobody set', () => {
        expect(resolveSweepMaxPercent(undefined)).toBe(DEFAULT_SWEEP_MAX_PERCENT);
        expect(resolveSweepMaxPercent('')).toBe(DEFAULT_SWEEP_MAX_PERCENT);
    });

    it('takes the default for a value nobody can parse', () => {
        expect(resolveSweepMaxPercent('half')).toBe(DEFAULT_SWEEP_MAX_PERCENT);
    });

    it('clamps rather than refusing, because this is read on the way to a walk', () => {
        expect(resolveSweepMaxPercent('0')).toBe(1);
        expect(resolveSweepMaxPercent('-20')).toBe(1);
        expect(resolveSweepMaxPercent('400')).toBe(100);
    });

    it('floors a fraction rather than carrying it into the comparison', () => {
        expect(resolveSweepMaxPercent('50.9')).toBe(50);
    });

    it('accepts a real number, which is what the declared default is', () => {
        expect(resolveSweepMaxPercent(50)).toBe(50);
    });
});
