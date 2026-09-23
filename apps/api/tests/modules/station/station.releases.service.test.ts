// The releases read. What is worth pinning is the wire shape: a heading's date crosses as a date and
// one with none crosses with the field absent, a build with no changelog answers no `current`, and
// what the watch last heard rides along without the read asking GitHub anything.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { BundledChangelog } from '../../../src/modules/station/station.changelog.js';
import type { ReleaseReading, ReleaseWatch } from '../../../src/modules/station/station.release.watch.js';
import { StationReleasesService } from '../../../src/modules/station/station.releases.service.js';
import { StationReleases, serializeStationReleases } from '../../../src/modules/station/types/station.types.js';

function watching(reading: ReleaseReading) {
    const check = vi.fn();
    return { watch: { reading: () => reading, check } as unknown as ReleaseWatch, check };
}

const nothingHeard: ReleaseReading = { enabled: true, newer: [] };

describe('StationReleasesService.read', () => {
    it('answers the release this build contains and every entry newest first', async () => {
        const reading = await new StationReleasesService(
            new BundledChangelog([
                { version: '0.26.2', date: '2026-09-23', notes: '- Fixed.' },
                { version: '0.26.1', notes: '' },
            ]),
            watching(nothingHeard).watch,
        ).read();

        expect(reading.current).toBe('0.26.2');
        expect(reading.notes).toHaveLength(2);
        expect(reading.notes[0]!.date).toBeInstanceOf(DateTime);
        // What the router writes: the day it was read as, in the `yyyy-MM-dd` the SDK reads back,
        // rather than the UTC-midnight timestamp `JSON.stringify` alone would make of it.
        const wire = JSON.parse(JSON.stringify(serializeStationReleases(reading))) as { notes: { date?: string }[] };
        expect(wire.notes[0]!.date).toBe('2026-09-23');
        expect(reading.notes[1]).toEqual({ version: '0.26.1', notes: '' });
    });

    it('answers no current release and no notes for a build with no changelog', async () => {
        expect(await new StationReleasesService(new BundledChangelog(), watching(nothingHeard).watch).read()).toEqual({
            notes: [],
            checks: true,
            available: [],
        });
    });

    it('hands on what the watch last heard, and never asks it to check', async () => {
        const { watch, check } = watching({
            enabled: true,
            checkedAt: Date.UTC(2026, 8, 24, 12),
            newer: [{ version: '0.27.0', date: '2026-09-24', notes: '- New.', url: 'https://github.com/robert-dean/deadair/releases/tag/v0.27.0' }],
        });

        const reading = await new StationReleasesService(new BundledChangelog([{ version: '0.26.2', notes: '' }]), watch).read();

        expect(check).not.toHaveBeenCalled();
        expect(reading.checks).toBe(true);
        expect(reading.checkedAt!.toISO()).toBe('2026-09-24T12:00:00.000Z');
        expect(reading.available).toEqual([
            { version: '0.27.0', date: expect.any(DateTime), notes: '- New.', url: 'https://github.com/robert-dean/deadair/releases/tag/v0.27.0' },
        ]);
        expect(reading.notes[0]).not.toHaveProperty('url');
        // The whole answer, serialised the way the router writes it, is what the contract accepts.
        expect(() => StationReleases.parse(JSON.parse(JSON.stringify(serializeStationReleases(reading))))).not.toThrow();
    });

    it('says the check is off', async () => {
        const reading = await new StationReleasesService(new BundledChangelog(), watching({ enabled: false, newer: [] }).watch).read();

        expect(reading.checks).toBe(false);
        expect(reading).not.toHaveProperty('checkedAt');
    });
});

describe('StationReleasesService.check', () => {
    it('asks the watch to check now, then answers with what it knows', async () => {
        const order: string[] = [];
        const watch = {
            checkNow: vi.fn(async () => {
                order.push('checkNow');
            }),
            reading: () => {
                order.push('reading');
                return nothingHeard;
            },
        } as unknown as ReleaseWatch;

        const reading = await new StationReleasesService(new BundledChangelog([{ version: '0.26.2', notes: '' }]), watch).check();

        expect(order).toEqual(['checkNow', 'reading']);
        expect(reading).toMatchObject({ current: '0.26.2', checks: true, available: [] });
    });
});
