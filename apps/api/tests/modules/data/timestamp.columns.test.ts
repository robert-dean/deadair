import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { millisOf } from '../../../src/modules/data/timestamp.columns.js';

describe('millisOf', () => {
    const MILLIS = Date.UTC(2026, 9, 22, 12, 0, 0);

    // The driver's shape, which the generated types do not admit to.
    it('reads the Date the pg driver hands back', () => {
        expect(millisOf(new Date(MILLIS))).toBe(MILLIS);
    });

    it('reads the DateTime the generated types promise', () => {
        expect(millisOf(DateTime.fromMillis(MILLIS))).toBe(MILLIS);
    });

    it('reads a null column as unset', () => {
        expect(millisOf(null)).toBeUndefined();
        expect(millisOf(undefined)).toBeUndefined();
    });
});
