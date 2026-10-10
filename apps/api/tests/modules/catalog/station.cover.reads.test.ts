// Every catalog read reports a cover the station has not cached as its proxy path, never as the
// provider's URL. The SQL still hands back the raw column for an uncached cover (it cannot seal it:
// the key is not in the database), so what is pinned here is the TS step after every query. Each
// repository runs against a database that compiles its statement for real and answers with a row
// holding a credentialed upstream URL, and the answer must not contain it.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearArtSourceKey, configureArtSourceKey, openSourceToken } from '../../../src/modules/art/art.source.token.js';
import { AlbumsRepository } from '../../../src/modules/catalog/albums.repository.js';
import { ArtistsRepository } from '../../../src/modules/catalog/artists.repository.js';
import { TracksRepository } from '../../../src/modules/catalog/tracks.repository.js';
import type { DB } from '../../../src/modules/data/db.js';
import { HistoryRepository } from '../../../src/modules/history/history.repository.js';

const UPSTREAM = 'https://music.example/rest/getCoverArt.view?id=al-42&u=operator&t=secret&s=salt';
const CACHED = 'art/0b1e4a52-1111-4222-8333-444455556666/cover.jpg';

/** A database that compiles the statement for real and answers every query with the same rows. */
function fakeDb(rows: unknown[]): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });
    const connection: DatabaseConnection = {
        executeQuery: async () => ({ rows }) as QueryResult<never>,
        streamQuery: () => {
            throw new Error('nothing here streams');
        },
    };
    const driver: Driver = Object.assign(new DummyDriver(), { acquireConnection: async () => connection });
    const dialect: Dialect = {
        createAdapter: () => postgres.createAdapter(),
        createIntrospector: db => postgres.createIntrospector(db),
        createQueryCompiler: () => postgres.createQueryCompiler(),
        createDriver: () => driver,
    };
    return new Kysely<DB>({ dialect, plugins: [...KyselyDefaultPlugins] });
}

const LIST = { limit: 10, offset: 0, sort: 'asc', sortBy: 'name' } as const;

/** No http(s) URL anywhere in the answer, and the uncached cover arrives as a proxy path for exactly that URL. */
function expectStationCovers(answer: unknown, proxy: string | undefined): void {
    expect(JSON.stringify(answer)).not.toMatch(/https?:\/\//);
    expect(proxy).toMatch(/^art\/source\//);
    expect(openSourceToken(proxy!.slice('art/source/'.length))).toBe(UPSTREAM);
}

beforeEach(() => configureArtSourceKey('ab'.repeat(32)));
afterEach(() => clearArtSourceKey());

describe("catalog reads report the station's cover, never the provider's", () => {
    it('albums, listed and alone', async () => {
        const repository = new AlbumsRepository(fakeDb([{ id: 'al-1', name: 'A', total: 1, trackCount: '3', imageUrl: UPSTREAM }]));

        const list = await repository.listAlbums(LIST as never);
        expectStationCovers(list, list.data[0]!.imageUrl ?? undefined);

        const one = await repository.findAlbum('al-1');
        expectStationCovers(one, one!.imageUrl ?? undefined);
    });

    it('artists, listed and alone, including a cover borrowed from their newest album', async () => {
        const repository = new ArtistsRepository(fakeDb([{ id: 'ar-1', name: 'A', total: 1, albumCount: '1', trackCount: '3', imageUrl: UPSTREAM }]));

        const list = await repository.listArtists(LIST as never);
        expectStationCovers(list, list.data[0]!.imageUrl ?? undefined);

        const one = await repository.findArtist('ar-1');
        expectStationCovers(one, one!.imageUrl ?? undefined);
    });

    it('tracks, listed, alone, by id and by binding', async () => {
        const repository = new TracksRepository(
            fakeDb([{ id: 'tr-1', title: 'T', artists: 'A', total: 1, albumImageUrl: UPSTREAM, externalId: 'x', trackId: 'tr-1', artistId: 'ar-1' }]),
        );

        const list = await repository.listTracks({ ...LIST, sortBy: 'title' } as never);
        expectStationCovers(list, list.data[0]!.albumImageUrl ?? undefined);

        const one = await repository.findTrack('tr-1');
        expectStationCovers(one, one!.albumImageUrl ?? undefined);

        const byId = await repository.findByIds(['tr-1']);
        expectStationCovers([...byId.values()], byId.get('tr-1')!.artworkUrl);

        const byBinding = await repository.findByBindings('deadair.navidrome', ['x']);
        expectStationCovers(byBinding, byBinding[0]!.albumImageUrl ?? undefined);
    });

    it('leaves a cover the station has cached exactly as it is', async () => {
        const repository = new AlbumsRepository(fakeDb([{ id: 'al-1', name: 'A', total: 1, trackCount: '3', imageUrl: CACHED }]));

        expect((await repository.findAlbum('al-1'))!.imageUrl).toBe(CACHED);
    });

    it('the play history', async () => {
        const repository = new HistoryRepository(
            fakeDb([
                {
                    id: 'h-1',
                    airedAt: '2026-10-10T00:00:00.000Z',
                    title: 'T',
                    artists: 'A',
                    album: null,
                    durationMs: 1,
                    trackId: null,
                    artworkUrl: UPSTREAM,
                },
            ]),
        );

        const page = await repository.page({ stationKey: 'main', limit: 10 });
        expectStationCovers(page, page[0]!.artworkUrl ?? undefined);
    });

    it('fails closed with no key: no cover rather than the URL', async () => {
        clearArtSourceKey();
        const repository = new AlbumsRepository(fakeDb([{ id: 'al-1', name: 'A', total: 1, trackCount: '3', imageUrl: UPSTREAM }]));

        const one = await repository.findAlbum('al-1');

        expect(JSON.stringify(one)).not.toContain('music.example');
        expect(one!.imageUrl).toBeUndefined();
    });
});
