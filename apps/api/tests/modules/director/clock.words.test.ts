// The interesting property here is not which words come out, it is that the window comes out with
// them and actually contains the instant it describes. A phrasing whose window is wrong is a break
// the director drops for no reason, or worse, one it airs after the words stopped being true — and
// neither is audible until it happens on air. So the exhaustive test below walks every minute of a
// day and asserts the invariant rather than spot-checking a few nice-looking sentences.

import { describe, expect, it } from 'vitest';

import { settingsConfig } from '../../utils/settings.config.js';
import { CLOCK_KEYS, roughTime, stationZone } from '../../../src/modules/director/clock.words.js';

/** An instant from a UTC wall clock, so a test can name the time it means. */
const at = (hour: number, minute: number, second = 0): number => Date.UTC(2026, 7, 13, hour, minute, second);

const UTC = 'UTC';

describe('roughTime', () => {
    it('says the hour that has just passed', () => {
        expect(roughTime(at(9, 1), UTC).words).toBe('just after nine');
        expect(roughTime(at(9, 6), UTC).words).toBe('just after nine');
    });

    it('looks forward to the quarter that has not arrived', () => {
        expect(roughTime(at(9, 8), UTC).words).toBe('coming up to quarter past nine');
        expect(roughTime(at(9, 25), UTC).words).toBe('coming up to half past nine');
    });

    it('names the hour ahead once it is counting down to it', () => {
        expect(roughTime(at(9, 40), UTC).words).toBe('coming up to quarter to ten');
        expect(roughTime(at(9, 47), UTC).words).toBe('just after quarter to ten');
        expect(roughTime(at(9, 55), UTC).words).toBe('coming up to ten');
    });

    it('reads midnight and midday as words rather than as twelve and zero', () => {
        expect(roughTime(at(0, 2), UTC).words).toBe('just after midnight');
        expect(roughTime(at(12, 2), UTC).words).toBe('just after midday');
        // The wrap in both directions: the hour before each of them counts down to it.
        expect(roughTime(at(23, 55), UTC).words).toBe('coming up to midnight');
        expect(roughTime(at(11, 55), UTC).words).toBe('coming up to midday');
    });

    it('uses the twelve-hour clock, so the evening reads like the morning', () => {
        expect(roughTime(at(21, 1), UTC).words).toBe('just after nine');
        expect(roughTime(at(13, 31), UTC).words).toBe('just after half past one');
    });

    it('answers a window that contains the instant it describes, at every minute of the day', () => {
        for (let hour = 0; hour < 24; hour++) {
            for (let minute = 0; minute < 60; minute++) {
                const instant = at(hour, minute, 30);
                const { words, validFrom, validUntil } = roughTime(instant, UTC);

                expect(validFrom, words).toBeLessThanOrEqual(instant);
                expect(validUntil, words).toBeGreaterThan(instant);
            }
        }
    });

    it('gives every phrasing a window long enough to outlive the projection drift', () => {
        // A minute of drift is the realistic worst case: records carry exact durations and only the
        // unmeasured segments between them are guessed. A phrasing valid for less than that would
        // expire between being written and being handed over.
        for (let minute = 0; minute < 60; minute++) {
            const { words, validFrom, validUntil } = roughTime(at(9, minute), UTC);
            expect(validUntil - validFrom, words).toBeGreaterThanOrEqual(5 * 60_000);
        }
    });

    it('starts each window on a whole minute of the hour it belongs to', () => {
        const { validFrom, validUntil } = roughTime(at(9, 3, 42), UTC);

        expect(validFrom).toBe(at(9, 0));
        expect(validUntil).toBe(at(9, 7));
    });

    it('reads the clock where the station is, not where the server is', () => {
        // One instant, two zones, two different hours. This is the whole reason the zone is a
        // setting: the same moment is "just after nine" in London and "just after four" in New York.
        const instant = Date.UTC(2026, 7, 13, 20, 2);

        expect(roughTime(instant, 'Europe/London').words).toBe('just after nine');
        expect(roughTime(instant, 'America/New_York').words).toBe('just after four');
    });

    it('keeps the window aligned to the station hour in a zone offset by part of an hour', () => {
        // India is UTC+05:30, so the station's hour starts halfway through UTC's. A window computed
        // off the UTC clock would be thirty minutes out and every phrasing would expire early.
        const instant = Date.UTC(2026, 7, 13, 3, 33); // 09:03 where the station is
        const { words, validFrom, validUntil } = roughTime(instant, 'Asia/Kolkata');

        expect(words).toBe('just after nine');
        // The station's hour starts at :30 past UTC's, and the window has to start with it.
        expect(validFrom).toBe(Date.UTC(2026, 7, 13, 3, 30));
        expect(validUntil).toBe(Date.UTC(2026, 7, 13, 3, 37));
    });
});

describe('stationZone', () => {
    it('answers what the operator set', () => {
        const { config } = settingsConfig({ [CLOCK_KEYS.timezone]: 'Europe/London' });
        expect(stationZone(config)).toBe('Europe/London');
    });

    it('falls back to the host when nobody has said', () => {
        const { config } = settingsConfig();
        expect(stationZone(config)).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    });

    it('treats a box of whitespace as nobody having said', () => {
        const { config } = settingsConfig({ [CLOCK_KEYS.timezone]: '   ' });
        expect(stationZone(config)).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    });
});
