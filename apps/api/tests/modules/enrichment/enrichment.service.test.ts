// The fan-out: every active enrichment plugin asked about one track, in
// priority order, with a failing plugin recorded rather than thrown. No
// database and no HTTP here — `EnrichmentService` takes a `TrackRef` and
// returns what was learned, which is the same path the job and any future
// route drive.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { PluginError, type PluginManifest, type TrackRef } from '@deadair/plugin-sdk';

import { EnrichmentService } from '../../../src/modules/enrichment/enrichment.service.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const MUSICBRAINZ = 'deadair.musicbrainz';
const OTHER = 'deadair.other';

const ref: TrackRef = { artist: 'Portishead', title: 'Glory Box', album: 'Dummy' };

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

function manifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id,
        name: id,
        version: '1.0.0',
        kind: 'enrichment',
        capabilities: ['enrichment'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
        ...overrides,
    };
}

interface InstanceOptions {
    priority?: number;
    matchKeys?: string[];
    enrichTrack?: unknown;
}

function instance(options: InstanceOptions = {}) {
    return {
        priority: options.priority ?? 100,
        matchKeys: options.matchKeys ?? ['isrc', 'artist-title'],
        init: vi.fn(),
        enrichTrack: options.enrichTrack ?? vi.fn(async () => ({ artist: 'Portishead' })),
    };
}

function record(id: string, overrides: Partial<PluginRecord> = {}, options: InstanceOptions = {}): PluginRecord {
    return { id, dir: `/plugins/${id}`, status: 'active', manifest: manifest(id), instance: instance(options) as never, ...overrides };
}

let registry: PluginRegistry;
let service: EnrichmentService;

const build = (records: PluginRecord[]): EnrichmentService => {
    registry = new PluginRegistry();
    registry.setAll(records);
    return new EnrichmentService(registry, new PluginInvoker(registry, stubPluginLog().log), stubLogger());
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('providers', () => {
    it('lists the active enrichment plugins, lowest priority first', () => {
        service = build([record(OTHER, {}, { priority: 500 }), record(MUSICBRAINZ, {}, { priority: 100 })]);
        expect(service.providerIds()).toEqual([MUSICBRAINZ, OTHER]);
    });

    it('breaks a priority tie by id, so the order is the same on every pass', () => {
        service = build([record('b.plugin', {}, { priority: 100 }), record('a.plugin', {}, { priority: 100 })]);
        expect(service.providerIds()).toEqual(['a.plugin', 'b.plugin']);
    });

    it('ignores a plugin that is not running', () => {
        service = build([record(MUSICBRAINZ, { status: 'failed', error: 'boom' })]);
        expect(service.providerIds()).toEqual([]);
    });

    it('ignores a plugin that declares enrichment and does not implement it', () => {
        const broken = record(OTHER);
        broken.instance = { priority: 100, matchKeys: ['artist-title'], init: vi.fn() } as never;
        service = build([broken]);
        expect(service.providerIds()).toEqual([]);
    });

    it('ignores a music provider, which answers a different question', () => {
        service = build([record(OTHER, { manifest: manifest(OTHER, { kind: 'music-provider', capabilities: ['catalog'] }) })]);
        expect(service.providerIds()).toEqual([]);
    });
});

describe('enrich', () => {
    it('asks every capable plugin and reports each answer separately', async () => {
        service = build([
            record(MUSICBRAINZ, {}, { priority: 100, enrichTrack: vi.fn(async () => ({ artist: 'Portishead', year: 1994 })) }),
            record(OTHER, {}, { priority: 500, enrichTrack: vi.fn(async () => ({ bpm: 90 })) }),
        ]);

        const result = await service.enrich(ref);

        expect(result.contributions.map(contribution => contribution.pluginId)).toEqual([MUSICBRAINZ, OTHER]);
        expect(result.enrichment).toEqual({ artist: 'Portishead', year: 1994, bpm: 90 });
        expect(result.failures).toEqual([]);
    });

    it('lets the lower priority number decide a field both plugins answered', async () => {
        service = build([
            record(OTHER, {}, { priority: 500, enrichTrack: vi.fn(async () => ({ artist: 'portishead (uk)' })) }),
            record(MUSICBRAINZ, {}, { priority: 100, enrichTrack: vi.fn(async () => ({ artist: 'Portishead' })) }),
        ]);

        expect((await service.enrich(ref)).enrichment.artist).toBe('Portishead');
    });

    it('does not ask an isrc-only plugin about a track that has none', async () => {
        const enrichTrack = vi.fn(async () => ({ artist: 'Portishead' }));
        service = build([record(MUSICBRAINZ, {}, { matchKeys: ['isrc'], enrichTrack })]);

        await service.enrich(ref);
        expect(enrichTrack).not.toHaveBeenCalled();

        await service.enrich({ ...ref, isrc: 'GBAAA9400123' });
        expect(enrichTrack).toHaveBeenCalledTimes(1);
    });

    it('records a plugin failure and keeps going', async () => {
        service = build([
            record(MUSICBRAINZ, {}, { priority: 100, enrichTrack: vi.fn(async () => Promise.reject(new PluginError('upstream is down'))) }),
            record(OTHER, {}, { priority: 500, enrichTrack: vi.fn(async () => ({ bpm: 90 })) }),
        ]);

        const result = await service.enrich(ref);

        expect(result.failures).toHaveLength(1);
        expect(result.failures[0]!.pluginId).toBe(MUSICBRAINZ);
        expect(result.failures[0]!.message).toContain('upstream is down');
        expect(result.enrichment).toEqual({ bpm: 90 });
    });

    it('treats an empty answer as nothing to store, not as an empty contribution', async () => {
        service = build([record(MUSICBRAINZ, {}, { enrichTrack: vi.fn(async () => ({})) })]);

        const result = await service.enrich(ref);

        expect(result.contributions).toEqual([]);
        expect(result.enrichment).toEqual({});
        expect(result.failures).toEqual([]);
    });

    it('sanitizes what a plugin returned before anything downstream sees it', async () => {
        service = build([record(MUSICBRAINZ, {}, { enrichTrack: vi.fn(async () => ({ artist: 'Portishead', year: 'nineteen', nonsense: true })) })]);

        expect((await service.enrich(ref)).enrichment).toEqual({ artist: 'Portishead' });
    });

    it('stops between plugins when the caller aborts', async () => {
        const controller = new AbortController();
        const second = vi.fn(async () => ({ bpm: 90 }));
        service = build([
            record(
                MUSICBRAINZ,
                {},
                {
                    priority: 100,
                    enrichTrack: vi.fn(async () => {
                        controller.abort();
                        return { artist: 'Portishead' };
                    }),
                },
            ),
            record(OTHER, {}, { priority: 500, enrichTrack: second }),
        ]);

        const result = await service.enrich(ref, controller.signal);

        expect(second).not.toHaveBeenCalled();
        expect(result.enrichment).toEqual({ artist: 'Portishead' });
    });

    it('has nothing to say when no enrichment plugin is installed', async () => {
        service = build([]);
        await expect(service.enrich(ref)).resolves.toEqual({ enrichment: {}, contributions: [], failures: [] });
    });
});
