// This service exists for one reason: an ingest is several writes that are
// worthless apart, so they commit together or not at all. The repository knows
// how to write one row; this knows what a complete ingest is.
//
// So the tests are about the seam rather than the SQL (which is covered against
// a real database): that the work runs on the transaction rather than the
// pooled connection, that admissibility is decided before a transaction is
// opened at all, and that a failure part-way through propagates rather than
// leaving a half-written track behind.

import { describe, expect, it, vi } from 'vitest';
import type { Kysely } from 'kysely';
import type { Logger } from '@maroonedsoftware/logger';
import type { ProviderTrack } from '@deadair/plugin-sdk';

import { CatalogResolverService } from '../../../../src/modules/catalog/ingest/catalog.resolver.service.js';
import { CatalogResolverRepository } from '../../../../src/modules/catalog/ingest/catalog.resolver.repository.js';
import type { DB } from '../../../../src/modules/data/db.js';

const stubLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
});

const track = (overrides: Partial<ProviderTrack> = {}): ProviderTrack => ({
    id: 'ext-1',
    title: 'Hoppípolla',
    artists: ['Sigur Rós'],
    album: 'Takk...',
    durationMs: 268_000,
    ...overrides,
});

/**
 * A repository pair: the injected one (bound to the pool) and the one
 * `withTransaction` hands back. Every call is recorded against whichever
 * received it, so a test can tell the two apart — which is the entire point of
 * the class under test.
 */
function fakeRepository(options: { failOn?: 'artist' | 'track' | 'binding' } = {}) {
    const onPool: string[] = [];
    const onTransaction: string[] = [];

    const bound = {
        resolveArtist: vi.fn(async () => {
            onTransaction.push('resolveArtist');
            if (options.failOn === 'artist') throw new Error('artist write failed');
            return 'artist-1';
        }),
        resolveAlbum: vi.fn(async () => {
            onTransaction.push('resolveAlbum');
            return 'album-1';
        }),
        resolveTrack: vi.fn(async () => {
            onTransaction.push('resolveTrack');
            if (options.failOn === 'track') throw new Error('track write failed');
            return { id: 'track-1', created: true };
        }),
        upsertTrackArtists: vi.fn(async () => {
            onTransaction.push('upsertTrackArtists');
        }),
        upsertTrackSource: vi.fn(async () => {
            onTransaction.push('upsertTrackSource');
            if (options.failOn === 'binding') throw new Error('binding write failed');
        }),
        markMissingTrackSources: vi.fn(async () => ({ kind: 'swept', swept: 3 })),
    };

    const repository = {
        withTransaction: vi.fn(() => bound),
        // Calling any of these directly would mean the work went to the pooled
        // connection, outside the transaction — the bug this class prevents.
        resolveArtist: vi.fn(async () => {
            onPool.push('resolveArtist');
            return 'artist-pool';
        }),
        resolveAlbum: vi.fn(async () => {
            onPool.push('resolveAlbum');
            return 'album-pool';
        }),
        resolveTrack: vi.fn(async () => {
            onPool.push('resolveTrack');
            return { id: 'track-pool', created: true };
        }),
        upsertTrackArtists: vi.fn(async () => {
            onPool.push('upsertTrackArtists');
        }),
        upsertTrackSource: vi.fn(async () => {
            onPool.push('upsertTrackSource');
        }),
        markMissingTrackSources: vi.fn(async () => {
            onPool.push('markMissingTrackSources');
            return { kind: 'swept', swept: 3 };
        }),
    };

    return { repository: repository as unknown as CatalogResolverRepository, bound, onPool, onTransaction };
}

/** A `Kysely` whose transaction runs its callback inline and records commit/rollback. */
function fakeDb() {
    const state = { opened: 0, committed: 0, rolledBack: 0 };
    const db = {
        transaction: () => ({
            execute: async <T>(fn: (trx: unknown) => Promise<T>): Promise<T> => {
                state.opened++;
                try {
                    const result = await fn({ marker: 'trx' });
                    state.committed++;
                    return result;
                } catch (error) {
                    state.rolledBack++;
                    throw error;
                }
            },
        }),
    };
    return { db: db as unknown as Kysely<DB>, state };
}

