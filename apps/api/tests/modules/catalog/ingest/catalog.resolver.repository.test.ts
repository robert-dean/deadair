// The resolver's SQL is exercised end to end against a real database; what is
// worth testing in isolation is the two places it makes a decision rather than
// a query.
//
// `chooseTrackCandidate` is the judgement call in the whole ingest path: same
// artist, same normalized title, several rows, and only a duration to go on.
// Getting it wrong attaches one recording's provider bindings to another, and
// getting it *unstably* wrong is worse — the same item would drift between
// duplicates run to run, scattering the bindings that make a track playable.
//
// `markMissingTrackSources` is tested for the one input that is catastrophic
// rather than merely wrong: an empty seen-set, where `<> all('{}')` would sweep
// a plugin's entire catalog.

import { describe, expect, it, vi } from 'vitest';
import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import type { Logger } from '@maroonedsoftware/logger';

import {
    CatalogResolverRepository,
    chooseTrackCandidate,
    usablePosition,
} from '../../../../src/modules/catalog/ingest/catalog.resolver.repository.js';
import type { DB } from '../../../../src/modules/data/db.js';

const stubLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
});

/**
 * A `Kysely` that answers the sweep's counting query and records whether the
 * UPDATE behind it was ever reached.
 *
 * Every builder method returns the chain again and only the two terminals answer,
 * which is enough because the SQL itself is covered against a real database. What
 * this is for is the ORDER — count, decide, then write or do not — and that is
 * exactly what a fake can see and a real database cannot be asked about cheaply.
 *
 * The counts come back as strings, because `count(*)` is a bigint over the wire
 * and arrives as text; a fake handing over numbers would hide the conversion.
 */
function countingDb(counts: { known: number; unseen: number }): { db: Kysely<DB>; updated: () => boolean } {
    let sawUpdate = false;

    const chain = (terminals: Record<string, () => unknown>): unknown =>
        new Proxy(
            {},
            {
                get(_target, property) {
                    const terminal = terminals[String(property)];
                    return terminal ?? (() => chain(terminals));
                },
            },
        );

    const db = {
        selectFrom: () =>
            chain({
                executeTakeFirstOrThrow: async () => ({ known: String(counts.known), unseen: String(counts.unseen) }),
            }),
        updateTable: () =>
            chain({
                executeTakeFirst: async () => {
                    sawUpdate = true;
                    return { numUpdatedRows: BigInt(counts.unseen) };
                },
            }),
    };

    return { db: db as unknown as Kysely<DB>, updated: () => sawUpdate };
}

/** A `Kysely` that fails the test if the repository touches it at all. */
const untouchableDb = (): Kysely<DB> =>
    new Proxy(
        {},
        {
            get(_target, property) {
                throw new Error(`the database was queried (.${String(property)}) when it should not have been`);
            },
        },
    ) as Kysely<DB>;

describe('chooseTrackCandidate', () => {
    it('returns nothing when there is nothing to choose from', () => {
        expect(chooseTrackCandidate([], 180_000)).toBeUndefined();
    });

    it('takes the only candidate without consulting duration', () => {
        // Reported as `only` rather than `duration`, so the caller can stay
        // quiet about a resolution that involved no judgement.
        expect(chooseTrackCandidate([{ id: 'a', durationMs: 999 }], 180_000)).toEqual({ id: 'a', by: 'only' });
    });

    it('prefers the closest duration within tolerance', () => {
        const candidates = [
            { id: 'album-version', durationMs: 245_000 },
            { id: 'radio-edit', durationMs: 180_000 },
        ];
        expect(chooseTrackCandidate(candidates, 181_000)).toEqual({ id: 'radio-edit', by: 'duration' });
    });

    it('ignores candidates outside the 3s tolerance and falls back to the oldest', () => {
        // A radio edit is not its album version, however alone it is in the list.
        const candidates = [
            { id: 'oldest', durationMs: 245_000 },
            { id: 'newer', durationMs: 300_000 },
        ];
        expect(chooseTrackCandidate(candidates, 180_000)).toEqual({ id: 'oldest', by: 'age' });
    });

    it('accepts a difference exactly at the tolerance boundary', () => {
        const candidates = [
            { id: 'oldest', durationMs: 300_000 },
            { id: 'trimmed-fade', durationMs: 183_000 },
        ];
        expect(chooseTrackCandidate(candidates, 180_000)).toEqual({ id: 'trimmed-fade', by: 'duration' });
    });

    it('keeps the older row when two candidates are equally close', () => {
        // Stability is the point: an arbitrary-but-consistent answer beats one
        // that depends on sort order, because the next run must reach the same row.
        const candidates = [
            { id: 'older', durationMs: 179_000 },
            { id: 'newer', durationMs: 181_000 },
        ];
        expect(chooseTrackCandidate(candidates, 180_000)).toEqual({ id: 'older', by: 'duration' });
    });

    it('falls back to the oldest when the provider gave no duration', () => {
        const candidates = [
            { id: 'older', durationMs: 180_000 },
            { id: 'newer', durationMs: 245_000 },
        ];
        expect(chooseTrackCandidate(candidates, undefined)).toEqual({ id: 'older', by: 'age' });
    });

    it('skips candidates with no recorded duration rather than treating them as zero', () => {
        const candidates = [
            { id: 'unknown-length', durationMs: null },
            { id: 'known-length', durationMs: 180_500 },
        ];
        expect(chooseTrackCandidate(candidates, 180_000)).toEqual({ id: 'known-length', by: 'duration' });
    });

    it('falls back to the oldest when every candidate has no duration', () => {
        const candidates = [
            { id: 'older', durationMs: null },
            { id: 'newer', durationMs: null },
        ];
        expect(chooseTrackCandidate(candidates, 180_000)).toEqual({ id: 'older', by: 'age' });
    });
});

