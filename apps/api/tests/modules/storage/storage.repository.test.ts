// What the segment store's claims are made of, read through the real repository over a database that
// answers per table. The case that matters is the soundboard: pads are written into the segment store
// and only `deadair.pads` names them, so a reading of `segments` alone called the whole rack orphaned
// and the nightly sweep deleted it.

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';

import { StorageRepository, fileName } from '../../../src/modules/storage/storage.repository.js';
import { StorageService } from '../../../src/modules/storage/storage.service.js';
import { ORPHAN_GRACE_HOURS_KEY, SWEEP_ORPHANS_KEY } from '../../../src/modules/storage/orphan.sweep.js';
import type { StoredFile } from '../../../src/modules/shared/content.store.js';
import type { DB } from '../../../src/modules/data/db.js';

const SPOKEN = 'a'.repeat(64);
const PAD = 'b'.repeat(64);
const ORPHAN = 'c'.repeat(64);

type Row = Record<string, unknown>;

/** A database that compiles each statement for real and answers it from the rows of the table it names. */
function fakeDb(tables: Record<string, Row[]>): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });
    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            const table = Object.keys(tables).find(name => compiled.sql.includes(`from "deadair"."${name}"`));
            return { rows: table === undefined ? [] : tables[table] } as QueryResult<never>;
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

// Rows as the database answers them, snake_case, so the CamelCasePlugin does to them what it does live.
const tables = (): Record<string, Row[]> => ({
    segments: [
        { audio_checksum: SPOKEN, audio_ext: 'mp3' },
        // The same words twice is one file under two rows.
        { audio_checksum: SPOKEN, audio_ext: 'mp3' },
    ],
    pads: [{ audio_checksum: PAD, audio_ext: 'wav' }],
});

describe('StorageRepository.segmentClaims', () => {
    it('claims every pad as well as every segment, since both are written into the segment store', async () => {
        const claims = await new StorageRepository(fakeDb(tables())).segmentClaims();

        expect(claims.names).toEqual(new Set([fileName(SPOKEN, 'mp3'), fileName(PAD, 'wav')]));
        // Rows, not files: two segment rows share one file, and the pad is a third row.
        expect(claims.rows).toBe(3);
        expect(claims.bytes).toBeUndefined();
    });
});

describe('the nightly sweep over the real claims', () => {
    const old = DateTime.now().minus({ days: 3 });

    const build = () => {
        const files: StoredFile[] = [
            { checksum: SPOKEN, ext: 'mp3', bytes: 100, modifiedAt: old },
            { checksum: PAD, ext: 'wav', bytes: 200, modifiedAt: old },
            { checksum: ORPHAN, ext: 'mp3', bytes: 300, modifiedAt: old },
        ];
        const segments = { root: '/media/segments', list: vi.fn(async () => files), remove: vi.fn(async () => true) };
        const empty = { root: '/elsewhere', list: vi.fn(async (): Promise<StoredFile[]> => []), remove: vi.fn(async () => true) };
        const settings: Record<string, string> = { [SWEEP_ORPHANS_KEY]: 'true', [ORPHAN_GRACE_HOURS_KEY]: '24' };
        const config = { get: (key: string, fallback: unknown) => settings[key] ?? String(fallback) } as unknown as AppConfig;

        const service = new StorageService(
            new StorageRepository(fakeDb(tables())),
            empty as never,
            empty as never,
            segments as never,
            empty as never,
            config,
            { root: '/data/streamarchive', list: async () => [] } as never,
        );

        return { service, segments };
    };

    it('keeps a file only a pad claims, and still removes one nothing claims', async () => {
        const { service, segments } = build();

        expect(await service.sweep()).toEqual({ ran: true, removed: 1, freedBytes: 300, heldBack: 0 });
        expect(segments.remove).toHaveBeenCalledTimes(1);
        expect(segments.remove).toHaveBeenCalledWith(ORPHAN, 'mp3');
    });

    it('reports the pad as claimed rather than as an orphan', async () => {
        const { service } = build();

        const report = await service.readStorage();
        const store = report.stores.find(entry => entry.id === 'segments');

        expect(store).toMatchObject({ files: 3, rows: 3, orphanFiles: 1, orphanBytes: 300, rowsWithNoFile: 0 });
    });
});
