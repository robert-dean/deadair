// The only capability that sends, so what is tested here is mostly restraint: a destination that
// has not been asked for gets nothing queued rather than rows that are discarded later, a plugin
// that cannot say whether it wants plays is treated as not wanting them, and a now-playing is never
// queued because it is worthless late.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { PluginError, type PluginManifest, type ScrobblePlay } from '@deadair/plugin-sdk';

import { SCROBBLE_MAX_WAIT_MS, ScrobbleService, waitFor } from '../../../src/modules/scrobble/scrobble.service.js';
import type { ScrobbleRepository } from '../../../src/modules/scrobble/scrobble.repository.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const LASTFM = 'deadair.lastfm';
const OTHER = 'deadair.libre';

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

function manifest(id: string): PluginManifest {
    return {
        id,
        name: id,
        version: '1.0.0',
        capabilities: ['scrobble'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
    };
}

interface InstanceOptions {
    scrobble?: unknown;
    /** Absent means a plugin that never wrote it, which the SDK says means "always accepting". */
    accepting?: unknown;
    /** Absent means a destination that does not want telling what is on air. */
    nowPlaying?: unknown;
    maxBatchSize?: number;
}

function record(id: string, options: InstanceOptions = {}, overrides: Partial<PluginRecord> = {}): PluginRecord {
    const instance: Record<string, unknown> = {
        init: vi.fn(),
        scrobble: options.scrobble ?? vi.fn(async () => ({ accepted: 1, rejected: [] })),
    };
    if (options.accepting) instance.accepting = options.accepting;
    if (options.nowPlaying) instance.nowPlaying = options.nowPlaying;
    if (options.maxBatchSize !== undefined) instance.maxBatchSize = options.maxBatchSize;

    return { id, dir: `/plugins/${id}`, status: 'active', manifest: manifest(id), instance: instance as never, ...overrides };
}

function build(records: PluginRecord[]) {
    const registry = new PluginRegistry();
    registry.setAll(records);
    const enqueue = vi.fn(async (entries: readonly unknown[]) => entries.length);
    const repository = { enqueue } as unknown as ScrobbleRepository;

    return {
        service: new ScrobbleService(registry, new PluginInvoker(registry, stubPluginLog().log), repository, stubLogger()),
        enqueue,
    };
}

const play = (overrides: Partial<ScrobblePlay> = {}): ScrobblePlay => ({
    title: 'Teardrop',
    artist: 'Massive Attack',
    durationMs: 330_000,
    playedAt: 1_767_225_600_000,
    ...overrides,
});

const aired = (overrides: Partial<ScrobblePlay> = {}) => ({ play: play(overrides), stationKey: 'main', broadcastId: 'b-1' });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('when a play counts', () => {
    it('waits half a record', () => {
        expect(waitFor(200_000)).toBe(100_000);
    });

    it('caps the wait, so a long record is not held for half an hour', () => {
        expect(waitFor(60 * 60 * 1000)).toBe(SCROBBLE_MAX_WAIT_MS);
    });

    it.each([
        ['no duration', undefined],
        ['a nonsense duration', Number.NaN],
        ['a zero duration', 0],
    ])('waits a flat couple of minutes for %s rather than sending immediately', (_case, duration) => {
        // Sending early is a rejection the queue then retries; waiting is two minutes.
        expect(waitFor(duration)).toBe(120_000);
    });
});

describe('who gets a play', () => {
    it('queues nothing on a station with no scrobbler installed, which is the ordinary case', async () => {
        const { service, enqueue } = build([]);

        expect(await service.enqueue(aired())).toBe(0);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('queues a row per destination, so one outage is not the other one retrying', async () => {
        const { service, enqueue } = build([record(LASTFM), record(OTHER)]);

        await service.enqueue(aired());

        expect(enqueue.mock.calls[0]![0]).toHaveLength(2);
    });

    it('treats a plugin that never wrote `accepting` as accepting, per the SDK', async () => {
        const { service, enqueue } = build([record(LASTFM)]);

        await service.enqueue(aired());

        expect(enqueue.mock.calls[0]![0]).toHaveLength(1);
    });

    it('queues NOTHING for a destination that says it is not accepting', async () => {
        // The case an operator using one service for tags alone lives in permanently: no rows at
        // all, rather than a table that fills up and is discarded two minutes later.
        const { service, enqueue } = build([record(LASTFM, { accepting: vi.fn(async () => false) })]);

        expect(await service.enqueue(aired())).toBe(0);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('keeps the accepting destination and drops the declining one', async () => {
        const { service, enqueue } = build([record(LASTFM, { accepting: vi.fn(async () => false) }), record(OTHER)]);

        await service.enqueue(aired());

        expect(enqueue.mock.calls[0]![0]).toEqual([expect.objectContaining({ pluginId: OTHER })]);
    });

    it('treats a plugin that cannot say as NOT accepting, which is the safer way to be wrong', async () => {
        // The alternative is publishing to somebody's account on the strength of a call that failed.
        const accepting = vi.fn(async () => {
            throw new PluginError('config is missing').withCode('config');
        });
        const { service, enqueue } = build([record(LASTFM, { accepting })]);

        expect(await service.enqueue(aired())).toBe(0);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('ignores a plugin that is not running', async () => {
        const { service, enqueue } = build([record(LASTFM, {}, { status: 'failed', error: 'boom' })]);

        expect(await service.enqueue(aired())).toBe(0);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('ignores a plugin that declares scrobble and does not implement it', async () => {
        const broken = record(LASTFM);
        broken.instance = { init: vi.fn() } as never;
        const { service } = build([broken]);

        expect(service.destinations()).toEqual([]);
    });
});

describe('what is queued', () => {
    it('stamps the moment it may be sent, from the record it aired', async () => {
        const { service, enqueue } = build([record(LASTFM)]);

        await service.enqueue(aired({ durationMs: 200_000 }));

        expect(enqueue.mock.calls[0]![0]).toEqual([expect.objectContaining({ eligibleAt: 1_767_225_600_000 + 100_000 })]);
    });

    it('carries the broadcast, so a night of plays can be found again', async () => {
        const { service, enqueue } = build([record(LASTFM)]);

        await service.enqueue(aired());

        expect(enqueue.mock.calls[0]![0]).toEqual([expect.objectContaining({ broadcastId: 'b-1', stationKey: 'main' })]);
    });
});

describe('saying what is on air', () => {
    it('tells only the destinations that want telling', async () => {
        const nowPlaying = vi.fn(async () => {});
        const { service } = build([record(LASTFM, { nowPlaying }), record(OTHER)]);

        await service.announceNowPlaying(play());

        expect(nowPlaying).toHaveBeenCalledOnce();
    });

    it('does not tell a destination that is not accepting', async () => {
        const nowPlaying = vi.fn(async () => {});
        const { service } = build([record(LASTFM, { nowPlaying, accepting: vi.fn(async () => false) })]);

        await service.announceNowPlaying(play());

        expect(nowPlaying).not.toHaveBeenCalled();
    });

    it('swallows a failure, because this is never retried and never queued', async () => {
        const nowPlaying = vi.fn(async () => {
            throw new PluginError('upstream is down').withCode('upstream');
        });
        const { service, enqueue } = build([record(LASTFM, { nowPlaying })]);

        await expect(service.announceNowPlaying(play())).resolves.toBeUndefined();
        expect(enqueue).not.toHaveBeenCalled();
    });
});
