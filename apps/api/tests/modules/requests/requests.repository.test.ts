// What is pinned here is the one translation the repository makes: a unique violation on one of the
// two one-open indexes becomes `OpenRequestTaken`, saying which rule it broke, and anything else the
// database says is passed on as it was.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import type { DB } from '../../../src/modules/data/db.js';
import { OpenRequestTaken, RequestsRepository, type NewRequest } from '../../../src/modules/requests/requests.repository.js';

/** A database that compiles the statement for real and then fails it with `error`, as the driver would. */
function failingDb(error: unknown): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });
    const connection: DatabaseConnection = {
        executeQuery: async () => {
            throw error;
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

/** What `pg` throws for a unique violation: the code, and the index's name as `constraint`. */
const uniqueViolation = (constraint: string) =>
    Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505', constraint });

const REQUEST: NewRequest = {
    stationKey: 'main',
    requesterKey: 'user:a-1',
    requesterName: 'Robin',
    trackId: 't-1',
    title: 'Teardrop',
    artist: 'Massive Attack',
    status: 'pending',
};

describe('RequestsRepository.create', () => {
    it('answers a second open request from one person as OpenRequestTaken for the requester', async () => {
        const repository = new RequestsRepository(failingDb(uniqueViolation('listener_requests_one_open_per_requester_idx')));

        const error = await repository.create(REQUEST).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(OpenRequestTaken);
        expect((error as OpenRequestTaken).which).toBe('requester');
    });

    it('answers a second open request for one record as OpenRequestTaken for the track', async () => {
        const repository = new RequestsRepository(failingDb(uniqueViolation('listener_requests_one_open_per_track_idx')));

        const error = await repository.create(REQUEST).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(OpenRequestTaken);
        expect((error as OpenRequestTaken).which).toBe('track');
    });

    it('passes on a unique violation on any other index, and any other failure, as it was', async () => {
        const other = uniqueViolation('listener_requests_pkey');
        await expect(new RequestsRepository(failingDb(other)).create(REQUEST)).rejects.toBe(other);

        const gone = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
        await expect(new RequestsRepository(failingDb(gone)).create(REQUEST)).rejects.toBe(gone);
    });
});
