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

    it('leaves the newsreader’s bulletins alone, since a change of host does not change who reads the news', async () => {
        const statements: Statement[] = [];
        await new SegmentRepository(fakeDb([], statements), identity()).recast(['seg-1'], 'persona-1');

        expect(statements[0]?.sql).toMatch(
            /not \("deadair"\."segments"\."kind" in \(\$\d+\) and exists \(select "reader"\."id" from "deadair"\."personas" as "reader" where "reader"\."id" = "deadair"\."segments"\."persona_id" and 'newsreader' = any\("reader"\."kinds"\)\)\)/,
        );
        expect(statements[0]?.parameters).toContain('news');
    });
});

describe('SegmentRepository.reopenForRewrite', () => {
    it('admits a failed row, which no other reopen does, and clears why it failed', async () => {
        const statements: Statement[] = [];
        const reopened = await new SegmentRepository(fakeDb([{ id: 'seg-1', previous: 'failed' }], statements), identity()).reopenForRewrite('seg-1');

        expect(reopened).toBe(true);
        const update = statements[0]!;
        expect(update.sql).toMatch(/"error" = \$\d+/);
        expect(update.parameters).toEqual(expect.arrayContaining(['planned', 'written', 'ready', 'failed']));
        // Never a job's claim: a break being written or spoken right now is not reset under it.
        expect(update.parameters).not.toContain('writing');
        expect(update.parameters).not.toContain('rendering');
    });

    it('answers false when nothing was reopened, which is a break whose job holds it', async () => {
        const reopened = await new SegmentRepository(fakeDb([], []), identity()).reopenForRewrite('seg-1');

        expect(reopened).toBe(false);
    });

    it('leaves a failed row alone on every other reopen', async () => {
        const statements: Statement[] = [];
        await new SegmentRepository(fakeDb([], statements), identity()).reopenSegments(['seg-1'], 'the order moved');

        expect(statements[0]?.parameters).not.toContain('failed');
        expect(statements[0]?.sql).not.toMatch(/"error" = /);
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

// The render sweep's only way to see a break a renderer gave back unspoken. `written` alone would also
// match a break the writer has just finished, so what this pins is that the SQL asks about the row's
// LAST transition, and asks about nothing but rows with words on them.
describe('SegmentRepository.handedBack', () => {
    it('asks for written rows with words whose last transition came out of rendering', async () => {
        const statements: Statement[] = [];
        const ids = await new SegmentRepository(fakeDb([{ id: 'seg-1' }], statements), identity()).handedBack(['seg-1', 'seg-2']);

        expect(ids).toEqual(['seg-1']);
        const [statement] = statements;
        expect(statement?.sql).toMatch(/"s"\."state" = \$\d+/);
        expect(statement?.sql).toContain('"s"."script" is not null');
        expect(statement?.sql).toMatch(
            /\(select "e"\."from_state" from "deadair"\."segment_events" as "e" where "e"\."segment_id" = "s"\."id" order by "e"\."created_at" desc limit \$\d+\) = \$\d+/,
        );
        expect(statement?.parameters).toEqual(expect.arrayContaining(['seg-1', 'seg-2', 'written', 'rendering']));
    });

    it('costs no query when the window holds nothing', async () => {
        const statements: Statement[] = [];

        expect(await new SegmentRepository(fakeDb([], statements), identity()).handedBack([])).toEqual([]);
        expect(statements).toEqual([]);
    });
});

// An episode of somebody else's programme is a segment that airs ONCE, at its show's slot, and is
// placed by the podcasts module. So it must never be drawn off the shelf, and never make `syndicated`
// look like a kind the shelf can fill.
describe('syndicated segments', () => {
    it('are written as their own source, born ready, with the episode in the context', async () => {
        const statements: Statement[] = [];
        const repository = new SegmentRepository(
            fakeDb([claimedRow({ source: 'syndicated', kind: 'syndicated', state: 'ready' })], statements),
            identity(),
        );

        await repository.createSyndicated({
            kind: 'syndicated',
            label: 'The Long Wave: Episode 12',
            audioChecksum: 'a'.repeat(64),
            audioExt: 'mp3',
            durationMs: 3_723_000,
            context: { showTitle: 'The Long Wave', episodeTitle: 'Episode 12' },
        });

        const [insert] = statements;
        expect(insert?.sql).toContain('insert into "deadair"."segments"');
        expect(insert?.sql).not.toContain('on conflict');
        expect(insert?.parameters).toEqual(expect.arrayContaining(['syndicated', 'ready', 'The Long Wave: Episode 12', 3_723_000]));
        expect(insert?.parameters).toContain(JSON.stringify({ showTitle: 'The Long Wave', episodeTitle: 'Episode 12' }));
    });

    it('are kept off the shelf a band draws from', async () => {
        const statements: Statement[] = [];
        const repository = new SegmentRepository(fakeDb([], statements), identity());

        await repository.listReady('syndicated');

        expect(statements[0]?.sql).toContain('"source" != $');
        expect(statements[0]?.parameters).toContain('syndicated');
    });

    it('are not recordings, and neither is anything the station rendered', async () => {
        const statements: Statement[] = [];
        const repository = new SegmentRepository(fakeDb([], statements), identity());

        await repository.listRecordings('jingle');

        expect(statements[0]?.sql).toContain('"source" = $');
        expect(statements[0]?.parameters).toContain('library');
        expect(statements[0]?.parameters).not.toContain('render');
    });

    it('never make a kind look fillable from the shelf', async () => {
        const statements: Statement[] = [];
        const repository = new SegmentRepository(fakeDb([], statements), identity());

        await repository.readyKinds();

        expect(statements[0]?.sql).toContain('"source" != $');
        expect(statements[0]?.parameters).toContain('syndicated');
    });
});

// What the next break is told the station said recently, when no broadcast is on to remember it. An
// operator's own script, typed in through POST /segments, has no writer and was never the station
// choosing a phrase, so it must not count against the writer's openings.
describe('SegmentRepository.recentScripts', () => {
    it('asks only for scripts a writer wrote, of the kind asked for, newest first', async () => {
        const statements: Statement[] = [];
        const scripts = await new SegmentRepository(fakeDb([{ script: 'the newer' }, { script: 'the older' }], statements), identity()).recentScripts(
            'talkbreak',
            5,
        );

        expect(scripts).toEqual(['the newer', 'the older']);
        expect(statements[0]?.sql).toContain('"writer" is not null');
        expect(statements[0]?.sql).toContain('"script" is not null');
        expect(statements[0]?.sql).toMatch(/order by "created_at" desc/);
        expect(statements[0]?.parameters).toContain('talkbreak');
    });

    it('costs no query for an empty window', async () => {
        const statements: Statement[] = [];

        expect(await new SegmentRepository(fakeDb([], statements), identity()).recentScripts('talkbreak', 0)).toEqual([]);
        expect(statements).toEqual([]);
    });
});

// What withholds a character's rack for a few talk breaks after one hit a pad. Counted from the rows,
// so a station restarted every hour does not hit on the first break after each restart, and over one
// kind, so a jingle's sting every time does not keep the talk breaks' board withdrawn forever.
describe('SegmentRepository.padInLastBreaks', () => {
    it('asks only for the last few scripted rows of the kind asked for, newest first', async () => {
        const statements: Statement[] = [];
        await new SegmentRepository(fakeDb([], statements), identity()).padInLastBreaks('talkbreak', 4);

        expect(statements[0]?.sql).toContain('jsonb_array_length(pads) > 0');
        expect(statements[0]?.sql).toContain('"kind" = $');
        expect(statements[0]?.sql).toContain('"script" is not null');
        expect(statements[0]?.sql).toMatch(/order by "created_at" desc limit \$\d+/);
        expect(statements[0]?.parameters).toEqual(expect.arrayContaining(['a-station', 'talkbreak', 4]));
    });

    it('answers no for a fresh station that has never written a break, so its first one is offered the board', async () => {
        expect(await new SegmentRepository(fakeDb([], []), identity()).padInLastBreaks('talkbreak', 4)).toBe(false);
    });

    it('answers no when none of the last few hit one', async () => {
        const rows = [{ hit: false }, { hit: false }, { hit: false }, { hit: false }];
        expect(await new SegmentRepository(fakeDb(rows, []), identity()).padInLastBreaks('talkbreak', 4)).toBe(false);
    });

    it('answers yes from the rows alone, so a repository built fresh after a restart still sees the last hit', async () => {
        // A new instance holds nothing from the last process: what it answers is what the table says.
        const rows = [{ hit: false }, { hit: true }];
        expect(await new SegmentRepository(fakeDb(rows, []), identity()).padInLastBreaks('talkbreak', 4)).toBe(true);
    });

    it('costs no query for an empty window', async () => {
        const statements: Statement[] = [];

        expect(await new SegmentRepository(fakeDb([], statements), identity()).padInLastBreaks('talkbreak', 0)).toBe(false);
        expect(statements).toEqual([]);
    });
});
