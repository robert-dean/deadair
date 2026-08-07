import { describe, expect, it } from 'vitest';

import { formatDate } from '../../../src/components/shared/format.date';

describe('formatDate', () => {
    it('renders a timestamp as a date, dropping the time nobody reading it needs', () => {
        const formatted = formatDate('2026-08-02T09:00:00.000Z');

        // Locale-dependent spelling, so this asserts the parts rather than one locale's order.
        expect(formatted).toMatch(/2026/);
        expect(formatted).toMatch(/2/);
        expect(formatted).not.toMatch(/:/);
    });

    it('renders nothing for a value the API never sent, or sent wrong', () => {
        expect(formatDate(undefined)).toBe('');
        expect(formatDate('')).toBe('');
        expect(formatDate('the day before yesterday')).toBe('');
    });
});
