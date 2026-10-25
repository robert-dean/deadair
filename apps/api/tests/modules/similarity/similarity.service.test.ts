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
import { settingsConfig } from '../../utils/settings.config.js';
import { SIMILARITY_ORDER_KEY } from '../../../src/modules/similarity/similarity.settings.js';
import {
    SimilarityStoreRepository,
    type StoredAnswer,
    type StoredNeighbour,
    type StoredRecord,
} from '../../../src/modules/similarity/similarity.store.repository.js';
import { STORED_ANSWER_TTL_MS } from '../../../src/modules/similarity/similarity.service.js';

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
    /** Absent means a source that answers about artists only, which is every one before this existed. */
    similarTracks?: unknown;
}

function record(id: string, options: InstanceOptions = {}, overrides: Partial<PluginRecord> = {}): PluginRecord {
    const instance: Record<string, unknown> = {
        init: vi.fn(),
        similarArtists: options.similarArtists ?? vi.fn(async (): Promise<SimilarArtist[]> => [{ name: 'Massive Attack', match: 0.9 }]),
    };
    if (options.artistTopTracks) instance.artistTopTracks = options.artistTopTracks;
    if (options.similarTracks) instance.similarTracks = options.similarTracks;

    return { id, dir: `/plugins/${id}`, origin: 'bundled', status: 'active', manifest: manifest(id), instance: instance as never, ...overrides };
}

/** The store in memory: what was saved, how many were asked for, and how old the answer reads as. */
class MemoryStore {
    readonly neighbourAnswers = new Map<string, StoredAnswer<StoredNeighbour>>();
    readonly recordAnswers = new Map<string, StoredAnswer<StoredRecord>>();
    failing = false;

    async neighbours(key: string): Promise<StoredAnswer<StoredNeighbour> | undefined> {
        if (this.failing) throw new Error('the database is down');
        return this.neighbourAnswers.get(key);
    }

    async records(key: string): Promise<StoredAnswer<StoredRecord> | undefined> {
        if (this.failing) throw new Error('the database is down');
        return this.recordAnswers.get(key);
    }

    async saveNeighbours(key: string, _name: string, askedLimit: number, entries: (StoredNeighbour & { neighbourKey: string })[]): Promise<void> {
        if (this.failing) throw new Error('the database is down');
        this.neighbourAnswers.set(key, { askedLimit, ageMs: 0, entries: entries.map(({ neighbourKey: _key, ...entry }) => entry) });
    }

    async saveRecords(key: string, _name: string, askedLimit: number, entries: StoredRecord[]): Promise<void> {
        if (this.failing) throw new Error('the database is down');
        this.recordAnswers.set(key, { askedLimit, ageMs: 0, entries });
    }
}

const asStore = (store: MemoryStore): SimilarityStoreRepository => store as unknown as SimilarityStoreRepository;