/**
 * A `Kysely` that already IS a transaction, which is what the scoped one is on
 * every non-exempt request: `auditContextMiddleware` opens one and overrides the
 * container's `Kysely<DB>` with it.
 *
 * Its `transaction()` throws Kysely's real message rather than being a spy, so a
 * test cannot pass by asserting on a call that a working implementation would
 * have made anyway — reaching for it at all is the bug.
 */
function fakeAmbientTransaction() {
    const db = {
        isTransaction: true,
        transaction: () => ({
            execute: async () => {
                throw new Error('calling the transaction method for a Transaction is not supported');
            },
        }),
    };
    return { db: db as unknown as Kysely<DB> };
}

describe('CatalogResolverService.ingestTrack', () => {
    it('runs every write on the transaction, never on the pooled connection', async () => {
        const { repository, onPool, onTransaction } = fakeRepository();
        const { db, state } = fakeDb();

        const result = await new CatalogResolverService(db, repository).ingestTrack('deadair.spotify', track());

        expect(result).toEqual({ status: 'ingested', trackId: 'track-1', created: true });
        expect(onTransaction).toEqual(['resolveArtist', 'resolveAlbum', 'resolveTrack', 'upsertTrackArtists', 'upsertTrackSource']);
        expect(onPool).toEqual([]);
        expect(state).toEqual({ opened: 1, committed: 1, rolledBack: 0 });
    });

    it('joins a transaction the caller already opened instead of opening a second one', async () => {
        // Kysely refuses `.transaction()` on a `Transaction`, and the scoped `Kysely` is one on
        // every non-exempt request. Opening unconditionally is what made airing a chart resolve
        // eight of a hundred records: `PickResolver.discover` calls this inside the request
        // transaction, caught the throw, and downgraded each one to a warning.
        const { repository, onPool, onTransaction } = fakeRepository();
        const { db } = fakeAmbientTransaction();

        const result = await new CatalogResolverService(db, repository).ingestTrack('deadair.spotify', track(), 'discovered');

        expect(result).toEqual({ status: 'ingested', trackId: 'track-1', created: true });
        expect(onTransaction).toEqual(['resolveArtist', 'resolveAlbum', 'resolveTrack', 'upsertTrackArtists', 'upsertTrackSource']);
        expect(onPool).toEqual([]);
        // The caller's transaction itself, so the writes land inside it rather than beside it.
        expect(repository.withTransaction).toHaveBeenCalledWith(db);
    });

    it('lets a failure reach the caller’s transaction rather than absorbing it', async () => {
        // Joining means the caller rolls back too, which is the half of this worth stating: a
        // request that could not finish must leave no track behind.
        const { repository } = fakeRepository({ failOn: 'binding' });
        const { db } = fakeAmbientTransaction();

        await expect(new CatalogResolverService(db, repository).ingestTrack('deadair.spotify', track())).rejects.toThrow(/binding write failed/);
    });

    it('resolves the artist before the album, since an album needs one', async () => {
        // albums.artist_id is NOT NULL, so the order is a constraint, not a style.
        const { repository, onTransaction } = fakeRepository();
        const { db } = fakeDb();

        await new CatalogResolverService(db, repository).ingestTrack('deadair.spotify', track());

        expect(onTransaction.indexOf('resolveArtist')).toBeLessThan(onTransaction.indexOf('resolveAlbum'));
        expect(onTransaction.indexOf('resolveTrack')).toBeLessThan(onTransaction.indexOf('upsertTrackSource'));
    });

    it('writes the credits only once the track row exists', async () => {
        // track_artists.track_id references deadair.tracks, so the row it credits has to be there
        // first.
        const { repository, onTransaction } = fakeRepository();
        const { db } = fakeDb();

        await new CatalogResolverService(db, repository).ingestTrack('deadair.spotify', track());

        expect(onTransaction.indexOf('resolveTrack')).toBeLessThan(onTransaction.indexOf('upsertTrackArtists'));
    });

    it('hands every credited artist to the join-table write, lead first', async () => {
        // The service does not decide who is credited; it passes the provider's own order through,
        // which is what keeps position 0 meaning "lead" rather than "first resolved".
        const { repository, bound } = fakeRepository();
        const { db } = fakeDb();

        await new CatalogResolverService(db, repository).ingestTrack('deadair.spotify', track({ artists: ['Sigur Rós', 'Jónsi'] }));

        expect(bound.upsertTrackArtists).toHaveBeenCalledWith('track-1', ['Sigur Rós', 'Jónsi']);
    });

    it('leaves the binding at the walk’s origin when nobody says otherwise', async () => {
        // The walk is the only caller that enumerates anything, so it is the default.
        const { repository, bound } = fakeRepository();
        const { db } = fakeDb();

        await new CatalogResolverService(db, repository).ingestTrack('deadair.spotify', track());

        expect(bound.upsertTrackSource).toHaveBeenCalledWith('track-1', 'deadair.spotify', expect.anything(), 'sync');
    });

    it('carries a lookup’s origin through, which is what keeps the sweep off it', async () => {
        // A discovered copy is in no playlist, so a walk will never see it and the missing sweep
        // would bench it within the hour of the station finding it.
        const { repository, bound } = fakeRepository();
        const { db } = fakeDb();

        await new CatalogResolverService(db, repository).ingestTrack('deadair.spotify', track(), 'discovered');

        expect(bound.upsertTrackSource).toHaveBeenCalledWith('track-1', 'deadair.spotify', expect.anything(), 'discovered');
    });

    it('skips the album entirely when the provider named none', async () => {
        const { repository, bound, onTransaction } = fakeRepository();
        const { db } = fakeDb();

        await new CatalogResolverService(db, repository).ingestTrack('deadair.spotify', track({ album: undefined }));

        expect(bound.resolveAlbum).not.toHaveBeenCalled();
        expect(onTransaction).toEqual(['resolveArtist', 'resolveTrack', 'upsertTrackArtists', 'upsertTrackSource']);
    });

    it.each([
        ['a write fails part-way through', 'track' as const],
        ['the binding fails after the track was written', 'binding' as const],
    ])('rolls back when %s', async (_label, failOn) => {
        // The half-written state is the thing being prevented: a canonical track
        // with no binding is invisible to playout and duplicates on the next run.
        const { repository } = fakeRepository({ failOn });
        const { db, state } = fakeDb();

        await expect(new CatalogResolverService(db, repository).ingestTrack('deadair.spotify', track())).rejects.toThrow(/failed/);
        expect(state).toEqual({ opened: 1, committed: 0, rolledBack: 1 });
    });

    describe('items that cannot become catalog rows', () => {
        it.each([
            ['the provider credited nobody', []],
            ['the credit normalizes to nothing', ['!!!']],
        ])('refuses when %s, without opening a transaction', async (_label, artists) => {
            // artists.artist_key is `not null unique`, so an empty key would
            // collapse every such item onto one shared artist row.
            const { repository, onPool, onTransaction } = fakeRepository();
            const { db, state } = fakeDb();

            const result = await new CatalogResolverService(db, repository).ingestTrack('deadair.spotify', track({ artists }));

            expect(result).toEqual({ status: 'skipped', reason: 'no-artist' });
            expect(state.opened).toBe(0);
            expect(onTransaction).toEqual([]);
            expect(onPool).toEqual([]);
        });

        it('accepts a title that normalizes to nothing, so long as the artist does not', async () => {
            // "!!!" is a real title and a real band name, and plenty of titles
            // are written in scripts the key drops entirely. Only fuzzy matching
            // degrades; the isrc and binding rungs still identify it.
            const { repository, onTransaction } = fakeRepository();
            const { db } = fakeDb();

            const result = await new CatalogResolverService(db, repository).ingestTrack('deadair.spotify', track({ title: '!!!' }));

            expect(result).toMatchObject({ status: 'ingested' });
            expect(onTransaction).toContain('resolveTrack');
        });
    });
});

