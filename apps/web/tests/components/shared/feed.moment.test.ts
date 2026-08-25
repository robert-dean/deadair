import { describe, expect, it } from 'vitest';

import { formatMomentMinute, formatTimeOfDay } from '../../../src/components/shared/feed.moment';

describe('formatMomentMinute', () => {
    it('carries the date and the time, and stops at the minute', () => {
        const formatted = formatMomentMinute('2026-08-02T09:35:12.000Z');

        // Locale-dependent spelling and order, so this asserts the parts rather than one locale's
        // arrangement of them. What matters is that a date is there and the seconds are not.
        expect(formatted).toMatch(/\d/);
        expect(formatted).toMatch(/:/);
        expect(formatted).not.toMatch(/:\d\d:/);
    });

    it('names the weekday when asked, for a moment far enough ahead that the date alone will not place it', () => {
        const plain = formatMomentMinute('2026-08-02T09:35:00.000Z');
        const withWeekday = formatMomentMinute('2026-08-02T09:35:00.000Z', { weekday: true });

        expect(withWeekday.length).toBeGreaterThan(plain.length);
    });

    it('renders the callers fallback for a value the API never sent, or sent wrong', () => {
        expect(formatMomentMinute(undefined, { fallback: '—' })).toBe('—');
        expect(formatMomentMinute('', { fallback: '—' })).toBe('—');
        expect(formatMomentMinute('the day before yesterday', { fallback: '—' })).toBe('—');
    });

    it('renders nothing when the caller asked for no fallback, matching the other helpers here', () => {
        expect(formatMomentMinute(undefined)).toBe('');
    });
});

describe('formatTimeOfDay', () => {
    it('renders the wall clock alone, for a reading whose date is today by construction', () => {
        const formatted = formatTimeOfDay('2026-08-02T09:35:12.000Z');

        expect(formatted).toMatch(/:\d\d:\d\d/);
        expect(formatted).not.toMatch(/2026/);
    });

    it('renders nothing for a value the API never sent, or sent wrong', () => {
        expect(formatTimeOfDay(undefined)).toBe('');
        expect(formatTimeOfDay('half past')).toBe('');
    });
});
