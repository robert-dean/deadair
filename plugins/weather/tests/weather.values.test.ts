// Reading somebody else's numbers without inventing any.
//
// Two of the three services report a time with no offset on it and the day it
// belongs to separately, so this file is where a forecast for "tomorrow" is kept
// from moving a day. The rest of it is the rule every parser follows: a field
// that is not what it should be produces nothing, never a zero.

import { describe, expect, it } from 'vitest';

import { field, kphFromMetresPerSecond, localDate, localInstant, optional, percentage, reading, text, withOffset } from '../src/weather.values.js';

describe('withOffset', () => {
    it('puts a local time and its offset back together', () => {
        expect(withOffset('2026-08-29T09:00', 7_200)).toBe('2026-08-29T09:00:00+02:00');
        expect(withOffset('2026-08-29T09:00:00', -18_000)).toBe('2026-08-29T09:00:00-05:00');
    });

    it('writes Z for a place on UTC rather than +00:00', () => {
        expect(withOffset('2026-08-29T09:00', 0)).toBe('2026-08-29T09:00:00Z');
    });

    it('carries a half-hour offset, which several places actually have', () => {
        expect(withOffset('2026-08-29T09:00', 19_800)).toBe('2026-08-29T09:00:00+05:30');
    });

    it('leaves a time that already carries a zone exactly as the service sent it', () => {
        expect(withOffset('2026-08-29T09:00:00-04:00', 7_200)).toBe('2026-08-29T09:00:00-04:00');
        expect(withOffset('2026-08-29T09:00:00Z', 7_200)).toBe('2026-08-29T09:00:00Z');
    });

    it('answers nothing for a time it cannot read, rather than the words Invalid Date', () => {
        // The failure this exists to prevent reaches a microphone.
        expect(withOffset('tomorrow morning', 0)).toBeUndefined();
        expect(withOffset('2026-08-29', 0)).toBeUndefined();
        expect(withOffset(undefined, 0)).toBeUndefined();
        expect(withOffset('', 0)).toBeUndefined();
    });
});

describe('localDate', () => {
    it('reads the calendar day at the PLACE rather than at the server', () => {
        // 23:30 UTC on the 29th is already the 30th in Auckland, and a forecast
        // headed "tomorrow" has to agree with the listener's own calendar.
        const lateEvening = Date.UTC(2026, 7, 29, 23, 30) / 1_000;

        expect(localDate(lateEvening, 0)).toBe('2026-08-29');
        expect(localDate(lateEvening, 12 * 3_600)).toBe('2026-08-30');
        expect(localDate(lateEvening, -5 * 3_600)).toBe('2026-08-29');
    });

    it('answers nothing for something that is not an instant', () => {
        expect(localDate(undefined, 0)).toBeUndefined();
        expect(localDate('now', 0)).toBeUndefined();
    });
});

describe('localInstant', () => {
    it('reports the wall clock at the place, with the offset that makes it unambiguous', () => {
        const noonUtc = Date.UTC(2026, 7, 29, 12, 0) / 1_000;
        expect(localInstant(noonUtc, 3_600)).toBe('2026-08-29T13:00:00+01:00');
    });
});

describe('reading', () => {
    it('rounds to one decimal, because these are said out loud', () => {
        expect(reading(11.37)).toBe(11.4);
        expect(reading(-0.04)).toBe(-0);
    });

    it('answers nothing rather than zero for a field that is missing', () => {
        // The distinction the whole capability is built on: a temperature that
        // is absent and a temperature that is freezing are very different
        // sentences and would otherwise be the same number.
        expect(reading(undefined)).toBeUndefined();
        expect(reading(null)).toBeUndefined();
        expect(reading('12')).toBeUndefined();
        expect(reading(Number.NaN)).toBeUndefined();
    });
});

describe('percentage', () => {
    it('rounds to a whole number and holds it inside nought to a hundred', () => {
        expect(percentage(43.6)).toBe(44);
        expect(percentage(-5)).toBe(0);
        expect(percentage(140)).toBe(100);
    });

    it('answers nothing for a field that is missing', () => {
        expect(percentage(undefined)).toBeUndefined();
    });
});

describe('kphFromMetresPerSecond', () => {
    it('converts, because one service reports wind in metres per second under a metric flag', () => {
        // The easiest thing in the plugin to get wrong, and the failure is a
        // station reporting a gale as a breeze.
        expect(kphFromMetresPerSecond(10)).toBe(36);
        expect(kphFromMetresPerSecond(4.5)).toBe(16.2);
    });

    it('answers nothing for a wind nobody reported', () => {
        expect(kphFromMetresPerSecond(undefined)).toBeUndefined();
    });
});

describe('the small readers', () => {
    it('reads a property off something that may not be an object', () => {
        expect(field({ a: 1 }, 'a')).toBe(1);
        expect(field(null, 'a')).toBeUndefined();
        expect(field('a string', 'a')).toBeUndefined();
    });

    it('treats blank text as absent', () => {
        expect(text('  Atlanta ')).toBe('Atlanta');
        expect(text('   ')).toBeUndefined();
        expect(text(42)).toBeUndefined();
    });

    it('leaves a key off entirely rather than writing undefined onto it', () => {
        // The SDK's rule, and the reason every builder here spreads rather than
        // assigns: `{ high: undefined }` has the key.
        expect(optional('highC', undefined)).toEqual({});
        expect(Object.keys({ ...optional('highC', undefined) })).toEqual([]);
        expect(optional('highC', 21)).toEqual({ highC: 21 });
    });
});
