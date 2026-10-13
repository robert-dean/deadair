import { afterEach, describe, expect, it, vi } from 'vitest';

import { setClock } from '../../src/clock.store';
import { dayjsClock, formatClock, formatClockIn, formatCount, formatLocale, formatWallTime, weekdayShort } from '../../src/i18n/format.locale';

afterEach(() => {
    vi.unstubAllGlobals();
    setClock('auto');
});

function prefer(...languages: string[]): void {
    vi.stubGlobal('navigator', { ...navigator, languages });
}

describe('formatLocale', () => {
    it("keeps the browser's region when its language is the one on screen", () => {
        prefer('en-GB', 'en');
        expect(formatLocale()).toBe('en-GB');
    });

    it('skips preferences in a language the console is not showing', () => {
        prefer('xx-YY', 'en-AU');
        expect(formatLocale()).toBe('en-AU');
    });

    it('falls back to the bare language', () => {
        prefer('xx-YY');
        expect(formatLocale()).toBe('en');
    });
});

describe('formatters', () => {
    it('groups a count the way the region does', () => {
        prefer('en-GB');
        expect(formatCount(12345)).toBe('12,345');
    });

    it('names the days Sunday first, as the API numbers them', () => {
        prefer('en-US');
        expect([0, 1, 6].map(weekdayShort)).toEqual(['Sun', 'Mon', 'Sat']);
    });

    it('keeps the 24-hour clock even where the region would not', () => {
        prefer('en-US');
        const afternoon = new Date(2026, 8, 24, 14, 5, 9);
        expect(formatClock(afternoon)).toBe('14:05');
        expect(formatClock(afternoon, { seconds: true })).toBe('14:05:09');
    });

    it('draws every clock on 12 hours when the operator chose it', () => {
        prefer('en-GB');
        setClock('12');
        const afternoon = new Date(Date.UTC(2026, 8, 24, 14, 5, 9));
        expect(formatClockIn(afternoon, 'UTC')).toMatch(/^02:05\s?pm$/i);
        expect(formatWallTime(14, 5)).toMatch(/^02:05\s?pm$/i);
        expect(dayjsClock()).toEqual({ time: 'h:mm A', hour: 'h A', picker: '12h' });
    });

    it('keeps 24 hours for a wall time unless told otherwise', () => {
        prefer('en-US');
        expect(formatWallTime(14, 5)).toBe('14:05');
        expect(formatWallTime(0, 30)).toBe('00:30');
        expect(dayjsClock().picker).toBe('24h');
    });
});
