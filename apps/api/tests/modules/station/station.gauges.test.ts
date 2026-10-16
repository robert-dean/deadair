// The gauges read what Check-up reads, so what is pinned is that they read the same things, that the
// three library numbers cost one query rather than three, that the expensive readings keep their own
// cadence, and that shutdown takes every one of them off the recorder.

import { describe, expect, it, vi } from 'vitest';
import type { Container } from 'injectkit';
import { DateTime } from 'luxon';
import { MetricsRecorder } from '@maroonedsoftware/telemetry';

import { TracksRepository } from '../../../src/modules/catalog/tracks.repository.js';
import { LlmGate } from '../../../src/modules/llm/llm.gate.js';
import { METRICS } from '../../../src/modules/metrics/metric.names.js';
import { registerStationGauges } from '../../../src/modules/station/station.gauges.js';
import { StorageService } from '../../../src/modules/storage/storage.service.js';

function harness() {
    const recorder = new MetricsRecorder();
    const tracks = { trackStateCounts: vi.fn(async () => ({ total: 900, cached: 300, measured: 600 })) };
    const storage = { readStorage: vi.fn(async () => ({ totalBytes: 5_000_000 })) };
    const gate = { snapshot: vi.fn(() => ({ depth: 2 })) };
    const scope = {
        get: (token: unknown) => (token === TracksRepository ? tracks : token === StorageService ? storage : undefined),
        disposeAsync: async () => {},
    };
    const container = {
        get: (token: unknown) => (token === MetricsRecorder ? recorder : token === LlmGate ? gate : undefined),
        createScopedContainer: () => scope,
    } as unknown as Container;
    return { recorder, tracks, storage, gate, container };
}

const latest = (recorder: MetricsRecorder) => Object.fromEntries(recorder.drain().map(b => [b.name, b.aggregate.last]));

describe('registerStationGauges', () => {
    it('reads the library, the model queue and the disk the way Check-up does', async () => {
        const { recorder, tracks, container } = harness();
        registerStationGauges(container);

        await recorder.sampleGauges();

        expect(latest(recorder)).toEqual({
            [METRICS.libraryTotal]: 900,
            [METRICS.libraryCached]: 300,
            [METRICS.libraryMeasured]: 600,
            [METRICS.modelWaiting]: 2,
            [METRICS.diskBytes]: 5_000_000,
        });
        expect(tracks.trackStateCounts).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: expect.any(Number) }));
    });

    it('counts the library once for its three gauges', async () => {
        const { recorder, tracks, container } = harness();
        registerStationGauges(container);

        await recorder.sampleGauges();

        expect(tracks.trackStateCounts).toHaveBeenCalledTimes(1);
    });

    it('keeps the model queue every minute, the library every five and the disk every fifteen', async () => {
        const { recorder, tracks, storage, gate, container } = harness();
        registerStationGauges(container);
        const start = DateTime.utc(2026, 10, 16, 12);

        for (let minute = 0; minute < 15; minute += 1) {
            await recorder.sampleGauges(start.plus({ minutes: minute }));
        }

        expect(gate.snapshot).toHaveBeenCalledTimes(15);
        expect(tracks.trackStateCounts).toHaveBeenCalledTimes(3);
        expect(storage.readStorage).toHaveBeenCalledTimes(1);
    });

    it('takes every gauge off the recorder when stopped', async () => {
        const { recorder, container } = harness();
        registerStationGauges(container)();

        await recorder.sampleGauges();

        expect(recorder.pending).toBe(0);
    });
});
