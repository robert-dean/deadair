import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatClock, formatCount, formatLocale, weekdayShort } from '../../src/i18n/format.locale';

afterEach(() => {
    vi.unstubAllGlobals();
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
});