describe('markMissingTrackSources', () => {
    it('refuses an empty seen-set instead of sweeping the whole plugin', async () => {
        // Refused before the database is touched at all, which the untouchable
        // proxy is what proves: the counting query below must not be the thing
        // that stands between this input and the update.
        const logger = stubLogger();
        const repository = new CatalogResolverRepository(untouchableDb(), logger);

        await expect(repository.markMissingTrackSources('deadair.spotify', [], 50)).resolves.toEqual({
            kind: 'refused',
            reason: 'nothing-seen',
        });
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no tracks'), { plugin: 'deadair.spotify' });
    });

    it('counts before it writes, and issues no update when the guard refuses', async () => {
        // The renumber: a full seen-set that matches nothing. The empty-set test
        // above cannot see this, so what is asserted is the thing that would
        // otherwise happen — the UPDATE — never being reached.
        const { db, updated } = countingDb({ known: 800, unseen: 800 });
        const repository = new CatalogResolverRepository(db, stubLogger());

        await expect(repository.markMissingTrackSources('deadair.navidrome', ['new-1', 'new-2'], 50)).resolves.toEqual({
            kind: 'refused',
            reason: 'too-many',
            known: 800,
            unseen: 800,
        });
        expect(updated()).toBe(false);
    });

    it('sweeps when the walk recognised enough of the library', async () => {
        const { db, updated } = countingDb({ known: 800, unseen: 12 });
        const repository = new CatalogResolverRepository(db, stubLogger());

        await expect(repository.markMissingTrackSources('deadair.navidrome', ['a', 'b'], 50)).resolves.toEqual({ kind: 'swept', swept: 12 });
        expect(updated()).toBe(true);
    });

    it('sweeps a library too small for a proportion to mean anything', async () => {
        // Three of four copies gone is 75%, and on this library that is somebody
        // tidying a playlist rather than a provider losing its mind.
        const { db, updated } = countingDb({ known: 4, unseen: 3 });
        const repository = new CatalogResolverRepository(db, stubLogger());

        await expect(repository.markMissingTrackSources('deadair.navidrome', ['a'], 50)).resolves.toEqual({ kind: 'swept', swept: 3 });
        expect(updated()).toBe(true);
    });
});

interface Captured {
    statements: { sql: string; parameters: readonly unknown[] }[];
}

/**
 * A database that compiles the statements for real and answers with rows somebody chose.
 *
 * Every statement is kept rather than only the last, because two of these methods send two — the
 * insert and the cursor advance — and the point of the pair is that both went.
 */
function compilingDb(rows: unknown[], captured: Captured = { statements: [] }): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });

    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.statements.push({ sql: compiled.sql, parameters: compiled.parameters });
            return { rows } as QueryResult<never>;
        },
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

describe('where a record sits on its album', () => {
    it('keeps a whole number from one and nothing else', () => {
        expect(usablePosition(3)).toBe(3);
        expect(usablePosition(0)).toBeUndefined();
        expect(usablePosition(2.5)).toBeUndefined();
        expect(usablePosition(undefined)).toBeUndefined();
    });

    it('fills it on an existing row only from a copy on that row’s own album, and only while blank', async () => {
        const captured: Captured = { statements: [] };
        // Every read answers one row, so the isrc lookup finds an existing track.
        const repository = new CatalogResolverRepository(compilingDb([{ id: 'track-1', mergedIntoId: null }], captured), stubLogger());

        await repository.resolveTrack('artist-1', 'album-1', {
            title: 'Roads',
            artists: ['Portishead'],
            isrc: 'GB123',
            trackNumber: 3,
            discNumber: 1,
        });

        const position = captured.statements.find(statement => statement.sql.includes('"track_number" ='));
        expect(position?.sql).toMatch(/"album_id" = \$\d+/);
        expect(position?.sql).toMatch(/"track_number" is null/);
        expect(position?.parameters).toEqual(expect.arrayContaining([3, 'track-1', 'album-1']));
    });

    it('asks nothing about a position for a copy with no album, which has nothing to sit on', async () => {
        const captured: Captured = { statements: [] };
        const repository = new CatalogResolverRepository(compilingDb([{ id: 'track-1', mergedIntoId: null }], captured), stubLogger());

        await repository.resolveTrack('artist-1', undefined, { title: 'Roads', artists: ['Portishead'], isrc: 'GB123', trackNumber: 3 });

        expect(captured.statements.some(statement => statement.sql.includes('"track_number"'))).toBe(false);
    });
});
