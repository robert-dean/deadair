// The check-up read. Two things are worth pinning and neither is the happy path: that one broken
// reader costs the page ONE section rather than all of them, and that the two timestamps cross the
// wire as datetimes without the service inventing a verdict about them.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { Logger } from '@maroonedsoftware/logger';

import { StationCheckupService } from '../../../src/modules/station/station.checkup.service.js';
import type { TracksRepository } from '../../../src/modules/catalog/tracks.repository.js';
import type { Heartbeat } from '../../../src/modules/shared/heartbeat.js';

const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const counts = { total: 581, cached: 570, measured: 13, enriched: 400, benched: 4, failing: 0 };

function service(over: { all?: () => unknown; trackStateCounts?: () => Promise<unknown> } = {}) {
    const tracks = { trackStateCounts: over.trackStateCounts ?? (() => Promise.resolve(counts)) } as unknown as TracksRepository;
    const heartbeat = {
        all:
            over.all ??
            (() => [
                { name: 'playout.reconcile', startedAt: 1_700_000_000_000, lastBeat: 1_700_000_005_000 },
                // A loop that registered and has never finished a pass, which is what `startedAt`
                // exists to make distinguishable from one that stopped.
                { name: 'audience.poll', startedAt: 1_700_000_000_000 },
            ]),
    } as unknown as Heartbeat;

    return new StationCheckupService(tracks, heartbeat, quiet);
}

describe('StationCheckupService.read', () => {
    it('answers with the loops and the backlog', async () => {
        const reading = await service().read();

        expect(reading.heartbeats).toHaveLength(2);
        expect(reading.backlog).toEqual({ total: 581, cached: 570, measured: 13 });
    });

    /**
     * `Heartbeat` deliberately holds no opinion about thresholds, because a five-second reconcile
     * and a nightly sweep are both healthy and no single number describes both. This carries the
     * timestamps across unchanged so the reader keeps that decision.
     */
    it('carries the timestamps and no verdict about them', async () => {
        const reading = await service().read();
        const [first, second] = reading.heartbeats ?? [];

        expect(first?.startedAt.toMillis()).toBe(1_700_000_000_000);
        expect(first?.lastBeat?.toMillis()).toBe(1_700_000_005_000);
        // A loop that has never completed a pass has no last beat, rather than one standing in for it.
        expect(second?.lastBeat).toBeUndefined();
        expect(first).not.toHaveProperty('stalled');
    });

    it('stamps when the reading was taken, so a stale page cannot pass itself off as now', async () => {
        const before = DateTime.utc();
        const reading = await service().read();

        expect(reading.readAt.toMillis()).toBeGreaterThanOrEqual(before.toMillis());
    });

    /**
     * The rule this service exists under: a page that says what is wrong is the worst place for one
     * broken reader to take the whole answer down.
     */
    it('loses one section rather than the whole reading when a reader fails', async () => {
        const reading = await service({
            trackStateCounts: () => Promise.reject(new Error('the catalog is unreachable')),
        }).read();

        expect(reading.backlog).toBeUndefined();
        expect(reading.heartbeats).toHaveLength(2);
        expect(reading.readAt).toBeDefined();
    });

    it('and the same the other way round', async () => {
        const reading = await service({
            all: () => {
                throw new Error('the heartbeat map is gone');
            },
        }).read();

        expect(reading.heartbeats).toBeUndefined();
        expect(reading.backlog).toEqual({ total: 581, cached: 570, measured: 13 });
    });
});
