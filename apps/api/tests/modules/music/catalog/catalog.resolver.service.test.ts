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
import type { ProviderTrack } from '@deadair/plugin-sdk';

import { CatalogResolverService } from '../../../../src/modules/music/catalog/catalog.resolver.service.js';
import type { CatalogResolverRepository } from '../../../../src/modules/music/catalog/catalog.resolver.repository.js';
import type { DB } from '../../../../src/modules/data/db.js';

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
        upsertTrackSource: vi.fn(async () => {
            onTransaction.push('upsertTrackSource');
            if (options.failOn === 'binding') throw new Error('binding write failed');
        }),
        markMissingTrackSources: vi.fn(async () => 3),
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
        upsertTrackSource: vi.fn(async () => {
            onPool.push('upsertTrackSource');
        }),
        markMissingTrackSources: vi.fn(async (_pluginId: string, seen: readonly string[]) => {
            onPool.push('markMissingTrackSources');
            return seen.length;
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

describe('CatalogResolverService.ingestTrack', () => {
    it('runs every write on the transaction, never on the pooled connection', async () => {
        const { repository, onPool, onTransaction } = fakeRepository();
        const { db, state } = fakeDb();

        const result = await new CatalogResolverService(db, repository).ingestTrack('deadair.spotify', track());

        expect(result).toEqual({ status: 'ingested', trackId: 'track-1', created: true });
        expect(onTransaction).toEqual(['resolveArtist', 'resolveAlbum', 'resolveTrack', 'upsertTrackSource']);
        expect(onPool).toEqual([]);
        expect(state).toEqual({ opened: 1, committed: 1, rolledBack: 0 });
    });

    it('resolves the artist before the album, since an album needs one', async () => {
        // albums.artist_id is NOT NULL, so the order is a constraint, not a style.
        const { repository, onTransaction } = fakeRepository();
        const { db } = fakeDb();

        await new CatalogResolverService(db, repository).ingestTrack('deadair.spotify', track());

        expect(onTransaction.indexOf('resolveArtist')).toBeLessThan(onTransaction.indexOf('resolveAlbum'));
        expect(onTransaction.indexOf('resolveTrack')).toBeLessThan(onTransaction.indexOf('upsertTrackSource'));
    });

    it('skips the album entirely when the provider named none', async () => {
        const { repository, bound, onTransaction } = fakeRepository();
        const { db } = fakeDb();

        await new CatalogResolverService(db, repository).ingestTrack('deadair.spotify', track({ album: undefined }));

        expect(bound.resolveAlbum).not.toHaveBeenCalled();
        expect(onTransaction).toEqual(['resolveArtist', 'resolveTrack', 'upsertTrackSource']);
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
    it('delegates without opening a transaction, being a single statement', async () => {
        const { repository } = fakeRepository();
        const { db, state } = fakeDb();

        await expect(new CatalogResolverService(db, repository).markMissing('deadair.spotify', ['a', 'b'])).resolves.toBe(2);
        expect(repository.markMissingTrackSources).toHaveBeenCalledWith('deadair.spotify', ['a', 'b']);
        expect(state.opened).toBe(0);
    });
});
