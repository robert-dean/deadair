// Whether the hourly cron's run of the catalog walk goes ahead. Every value here is handed over as
// a STRING, because that is what every layer of `AppConfig` holds: a test that passes a real
// `false` for the switch passes whether or not the switch works.

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import {
    CATALOG_SYNC_KEYS,
    MAX_SYNC_EVERY_HOURS,
    resolveSyncEveryHours,
    scheduledSyncIsDue,
} from '../../../../src/modules/catalog/ingest/catalog.sync.schedule.js';

function config(values: Record<string, string>): AppConfig {
    return { get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback) } as unknown as AppConfig;
}

/** An hour counted from the epoch, a few seconds past the top as a cron run would arrive. */
const atHour = (hour: number) => new Date(hour * 3_600_000 + 4_000);

describe('scheduledSyncIsDue', () => {
    it('runs every hour when nothing has been set', () => {
        for (const hour of [0, 1, 2, 487_000, 487_001]) {
            expect(scheduledSyncIsDue(config({}), atHour(hour))).toBe(true);
        }
    });

    it("is off when the switch holds the string 'false'", () => {
        expect(scheduledSyncIsDue(config({ [CATALOG_SYNC_KEYS.auto]: 'false' }), atHour(0))).toBe(false);
    });

    it('stays on when the switch holds something nobody can read', () => {
        // A value nobody can parse is a setting nobody set, and the default is on.
        expect(scheduledSyncIsDue(config({ [CATALOG_SYNC_KEYS.auto]: 'perhaps' }), atHour(0))).toBe(true);
    });

    it('runs only in hours that are a multiple of the interval', () => {
        const every6 = config({ [CATALOG_SYNC_KEYS.everyHours]: '6' });
        const due = [0, 1, 2, 3, 4, 5, 6, 7, 12].filter(hour => scheduledSyncIsDue(every6, atHour(hour)));

        expect(due).toEqual([0, 6, 12]);
    });

    it('judges by the hour, so a retry later in the same hour is still due', () => {
        const every6 = config({ [CATALOG_SYNC_KEYS.everyHours]: '6' });

        expect(scheduledSyncIsDue(every6, new Date(6 * 3_600_000 + 59 * 60_000))).toBe(true);
    });

    it('ignores the interval while switched off', () => {
        const off = config({ [CATALOG_SYNC_KEYS.auto]: 'off', [CATALOG_SYNC_KEYS.everyHours]: '1' });

        expect(scheduledSyncIsDue(off, atHour(0))).toBe(false);
    });
});

describe('resolveSyncEveryHours', () => {
    it('reads a stored string', () => {
        expect(resolveSyncEveryHours('3')).toBe(3);
    });

    it('clamps rather than refusing a stored row out of range', () => {
        expect(resolveSyncEveryHours('0')).toBe(1);
        expect(resolveSyncEveryHours('-4')).toBe(1);
        expect(resolveSyncEveryHours('400')).toBe(MAX_SYNC_EVERY_HOURS);
    });

    it('takes the default for anything unreadable', () => {
        expect(resolveSyncEveryHours('')).toBe(1);
        expect(resolveSyncEveryHours(undefined)).toBe(1);
        expect(resolveSyncEveryHours('hourly')).toBe(1);
    });
});