describe('CatalogResolverService.markMissing', () => {
    it('delegates without opening a transaction, the sweep owning its own reads', async () => {
        // Two statements now — a count and then the update, both inside the
        // repository — and still no transaction here. The threshold arrives from
        // the caller rather than being read again, so the whole run is judged by
        // one number.
        const { repository } = fakeRepository();
        const { db, state } = fakeDb();

        await expect(new CatalogResolverService(db, repository).markMissing('deadair.spotify', ['a', 'b'], 50)).resolves.toEqual({
            kind: 'swept',
            swept: 3,
        });
        expect(repository.markMissingTrackSources).toHaveBeenCalledWith('deadair.spotify', ['a', 'b'], 50);
        expect(state.opened).toBe(0);
    });
});

/**
 * A `Kysely` double for {@link CatalogResolverRepository.upsertTrackArtists}, standing in for both
 * tables it touches: `deadair.artists`, through the same `resolveArtist` every other ingest write
 * shares, and `deadair.trackArtists`, whose one insert this records.
 *
 * `resolveArtist`'s own SQL is exercised against a real database elsewhere; what is worth a fake
 * here is what `upsertTrackArtists` does BEFORE any SQL runs (dedupe, drop blanks, keep the given
 * order), since that is a decision rather than a query.
 */
