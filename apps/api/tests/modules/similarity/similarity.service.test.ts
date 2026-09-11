// Two opinions about who resembles whom are two opinions, not a conflict, so what is tested here is
// a merge that keeps both without ranking the sources against each other — plus the cache, which is
// static on the class precisely because the service is scoped, and would silently be no cache at all
// if it were not.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { PluginError, type ArtistTrack, type PluginManifest, type SimilarArtist } from '@deadair/plugin-sdk';

import { SimilarityService } from '../../../src/modules/similarity/similarity.service.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const LASTFM = 'deadair.lastfm';
const OTHER = 'deadair.other';

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

function manifest(id: string): PluginManifest {
    return {
        id,
        name: id,
        version: '1.0.0',
        capabilities: ['similarity'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
    };
}

interface InstanceOptions {
    similarArtists?: unknown;
    /** Absent means a source that only says who sounds alike, which is a legitimate plugin. */
    artistTopTracks?: unknown;
}

function record(id: string, options: InstanceOptions = {}, overrides: Partial<PluginRecord> = {}): PluginRecord {
    const instance: Record<string, unknown> = {
        init: vi.fn(),
        similarArtists: options.similarArtists ?? vi.fn(async (): Promise<SimilarArtist[]> => [{ name: 'Massive Attack', match: 0.9 }]),
    };
    if (options.artistTopTracks) instance.artistTopTracks = options.artistTopTracks;

    return { id, dir: `/plugins/${id}`, origin: 'bundled', status: 'active', manifest: manifest(id), instance: instance as never, ...overrides };
}

const build = (records: PluginRecord[]): SimilarityService => {
    const registry = new PluginRegistry();
    registry.setAll(records);
    return new SimilarityService(registry, new PluginInvoker(registry, stubPluginLog().log), stubLogger());
};

const named = (...names: string[]): SimilarArtist[] => names.map((name, index) => ({ name, match: 1 - index / 10 }));

beforeEach(() => {
    vi.clearAllMocks();
    // The cache is process-wide by design, so a case that did not clear it would answer from the
    // one before it.
    SimilarityService.forget();
});

describe('who can answer', () => {
    it('reports nothing installed', () => {
        const service = build([]);
        expect(service.hasSimilarity()).toBe(false);
        expect(service.canNameTracks()).toBe(false);
    });

    it('separates saying who resembles whom from being able to name their records', () => {
        // The distinction a refill depends on: a plugin without `artistTopTracks` can inform a DJ
        // and cannot programme an hour.
        const service = build([record(LASTFM)]);
        expect(service.hasSimilarity()).toBe(true);
        expect(service.canNameTracks()).toBe(false);
    });

    it('ignores a plugin that declares similarity and does not implement it', () => {
        const broken = record(LASTFM);
        broken.instance = { init: vi.fn() } as never;
        expect(build([broken]).hasSimilarity()).toBe(false);
    });
});

describe('merging two sources', () => {
    it('keeps every name both offered rather than letting one source win', async () => {
        const service = build([
            record(LASTFM, { similarArtists: vi.fn(async () => named('Massive Attack', 'Tricky')) }),
            record(OTHER, { similarArtists: vi.fn(async () => named('Morcheeba')) }),
        ]);

        const found = await service.similarTo({ name: 'Portishead' }, 10);

        expect(found.map(artist => artist.name)).toEqual(['Massive Attack', 'Tricky', 'Morcheeba']);
    });

    it('treats the same artist from two sources as one, however it is cased', async () => {
        const service = build([
            record(LASTFM, { similarArtists: vi.fn(async () => named('Massive Attack')) }),
            record(OTHER, { similarArtists: vi.fn(async () => named('massive attack', 'Tricky')) }),
        ]);

        expect((await service.similarTo({ name: 'Portishead' }, 10)).map(artist => artist.name)).toEqual(['Massive Attack', 'Tricky']);
    });

    it('orders by match within one source, since two sources do not share a scale', async () => {
        const similarArtists = vi.fn(async (): Promise<SimilarArtist[]> => [
            { name: 'Tricky', match: 0.4 },
            { name: 'Massive Attack', match: 0.95 },
        ]);
        const service = build([record(LASTFM, { similarArtists })]);

        expect((await service.similarTo({ name: 'Portishead' }, 10)).map(artist => artist.name)).toEqual(['Massive Attack', 'Tricky']);
    });

    it('drops the artist that was asked about, which is a wasted row in a list', async () => {
        const service = build([record(LASTFM, { similarArtists: vi.fn(async () => named('Portishead', 'Tricky')) })]);

        expect((await service.similarTo({ name: 'portishead' }, 10)).map(artist => artist.name)).toEqual(['Tricky']);
    });

    it('loses one source to a failure and keeps the other', async () => {
        const failing = vi.fn(async () => {
            throw new PluginError('upstream is down').withCode('upstream');
        });
        const service = build([record(LASTFM, { similarArtists: failing }), record(OTHER, { similarArtists: vi.fn(async () => named('Tricky')) })]);

        expect((await service.similarTo({ name: 'Portishead' }, 10)).map(artist => artist.name)).toEqual(['Tricky']);
    });

    it('answers with nothing for an artist with no name at all', async () => {
        const service = build([record(LASTFM)]);
        expect(await service.similarTo({ name: '  ' }, 10)).toEqual([]);
    });

    it('trims to the limit the caller asked for', async () => {
        const service = build([record(LASTFM, { similarArtists: vi.fn(async () => named('A', 'B', 'C', 'D')) })]);
        expect(await service.similarTo({ name: 'Portishead' }, 2)).toHaveLength(2);
    });
});

describe('remembering', () => {
    it('asks an upstream once for the same artist', async () => {
        const similarArtists = vi.fn(async () => named('Tricky'));
        const service = build([record(LASTFM, { similarArtists })]);

        await service.similarTo({ name: 'Portishead' }, 10);
        await service.similarTo({ name: 'Portishead' }, 10);

        expect(similarArtists).toHaveBeenCalledOnce();
    });

    it('is shared across instances, because the service is scoped and the answer is not', async () => {
        // The bug this guards: a cache on the instance is empty on every read in the app, where a
        // job run and a request each get their own service, while looking perfect in a test that
        // used one instance.
        const similarArtists = vi.fn(async () => named('Tricky'));
        const registry = new PluginRegistry();
        registry.setAll([record(LASTFM, { similarArtists })]);
        const invoker = new PluginInvoker(registry, stubPluginLog().log);

        await new SimilarityService(registry, invoker, stubLogger()).similarTo({ name: 'Portishead' }, 10);
        await new SimilarityService(registry, invoker, stubLogger()).similarTo({ name: 'Portishead' }, 10);

        expect(similarArtists).toHaveBeenCalledOnce();
    });

    it('answers a narrower limit from what it already holds', async () => {
        const similarArtists = vi.fn(async () => named('A', 'B', 'C'));
        const service = build([record(LASTFM, { similarArtists })]);

        await service.similarTo({ name: 'Portishead' }, 10);

        expect(await service.similarTo({ name: 'Portishead' }, 1)).toHaveLength(1);
        expect(similarArtists).toHaveBeenCalledOnce();
    });
});

describe('naming records by an artist', () => {
    const tracks = (...titles: string[]): ArtistTrack[] => titles.map(title => ({ title, artist: 'Massive Attack' }));

    it('takes the first source that answers rather than interleaving two rankings', async () => {
        const first = vi.fn(async () => tracks('Teardrop'));
        const second = vi.fn(async () => tracks('Angel'));
        const service = build([record(LASTFM, { artistTopTracks: first }), record(OTHER, { artistTopTracks: second })]);

        expect((await service.topTracks({ name: 'Massive Attack' }, 5)).map(track => track.title)).toEqual(['Teardrop']);
        expect(second).not.toHaveBeenCalled();
    });

    it('falls to the next source when the first has nothing', async () => {
        const service = build([
            record(LASTFM, { artistTopTracks: vi.fn(async () => []) }),
            record(OTHER, { artistTopTracks: vi.fn(async () => tracks('Angel')) }),
        ]);

        expect((await service.topTracks({ name: 'Massive Attack' }, 5)).map(track => track.title)).toEqual(['Angel']);
    });

    it('skips a plugin that never wrote the method', async () => {
        const service = build([record(LASTFM), record(OTHER, { artistTopTracks: vi.fn(async () => tracks('Angel')) })]);

        expect(await service.topTracks({ name: 'Massive Attack' }, 5)).toHaveLength(1);
    });

    it('drops a record with no title or no artist, which nothing could name', async () => {
        const artistTopTracks = vi.fn(async (): Promise<ArtistTrack[]> => [
            { title: '  ', artist: 'Massive Attack' },
            { title: 'Teardrop', artist: ' ' },
            { title: 'Angel', artist: 'Massive Attack' },
        ]);
        const service = build([record(LASTFM, { artistTopTracks })]);

        expect((await service.topTracks({ name: 'Massive Attack' }, 5)).map(track => track.title)).toEqual(['Angel']);
    });

    it('answers with nothing when every source failed, rather than throwing at a refill', async () => {
        const artistTopTracks = vi.fn(async () => {
            throw new PluginError('upstream is down').withCode('upstream');
        });
        const service = build([record(LASTFM, { artistTopTracks })]);

        expect(await service.topTracks({ name: 'Massive Attack' }, 5)).toEqual([]);
    });
});
