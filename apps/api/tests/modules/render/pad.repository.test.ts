// Where and when a pad may be hit are two columns the console writes and every writer of a break
// will read, so what these pin is the SQL the write compiles to, against Postgres's own compiler and
// the app's own plugins, and what a read makes of a row — including a row nothing in the station wrote.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { PAD_PLACEMENTS, PadRepository, isPadPlacement } from '../../../src/modules/render/pad.repository.js';
import type { DB } from '../../../src/modules/data/db.js';
import type { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const identity = (): StationIdentity => ({ stationKey: 'a-station', current: () => undefined }) as unknown as StationIdentity;

interface Statement {
    sql: string;
    parameters: readonly unknown[];
}

/** A database that compiles every statement for real, keeps them, and answers each with what is given. */
function fakeDb(answer: { rows?: unknown[]; numAffectedRows?: bigint }, statements: Statement[]): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });

    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            statements.push({ sql: compiled.sql, parameters: compiled.parameters });
            return { rows: answer.rows ?? [], numAffectedRows: answer.numAffectedRows } as QueryResult<never>;
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

/** A pad row as Postgres would hand it back, snake case and all. */
const padRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'pad-1',
    board: 'rockzo',
    name: 'rimshot',
    label: 'Rimshot',
    audio_checksum: 'abc',
    audio_ext: 'mp3',
    duration_ms: 1944,
    loudness_lufs: null,
    peak_db: null,
    source: 'upload',
    source_path: 'rockzo/rimshot.mp3',
    last_used_at: null,
    state: 'active',
    placements: ['start', 'middle', 'end'],
    cue: null,
    ...overrides,
});

describe('PadRepository.setUse', () => {
    it('stores the placements in break order with duplicates dropped, and the cue trimmed', async () => {
        const statements: Statement[] = [];
        const pads = new PadRepository(fakeDb({ numAffectedRows: 1n }, statements), identity());

        expect(await pads.setUse('pad-1', { placements: ['end', 'middle', 'end'], cue: '  right after a punchline ' })).toBe(true);

        const [update] = statements;
        expect(update!.sql).toMatch(/update "deadair"\."pads" set "placements" = \$1, "cue" = \$2/);
        expect(update!.parameters).toEqual([['middle', 'end'], 'right after a punchline', 'pad-1', 'a-station']);
    });

    it('clears the cue when none is given, and when the one given is blank', async () => {
        for (const cue of [undefined, '   ']) {
            const statements: Statement[] = [];
            const pads = new PadRepository(fakeDb({ numAffectedRows: 1n }, statements), identity());

            await pads.setUse('pad-1', { placements: ['middle'], ...(cue === undefined ? {} : { cue }) });

            expect(statements[0]!.parameters.slice(0, 2)).toEqual([['middle'], null]);
        }
    });

    it('answers false for a pad this station does not hold', async () => {
        const pads = new PadRepository(fakeDb({ numAffectedRows: 0n }, []), identity());

        expect(await pads.setUse('pad-9', { placements: ['end'] })).toBe(false);
    });
});

describe('reading a pad', () => {
    it('carries its placements and its cue', async () => {
        const pads = new PadRepository(fakeDb({ rows: [padRow({ placements: ['middle'], cue: 'right after a punchline' })] }, []), identity());

        const [pad] = await pads.onSet('rockzo');

        expect(pad!.placements).toEqual(['middle']);
        expect(pad!.cue).toBe('right after a punchline');
    });

    it('drops an absent cue rather than passing a null through', async () => {
        const pads = new PadRepository(fakeDb({ rows: [padRow()] }, []), identity());

        const [pad] = await pads.onSet('rockzo');

        expect(pad).not.toHaveProperty('cue');
        expect(pad!.placements).toEqual(['start', 'middle', 'end']);
    });

    // The table refuses both of these. A row written past it — by hand, or by a later migration gone
    // wrong — falls back to what every pad could do before the column existed, rather than becoming a
    // sound that silently can go nowhere.
    it('reads an unreadable list as every placement, and keeps only the words it knows', async () => {
        const unreadable = new PadRepository(fakeDb({ rows: [padRow({ placements: ['sideways'] })] }, []), identity());
        const partly = new PadRepository(fakeDb({ rows: [padRow({ placements: ['end', 'sideways', 'start'] })] }, []), identity());

        expect((await unreadable.onSet('rockzo'))[0]!.placements).toEqual([...PAD_PLACEMENTS]);
        expect((await partly.onSet('rockzo'))[0]!.placements).toEqual(['start', 'end']);
    });
});

describe('isPadPlacement', () => {
    it('knows the three places a sound can fall, and nothing else', () => {
        expect(PAD_PLACEMENTS.every(isPadPlacement)).toBe(true);
        expect(isPadPlacement('sideways')).toBe(false);
        expect(isPadPlacement('End')).toBe(false);
    });
});
