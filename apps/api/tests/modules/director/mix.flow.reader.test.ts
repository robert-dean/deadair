// What a refill reads to judge its batch by the show's mix flow: what the broadcast aired that counts,
// what is still queued in front of the batch with requests left out, each record's main genre, and the
// show's window. A read that fails costs the batch its flow, never the batch.

import { describe, expect, it, vi } from 'vitest';

import { readMixInForce, type MixReaders } from '../../../src/modules/director/mix.flow.reader.js';
import type { StationLineupItem } from '../../../src/modules/director/station.lineup.js';
import type { MixFlow } from '../../../src/modules/schedule/types/mix.types.js';

const flow: MixFlow = {
    version: 1,
    nodes: [
        { id: 'picks', kind: 'picks' },
        { id: 'air', kind: 'onAir' },
    ],
    links: [{ from: 'picks', out: 0, to: 'air', in: 0 }],
};

const item = (id: string, over: Partial<StationLineupItem> = {}): StationLineupItem =>
    ({
        id,
        kind: 'track',
        state: 'planned',
        track: { title: id, artist: `${id} band`, trackId: id, pluginId: 'p', externalId: id, artists: [] },
        ...over,
    }) as StationLineupItem;

function readers(over: Partial<MixReaders> = {}): MixReaders {
    return {
        history: {
            countedDuringBroadcast: vi.fn(async () => [{ trackId: 'aired', title: 'Aired', artist: 'A', airedAtMs: Date.UTC(2026, 10, 15, 20) }]),
        },
        candidates: {
            mainGenresFor: vi.fn(async (ids: readonly string[]) => new Map(ids.map(id => [id, `${id} genre`]))),
            yearsFor: vi.fn(async () => new Map()),
        },
        judgements: { answersFor: vi.fn(async () => new Map()) },
        energies: { energiesFor: vi.fn(async () => new Map()) },
        schedule: { inForce: vi.fn(async () => undefined) },
        config: { get: vi.fn((key: string, fallback?: unknown) => (key === 'station.timezone' ? 'UTC' : fallback)) } as never,
        logger: { warn: vi.fn() } as never,
        ...over,
    };
}

describe('readMixInForce', () => {
    it('reads nothing for a show with no flow', async () => {
        const reads = readers();
        expect(await readMixInForce({ broadcastId: 'b1', rules: {} }, [], reads)).toBeUndefined();
        expect(reads.history.countedDuringBroadcast).not.toHaveBeenCalled();
    });

    it('counts what aired and what is queued, leaving out a request and its follow-on', async () => {
        const mix = await readMixInForce(
            { broadcastId: 'b1', rules: { mixFlow: flow } },
            [item('queued'), item('asked', { requestId: 'r1' } as never), item('after', { followsRequestId: 'r1' } as never)],
            readers(),
            Date.UTC(2026, 10, 15, 21),
        );
        expect(mix?.ctx.counted.map(record => [record.title, record.mainGenre, record.hour])).toEqual([
            ['Aired', 'aired genre', 20],
            ['queued', 'queued genre', 21],
        ]);
    });

    it("reads each record's energy for a flow that splits by it, as a third of the library, and not otherwise", async () => {
        const byEnergy: MixFlow = {
            version: 1,
            nodes: [
                { id: 'picks', kind: 'picks' },
                { id: 'energy', kind: 'split', splitBy: 'energy', branches: [{ values: ['high'] }] },
                { id: 'merge', kind: 'merge' },
                { id: 'air', kind: 'onAir' },
            ],
            links: [
                { from: 'picks', out: 0, to: 'energy', in: 0 },
                { from: 'energy', out: 0, to: 'merge', in: 0 },
                { from: 'energy', out: 1, to: 'merge', in: 1 },
                { from: 'merge', out: 0, to: 'air', in: 0 },
            ],
        };
        const energies = {
            energiesFor: vi.fn(
                async () =>
                    new Map([
                        ['aired', { percentile: 91, from: 'loudnessAndBrightness' as const }],
                        ['queued', { percentile: 12, from: 'loudness' as const }],
                    ]),
            ),
        };

        const mix = await readMixInForce({ broadcastId: 'b1', rules: { mixFlow: byEnergy } }, [item('queued')], readers({ energies }));
        const plain = readers();
        await readMixInForce({ broadcastId: 'b1', rules: { mixFlow: flow } }, [item('queued')], plain);

        expect(mix?.ctx.counted.map(record => [record.title, record.energy])).toEqual([
            ['Aired', 'high'],
            ['queued', 'low'],
        ]);
        expect(plain.energies.energiesFor).not.toHaveBeenCalled();
    });

    it('keeps the rest of the flow when only the energy read fails, reading every record as unmeasured', async () => {
        const byEnergy: MixFlow = {
            version: 1,
            nodes: [
                { id: 'picks', kind: 'picks' },
                { id: 'energy', kind: 'split', splitBy: 'energy', branches: [{ values: ['high'] }] },
                { id: 'merge', kind: 'merge' },
                { id: 'air', kind: 'onAir' },
            ],
            links: [
                { from: 'picks', out: 0, to: 'energy', in: 0 },
                { from: 'energy', out: 0, to: 'merge', in: 0 },
                { from: 'energy', out: 1, to: 'merge', in: 1 },
                { from: 'merge', out: 0, to: 'air', in: 0 },
            ],
        };
        const reads = readers({ energies: { energiesFor: vi.fn(async () => Promise.reject(new Error('the analysis table is gone'))) } });

        const mix = await readMixInForce({ broadcastId: 'b1', rules: { mixFlow: byEnergy } }, [item('queued')], reads);

        expect(mix?.flow).toBe(byEnergy);
        expect(mix?.ctx.counted.every(record => record.energy === undefined)).toBe(true);
        expect(reads.logger.warn).toHaveBeenCalled();
    });

    it('plays the batch without its flow when a read fails, and says so', async () => {
        const reads = readers({ history: { countedDuringBroadcast: vi.fn(async () => Promise.reject(new Error('gone'))) } });
        expect(await readMixInForce({ broadcastId: 'b1', rules: { mixFlow: flow } }, [], reads)).toBeUndefined();
        expect(reads.logger.warn).toHaveBeenCalled();
    });
});
