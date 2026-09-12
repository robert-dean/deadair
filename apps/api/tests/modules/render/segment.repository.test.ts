// A delivery is one column, and the risk with one column here is specific: `claimForRender` is the one
// read in `SegmentRepository` with a hand-written column list, and its own comment records `pads`
// shipping missing from it with every test green, because the render job's tests build a `Segment` by
// hand and never come through that statement. So what these pin is the SQL each path COMPILES to,
// against Postgres's own compiler and the app's own plugins, and what the claim makes of a row.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { SegmentRepository } from '../../../src/modules/render/segment.repository.js';
import type { DB } from '../../../src/modules/data/db.js';
import type { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const identity = (): StationIdentity => ({ stationKey: 'a-station', current: () => undefined }) as unknown as StationIdentity;

interface Statement {
    sql: string;
    parameters: readonly unknown[];
}

/** A database that compiles every statement for real, keeps them, and answers each with the rows given. */
function fakeDb(rows: unknown[], statements: Statement[]): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });

    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            statements.push({ sql: compiled.sql, parameters: compiled.parameters });
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

/** A claimed row as Postgres would hand it back, snake case and all. */
const claimedRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    from_state: 'written',
    id: 'seg-1',
    kind: 'talkbreak',
    state: 'rendering',
    label: 'A break',
    script: 'Something is out there.',
    source: 'render',
    source_path: null,
    audio_checksum: null,
    audio_ext: null,
    duration_ms: null,
    error: null,
    voice: 'conspiracy',
    delivery: 'hushed',
    writer: 'model',
    pads: [],
    claims_item_id: null,
    ...overrides,
});

describe('SegmentRepository.claimForRender', () => {
    it('returns the delivery, which is the one thing the render job cannot get from anywhere else', async () => {
        const statements: Statement[] = [];
        const segment = await new SegmentRepository(fakeDb([claimedRow()], statements), identity()).claimForRender('seg-1');

        expect(statements[0]?.sql).toContain('s.delivery');
        expect(segment?.delivery).toBe('hushed');
        expect(segment?.voice).toBe('conspiracy');
    });

    it('reads a word the station no longer knows as no delivery at all', async () => {
        // A row from a vocabulary that has since changed must not reach an engine that could not have
        // claimed it. Absent is the voice's ordinary reading, which is always safe.
        const segment = await new SegmentRepository(fakeDb([claimedRow({ delivery: 'shouty' })], []), identity()).claimForRender('seg-1');

        expect(segment).toBeDefined();
        expect(segment).not.toHaveProperty('delivery');
    });

    it('reads a null delivery as absent, not as a property holding nothing', async () => {
        const segment = await new SegmentRepository(fakeDb([claimedRow({ delivery: null })], []), identity()).claimForRender('seg-1');

        expect(segment).not.toHaveProperty('delivery');
    });
});

describe('SegmentRepository.writeScript', () => {
    const written = { script: 'Go, go, go.', label: 'A break', writer: 'model' };

    it('writes the delivery with the words', async () => {
        const statements: Statement[] = [];
        await new SegmentRepository(fakeDb([], statements), identity()).writeScript('seg-1', { ...written, delivery: 'frantic' });

        expect(statements[0]?.sql).toContain('"delivery" =');
        expect(statements[0]?.parameters).toContain('frantic');
    });

    it('clears it when the words carry none, unlike the voice, which it leaves alone', async () => {
        // The pads-and-claims rule rather than the voice rule: a delivery describes these words, so a
        // line from the floor leaves none behind from the model it replaced.
        const statements: Statement[] = [];
        await new SegmentRepository(fakeDb([], statements), identity()).writeScript('seg-1', written);

        expect(statements[0]?.sql).toContain('"delivery" =');
        expect(statements[0]?.parameters).toContain(null);
        expect(statements[0]?.sql).not.toContain('"voice" =');
    });
});

describe('SegmentRepository.recast', () => {
    it('throws the delivery away with the words', async () => {
        const statements: Statement[] = [];
        await new SegmentRepository(fakeDb([], statements), identity()).recast(['seg-1'], 'persona-1');

        expect(statements[0]?.sql).toMatch(/"delivery" = \$\d+/);
    });
});

describe('SegmentRepository.plan', () => {
    it('keeps a delivery planted beside its words', async () => {
        const statements: Statement[] = [];
        await new SegmentRepository(fakeDb([claimedRow()], statements), identity())
            .plan({ kind: 'talkbreak', label: 'By hand', script: 'Quiet now.', delivery: 'hushed' })
            .catch(() => undefined);

        expect(statements[0]?.sql).toContain('"delivery"');
        expect(statements[0]?.parameters).toContain('hushed');
    });

    it('stores none for a row planted before it has words, since there is nothing yet to read', async () => {
        const statements: Statement[] = [];
        await new SegmentRepository(fakeDb([claimedRow()], statements), identity())
            .plan({ kind: 'talkbreak', label: 'Planted', delivery: 'hushed' })
            .catch(() => undefined);

        expect(statements[0]?.parameters).not.toContain('hushed');
    });
});
