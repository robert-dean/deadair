// Which day the station is having, in its own zone, and how long it stays that day. Everything the
// almanac does hangs off this: an entry handed to a writer for the wrong date is true of a day
// nobody is listening on, and it reads exactly as right as one that is not.

import { describe, expect, it } from 'vitest';

import { stationDay } from '../../../src/modules/almanac/almanac.day.js';

/** An instant, written as the wall clock somewhere, so a test says what it means. */
const at = (iso: string): number => new Date(iso).getTime();

describe('the day an instant falls in', () => {
    it("is the station's own, not the server's", () => {
        // 23:30 in London on the 20th is 10:30 on the 21st in Auckland, and the two stations should
        // be reading out different days.
        const instant = at('2026-09-20T22:30:00Z');

        expect(stationDay(instant, 'Europe/London').date).toBe('09-20');
        expect(stationDay(instant, 'Pacific/Auckland').date).toBe('09-21');
    });

    it('is the day the words will be heard, which is the whole reason it takes an instant', () => {
        const beforeMidnight = at('2026-09-20T23:50:00Z');
        const afterMidnight = at('2026-09-21T00:05:00Z');

        expect(stationDay(beforeMidnight, 'UTC').date).toBe('09-20');
        expect(stationDay(afterMidnight, 'UTC').date).toBe('09-21');
    });

    it('answers with the month and day as numbers as well as the padded date', () => {
        expect(stationDay(at('2026-01-02T12:00:00Z'), 'UTC')).toMatchObject({ month: 1, day: 2, date: '01-02' });
    });
});

describe('how long it is still that day', () => {
    it('runs from this midnight to the next, station-local', () => {
        const day = stationDay(at('2026-09-20T14:00:00Z'), 'UTC');

        expect(day.from).toBe(at('2026-09-20T00:00:00Z'));
        expect(day.until).toBe(at('2026-09-21T00:00:00Z'));
    });

    it('holds the instant it was asked about', () => {
        const instant = at('2026-09-20T23:59:59.500Z');
        const day = stationDay(instant, 'UTC');

        expect(day.from).toBeLessThanOrEqual(instant);
        expect(day.until).toBeGreaterThan(instant);
    });

    it('is 23 hours long through a spring forward, because it is a calendar day and not 24 hours', () => {
        // 29 March 2026, when British clocks go forward at 01:00.
        const day = stationDay(at('2026-03-29T12:00:00Z'), 'Europe/London');

        expect(day.until - day.from).toBe(23 * 3_600_000);
    });

    it('is 25 hours long through an autumn back', () => {
        // 25 October 2026, when they go back at 02:00.
        const day = stationDay(at('2026-10-25T12:00:00Z'), 'Europe/London');

        expect(day.until - day.from).toBe(25 * 3_600_000);
    });

    it('carries no fraction of a second, whatever the instant did', () => {
        const day = stationDay(at('2026-09-20T14:22:33.687Z'), 'UTC');

        expect(day.from % 1000).toBe(0);
        expect(day.until % 1000).toBe(0);
    });

    it('ends where the next day begins, with nothing between them', () => {
        const today = stationDay(at('2026-09-20T14:00:00Z'), 'Europe/London');
        const tomorrow = stationDay(today.until, 'Europe/London');

        expect(tomorrow.from).toBe(today.until);
        expect(tomorrow.date).toBe('09-21');
    });
});
