// The figures this formats are going to be checked against `du -h` in a terminal, so the thing worth
// pinning is that it agrees with what an operator sees there.

import { describe, expect, it } from 'vitest';

import { formatBytes } from '../../../src/components/shared/format.bytes';

describe('formatBytes', () => {
    it.each([
        [0, '0 B'],
        [512, '512 B'],
        [1024, '1 KB'],
        [1536, '2 KB'],
        [1024 * 1024, '1.0 MB'],
        [3_750_670_519, '3.5 GB'],
        [21474836480, '20.0 GB'],
        [1024 ** 4, '1.0 TB'],
    ])('renders %i as %s', (bytes, expected) => {
        expect(formatBytes(bytes)).toBe(expected);
    });

    // A store with nothing in it is a fact and says so. The dash is for a figure nothing recorded —
    // `segments` has never held a byte size — and the two must not read the same.
    it('tells nothing recorded from nothing there', () => {
        expect(formatBytes(undefined)).toBe('—');
        expect(formatBytes(0)).toBe('0 B');
    });

    // Beyond the units it knows, so a wrong number cannot come out as a wrong UNIT.
    it('stays in terabytes rather than inventing a bigger name', () => {
        expect(formatBytes(1024 ** 6)).toBe('1048576.0 TB');
    });
});
