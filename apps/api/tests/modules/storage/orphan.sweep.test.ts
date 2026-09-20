// This resolver is read by a job that deletes audio, so the direction it fails in is the whole
// point: every value nobody meaningfully set has to mean "wait longer", never "sweep sooner". The
// floor is the part that is not advice — the two orderings `scripts/media.sweep.ts` documents and
// cannot enforce are both answered by nothing young being taken, and a reachable zero would hand
// them straight back.

import { describe, expect, it } from 'vitest';

import { DEFAULT_ORPHAN_GRACE_HOURS, MINIMUM_ORPHAN_GRACE_HOURS, resolveOrphanGraceHours } from '../../../src/modules/storage/orphan.sweep.js';

describe('resolveOrphanGraceHours', () => {
    it('reads a number as itself', () => {
        expect(resolveOrphanGraceHours(72)).toBe(72);
    });

    // Settings arrive from a jsonb column and from dotenv, so the string spelling is the common one.
    it('reads the same number written as a string', () => {
        expect(resolveOrphanGraceHours('72')).toBe(72);
    });

    it('floors a fractional hour rather than carrying it into the comparison', () => {
        expect(resolveOrphanGraceHours(6.9)).toBe(6);
    });

    it.each([
        ['unset', undefined],
        ['empty', ''],
        ['not a number at all', 'a day or so'],
        ['zero, which reads as sweep immediately and must not', 0],
        ['negative', -5],
        ['infinite', Number.POSITIVE_INFINITY],
        ['not a number', Number.NaN],
    ])('answers the default for a value that is %s', (_case, value) => {
        expect(resolveOrphanGraceHours(value)).toBe(DEFAULT_ORPHAN_GRACE_HOURS);
    });

    // Not the same assertion as the one above: zero is unreadable and takes the default, while a
    // deliberate, readable, too-small number is obeyed as far as the floor and no further.
    it('clamps a readable number below the floor up to it, rather than obeying it', () => {
        expect(resolveOrphanGraceHours(0.5)).toBe(MINIMUM_ORPHAN_GRACE_HOURS);
        expect(resolveOrphanGraceHours('0.25')).toBe(MINIMUM_ORPHAN_GRACE_HOURS);
    });

    it('leaves the floor itself alone', () => {
        expect(resolveOrphanGraceHours(MINIMUM_ORPHAN_GRACE_HOURS)).toBe(MINIMUM_ORPHAN_GRACE_HOURS);
    });

    // The default has to sit above the floor or the floor is the default, and a later edit that
    // lowered one without the other would be silent.
    it('defaults to something well clear of the floor', () => {
        expect(DEFAULT_ORPHAN_GRACE_HOURS).toBeGreaterThan(MINIMUM_ORPHAN_GRACE_HOURS);
    });
});
