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

    it('plays the batch without its flow when a read fails, and says so', async () => {
        const reads = readers({ history: { countedDuringBroadcast: vi.fn(async () => Promise.reject(new Error('gone'))) } });
        expect(await readMixInForce({ broadcastId: 'b1', rules: { mixFlow: flow } }, [], reads)).toBeUndefined();
        expect(reads.logger.warn).toHaveBeenCalled();
    });
});
