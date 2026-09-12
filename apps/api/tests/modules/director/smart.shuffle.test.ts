// The smart shuffle is a setting and a ramp. The setting has the failure every setting here has had
// (a string that reads as on however it is set) and the ramp has the failure every weight has: one
// that is subtly wrong sounds exactly like a station with a small library. So the switch is tested
// off with the STRING, and the ramp at both ends and past them.

import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { settingsConfig } from '../../utils/settings.config.js';
import {
    clampSmartShuffleDays,
    DEFAULT_SMART_SHUFFLE,
    DEFAULT_SMART_SHUFFLE_DAYS,
    freshnessOf,
    historyDaysFor,
    resolveSmartShuffle,
    SMART_SHUFFLE_DAYS_RANGE,
    SMART_SHUFFLE_KEYS,
} from '../../../src/modules/director/smart.shuffle.js';
import { PLAY_HISTORY_RETENTION_DAYS } from '../../../src/modules/director/play.history.repository.js';

describe('resolveSmartShuffle', () => {
    it('is on, over a fortnight, for a station that never touched it', () => {
        expect(resolveSmartShuffle(settingsConfig().config)).toEqual({ enabled: DEFAULT_SMART_SHUFFLE, horizonDays: DEFAULT_SMART_SHUFFLE_DAYS });
        expect(DEFAULT_SMART_SHUFFLE).toBe(true);
    });

    it('turns off with the string an operator actually stores', () => {
        // A real boolean passes whatever the reader does. The row holds text.
        expect(resolveSmartShuffle(settingsConfig({ [SMART_SHUFFLE_KEYS.enabled]: 'false' }).config).enabled).toBe(false);
    });

    it('takes the default for a switch nobody can read', () => {
        expect(resolveSmartShuffle(settingsConfig({ [SMART_SHUFFLE_KEYS.enabled]: 'maybe' }).config).enabled).toBe(DEFAULT_SMART_SHUFFLE);
    });

    it('reads a stored horizon as whole days inside the range', () => {
        const read = (value: string) => resolveSmartShuffle(settingsConfig({ [SMART_SHUFFLE_KEYS.days]: value }).config).horizonDays;

        expect(read('30')).toBe(30);
        expect(read('7.8')).toBe(7);
        expect(read('0')).toBe(SMART_SHUFFLE_DAYS_RANGE.min);
        expect(read('9000')).toBe(SMART_SHUFFLE_DAYS_RANGE.max);
        expect(read('a fortnight')).toBe(DEFAULT_SMART_SHUFFLE_DAYS);
    });

    it('never reaches past what the history keeps', () => {
        // A record aired longer ago than rows are kept is indistinguishable from one never aired.
        expect(SMART_SHUFFLE_DAYS_RANGE.max).toBe(PLAY_HISTORY_RETENTION_DAYS);
        expect(clampSmartShuffleDays(PLAY_HISTORY_RETENTION_DAYS + 1)).toBe(PLAY_HISTORY_RETENTION_DAYS);
    });
});

describe('historyDaysFor', () => {
    it('asks for nothing when off, so the history read costs no query', () => {
        expect(historyDaysFor({ enabled: false, horizonDays: 14 })).toBe(0);
        expect(historyDaysFor({ enabled: true, horizonDays: 14 })).toBe(14);
    });
});

describe('freshnessOf', () => {
    const now = DateTime.fromISO('2026-09-12T12:00:00Z');

    it('treats a record with no airing inside the horizon as fully fresh', () => {
        expect(freshnessOf(undefined, now, 14)).toBe(1);
    });

    it('ramps evenly from just aired to a horizon ago', () => {
        expect(freshnessOf(now, now, 14)).toBe(0);
        expect(freshnessOf(now.minus({ days: 7 }), now, 14)).toBeCloseTo(0.5);
        expect(freshnessOf(now.minus({ days: 14 }), now, 14)).toBe(1);
        expect(freshnessOf(now.minus({ days: 40 }), now, 14)).toBe(1);
    });

    it('reads an airing the clock has in the future as just aired', () => {
        expect(freshnessOf(now.plus({ minutes: 5 }), now, 14)).toBe(0);
    });

    it('has no opinion without a horizon', () => {
        expect(freshnessOf(now, now, 0)).toBe(1);
    });
});