const build = (records: PluginRecord[], order: string[] = [], store: MemoryStore = new MemoryStore()): SimilarityService => {
    const registry = new PluginRegistry();
    registry.setAll(records);
    // A `list` setting is stored as a JSON array of rows, which is what the console writes.
    const settings: Record<string, string> = order.length === 0 ? {} : { [SIMILARITY_ORDER_KEY]: JSON.stringify(order.map(source => ({ source }))) };
    return new SimilarityService(
        registry,
        new PluginInvoker(registry, stubPluginLog().log),
        settingsConfig(settings).config,
        stubLogger(),
        asStore(store),
    );
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
        // And says whose answer each came from, because a reason given for a neighbour has to name it.
        expect(found.map(artist => artist.source)).toEqual([LASTFM, LASTFM, OTHER]);
    });

    it('credits a name both offered to the source asked first', async () => {
        const service = build([
            record(LASTFM, { similarArtists: vi.fn(async () => named('Massive Attack')) }),
            record(OTHER, { similarArtists: vi.fn(async () => named('Massive Attack')) }),
        ]);

        expect((await service.similarTo({ name: 'Portishead' }, 10))[0]?.source).toBe(LASTFM);
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

        const config = settingsConfig().config;

        await new SimilarityService(registry, invoker, config, stubLogger(), asStore(new MemoryStore())).similarTo({ name: 'Portishead' }, 10);
        await new SimilarityService(registry, invoker, config, stubLogger(), asStore(new MemoryStore())).similarTo({ name: 'Portishead' }, 10);

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

describe('naming records like one record', () => {
    const like = (...titles: string[]): ArtistTrack[] => titles.map(title => ({ title, artist: 'Tricky' }));
    const teardrop = { artist: 'Massive Attack', title: 'Teardrop' };

    it('says whether anything can, apart from whether anything can name records by an artist', () => {
        expect(build([record(LASTFM, { artistTopTracks: vi.fn() })]).canNameSimilarTracks()).toBe(false);
        expect(build([record(LASTFM, { similarTracks: vi.fn() })]).canNameSimilarTracks()).toBe(true);
    });

    it('takes the first source that answers, and asks it about the record it was handed', async () => {
        const first = vi.fn(async () => like('Overcome'));
        const second = vi.fn(async () => like('Aftermath'));
        const service = build([record(LASTFM, { similarTracks: first }), record(OTHER, { similarTracks: second })]);

        expect((await service.similarTracks(teardrop, 5)).map(track => track.title)).toEqual(['Overcome']);
        expect(first).toHaveBeenCalledWith(teardrop, 5);
        expect(second).not.toHaveBeenCalled();
    });

    it('skips a plugin that never wrote the method, and falls through one with nothing to say', async () => {
        const service = build([
            record(LASTFM),
            record(OTHER, { similarTracks: vi.fn(async () => []) }),
            record('deadair.third', { similarTracks: vi.fn(async () => like('Aftermath')) }),
        ]);

        expect((await service.similarTracks(teardrop, 5)).map(track => track.title)).toEqual(['Aftermath']);
    });

    it('answers with nothing when every source failed, so the caller walks the artists instead', async () => {
        const similarTracks = vi.fn(async () => {
            throw new PluginError('upstream is down').withCode('upstream');
        });

        expect(await build([record(LASTFM, { similarTracks })]).similarTracks(teardrop, 5)).toEqual([]);
    });
});

// Which source is asked first. It decides almost nothing for `similarTo`, which pools every
// answer, and it decides whose judgement airs for the two questions that take the first usable
// answer and stop. Before the setting existed that was alphabetical, so the case that matters most
// here is that an empty setting still is.
describe('the order sources are asked in', () => {
    const DEEZER = 'deadair.deezer';
    const MUSICBRAINZ = 'deadair.musicbrainz';

    const namesTracks = (title: string) => ({ artistTopTracks: vi.fn(async (): Promise<ArtistTrack[]> => [{ title, artist: 'Someone' }]) });

    it('falls back to alphabetical with no order set, which is what it did before the setting', async () => {
        const service = build([record(MUSICBRAINZ, namesTracks('from musicbrainz')), record(DEEZER, namesTracks('from deezer'))]);

        expect((await service.topTracks({ name: 'Portishead' }, 3))[0]?.title).toBe('from deezer');
    });

    it('asks the listed source first, whatever it is called', async () => {
        const service = build([record(MUSICBRAINZ, namesTracks('from musicbrainz')), record(DEEZER, namesTracks('from deezer'))], [MUSICBRAINZ]);

        expect((await service.topTracks({ name: 'Portishead' }, 3))[0]?.title).toBe('from musicbrainz');
    });

    it('still falls through to an unlisted source when the listed one has nothing', async () => {
        const empty = { artistTopTracks: vi.fn(async (): Promise<ArtistTrack[]> => []) };
        const service = build([record(MUSICBRAINZ, empty), record(DEEZER, namesTracks('from deezer'))], [MUSICBRAINZ]);

        expect((await service.topTracks({ name: 'Portishead' }, 3))[0]?.title).toBe('from deezer');
    });

    it('ignores an id that is listed but not installed, rather than answering nothing', async () => {
        const service = build([record(DEEZER, namesTracks('from deezer'))], ['deadair.nothing-here', DEEZER]);

        expect((await service.topTracks({ name: 'Portishead' }, 3))[0]?.title).toBe('from deezer');
    });

    it('orders the record-level question too', async () => {
        const like = (title: string) => ({ similarTracks: vi.fn(async (): Promise<ArtistTrack[]> => [{ title, artist: 'Someone' }]) });
        const service = build([record(MUSICBRAINZ, like('from musicbrainz')), record(DEEZER, like('from deezer'))], [MUSICBRAINZ]);

        expect((await service.similarTracks({ artist: 'Massive Attack', title: 'Teardrop' }, 3))[0]?.title).toBe('from musicbrainz');
    });

    it('still pools every source for who resembles whom, whatever the order says', async () => {
        // The order only picks whose ids survive a duplicate; it never drops a name.
        const service = build(
            [
                record(MUSICBRAINZ, { similarArtists: vi.fn(async () => named('Morcheeba')) }),
                record(DEEZER, { similarArtists: vi.fn(async () => named('Tricky')) }),
            ],
            [MUSICBRAINZ],
        );

        expect((await service.similarTo({ name: 'Portishead' }, 10)).map(artist => artist.name)).toEqual(['Morcheeba', 'Tricky']);
    });
});

describe('keeping what the sources said', () => {
    const tracks = (...titles: string[]): ArtistTrack[] => titles.map(title => ({ title, artist: 'Slayer' }));

    it('writes an answer through, and answers the next question from it without asking again', async () => {
        const store = new MemoryStore();
        const artistTopTracks = vi.fn(async () => tracks('Raining Blood', 'Angel of Death'));

        await build([record(LASTFM, { artistTopTracks })], [], store).topTracks({ name: 'Slayer' }, 25);
        const again = await build([record(LASTFM, { artistTopTracks })], [], store).topTracks({ name: 'Slayer' }, 3);

        expect(artistTopTracks).toHaveBeenCalledOnce();
        expect(again).toEqual(tracks('Raining Blood', 'Angel of Death'));
        expect(store.recordAnswers.get('slayer')).toEqual({
            askedLimit: 25,
            ageMs: 0,
            entries: tracks('Raining Blood', 'Angel of Death').map(track => ({ ...track, source: LASTFM })),
        });
    });

    it('asks again for more than was stored, unless what was stored is everything the source had', async () => {
        const store = new MemoryStore();
        store.recordAnswers.set('slayer', { askedLimit: 3, ageMs: 0, entries: tracks('A', 'B', 'C').map(track => ({ ...track, source: LASTFM })) });
        store.recordAnswers.set('bathory', {
            askedLimit: 25,
            ageMs: 0,
            entries: [{ title: 'One Rode to Asa Bay', artist: 'Bathory', source: LASTFM }],
        });
        const artistTopTracks = vi.fn(async () => tracks('A', 'B', 'C', 'D'));
        const service = build([record(LASTFM, { artistTopTracks })], [], store);

        expect(await service.topTracks({ name: 'Slayer' }, 25)).toHaveLength(4);
        expect(await service.topTracks({ name: 'Bathory' }, 25)).toEqual([{ title: 'One Rode to Asa Bay', artist: 'Bathory' }]);
        expect(artistTopTracks).toHaveBeenCalledOnce();
    });

    it('asks again once a stored answer is older than a week', async () => {
        const store = new MemoryStore();
        store.recordAnswers.set('slayer', { askedLimit: 25, ageMs: STORED_ANSWER_TTL_MS, entries: [] });
        const artistTopTracks = vi.fn(async () => tracks('Raining Blood'));

        expect(await build([record(LASTFM, { artistTopTracks })], [], store).topTracks({ name: 'Slayer' }, 25)).toEqual(tracks('Raining Blood'));
        expect(artistTopTracks).toHaveBeenCalledOnce();
    });

    it('keeps an empty answer, so an artist nobody knows is not asked about on every refill', async () => {
        const store = new MemoryStore();
        const artistTopTracks = vi.fn(async () => []);

        await build([record(LASTFM, { artistTopTracks })], [], store).topTracks({ name: 'Nobody' }, 25);
        await build([record(LASTFM, { artistTopTracks })], [], store).topTracks({ name: 'Nobody' }, 25);

        expect(artistTopTracks).toHaveBeenCalledOnce();
    });

    it('keeps nothing when every source failed, so an outage is not remembered for a week', async () => {
        const store = new MemoryStore();
        const failing = vi.fn(async () => {
            throw new Error('down');
        });

        await build([record(LASTFM, { similarArtists: failing, artistTopTracks: failing })], [], store).topTracks({ name: 'Slayer' }, 25);
        await build([record(LASTFM, { similarArtists: failing, artistTopTracks: failing })], [], store).similarTo({ name: 'Slayer' }, 10);

        expect(store.recordAnswers.size).toBe(0);
        expect(store.neighbourAnswers.size).toBe(0);
    });

    it('answers who resembles an artist from the store after a restart has emptied the map', async () => {
        const store = new MemoryStore();
        const similarArtists = vi.fn(async () => named('Mayhem', 'Emperor'));

        await build([record(LASTFM, { similarArtists })], [], store).similarTo({ name: 'Behemoth' }, 10);
        SimilarityService.forget();
        const again = await build([record(LASTFM, { similarArtists })], [], store).similarTo({ name: 'Behemoth' }, 10);

        expect(similarArtists).toHaveBeenCalledOnce();
        expect(again.map(neighbour => [neighbour.name, neighbour.source])).toEqual([
            ['Mayhem', LASTFM],
            ['Emperor', LASTFM],
        ]);
    });

    it('asks the sources as before when the store cannot be read or written', async () => {
        const store = new MemoryStore();
        store.failing = true;
        const artistTopTracks = vi.fn(async () => tracks('Raining Blood'));

        expect(await build([record(LASTFM, { artistTopTracks })], [], store).topTracks({ name: 'Slayer' }, 25)).toEqual(tracks('Raining Blood'));
        expect(artistTopTracks).toHaveBeenCalledOnce();
    });
});
