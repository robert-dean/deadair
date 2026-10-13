import { afterEach, describe, expect, it } from 'vitest';
import { setClock } from '../../../src/clock.store';
import { formatMomentMinute, formatMomentStamp, formatTimeOfDay } from '../../../src/components/shared/feed.moment';

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

describe('the operator clock', () => {
    afterEach(() => {
        setClock('auto');
    });

    it('turns the 12-hour stamp to 24 hours when the operator chose it', () => {
        const afternoon = new Date(2026, 8, 24, 14, 5, 9).toISOString();
        expect(formatMomentStamp(afternoon)).toMatch(/pm/i);

        setClock('24');
        expect(formatMomentStamp(afternoon)).toContain('14:05:09');
        expect(formatMomentStamp(afternoon)).not.toMatch(/pm/i);
    });

    it('puts a locale that reads 24 hours on 12 when the operator chose it', () => {
        setClock('12');
        expect(formatTimeOfDay(new Date(2026, 8, 24, 14, 5, 9).toISOString())).toMatch(/pm/i);
    });
});