function fakeArtistJoinDb(): { db: Kysely<DB>; inserted: () => readonly { trackId: string; artistId: string; position: number }[] } {
    const artistIdByKey = new Map<string, string>();
    let nextArtistId = 1;
    let inserted: readonly { trackId: string; artistId: string; position: number }[] = [];

    const db = {
        selectFrom: (table: string) => {
            if (table !== 'deadair.artists') throw new Error(`unexpected selectFrom ${table}`);
            return {
                select: () => ({
                    where: (_column: string, _op: string, artistKey: string) => ({
                        executeTakeFirst: async () => {
                            const id = artistIdByKey.get(artistKey);
                            return id ? { id, mergedIntoId: null } : undefined;
                        },
                    }),
                }),
            };
        },
        insertInto: (table: string) => {
            if (table === 'deadair.artists') {
                return {
                    values: (values: { artistKey: string }) => ({
                        onConflict: () => ({
                            returning: () => ({
                                executeTakeFirst: async () => {
                                    const id = `artist-${nextArtistId++}`;
                                    artistIdByKey.set(values.artistKey, id);
                                    return { id };
                                },
                            }),
                        }),
                    }),
                };
            }
            if (table === 'deadair.trackArtists') {
                return {
                    values: (rows: readonly { trackId: string; artistId: string; position: number }[]) => ({
                        onConflict: () => ({
                            execute: async () => {
                                inserted = rows;
                            },
                        }),
                    }),
                };
            }
            throw new Error(`unexpected insertInto ${table}`);
        },
    };

    return { db: db as unknown as Kysely<DB>, inserted: () => inserted };
}

describe('CatalogResolverRepository.upsertTrackArtists', () => {
    it('writes every credited artist, lead first at position 0', async () => {
        const { db, inserted } = fakeArtistJoinDb();
        const repository = new CatalogResolverRepository(db, stubLogger());

        await repository.upsertTrackArtists('track-1', ['Sigur Rós', 'Jónsi']);

        expect(inserted()).toEqual([
            { trackId: 'track-1', artistId: 'artist-1', position: 0 },
            { trackId: 'track-1', artistId: 'artist-2', position: 1 },
        ]);
    });

    it('skips a blank credit without skipping the track', async () => {
        const { db, inserted } = fakeArtistJoinDb();
        const repository = new CatalogResolverRepository(db, stubLogger());

        await repository.upsertTrackArtists('track-1', ['Sigur Rós', '', 'Jónsi']);

        expect(inserted().map(row => row.position)).toEqual([0, 1]);
    });

    it('credits a repeated name once, however its case or spacing differs', async () => {
        const { db, inserted } = fakeArtistJoinDb();
        const repository = new CatalogResolverRepository(db, stubLogger());

        await repository.upsertTrackArtists('track-1', ['Sigur Rós', ' SIGUR   RÓS ']);

        expect(inserted()).toHaveLength(1);
        expect(inserted()[0]).toMatchObject({ trackId: 'track-1', position: 0 });
    });
});
