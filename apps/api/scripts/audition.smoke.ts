/**
 * A whole audition, against the real database, without a model and without airing anything.
 *
 * ## What this is for
 *
 * The unit tests pin what each piece does with fakes; what they cannot pin is the half that only
 * exists once the SQL is real — the claim that makes a duplicate delivery free, the cursor that
 * makes a run resumable, the cascade, and the promise the whole feature rests on: **an audition
 * writes nothing that could air**. That last one is a claim about tables, and the only way to check
 * a claim about tables is to count rows in them before and after.
 *
 * So this runs a real three-record audition through the real repository and the real job, with the
 * station's own deterministic writer underneath — the floor, which cannot fail — and then asks the
 * database what moved. Six questions, in order:
 *
 *   1. does a run write one break per transition, and finish?
 *   2. does a second delivery of a transition already written do nothing?
 *   3. does `recent` carry this run's own scripts into the next transition?
 *   4. does a cancelled run refuse the job that was already in flight for it?
 *   5. did `segments` or `script_history` gain a single row? (they must not)
 *   6. did the notebook's or the stories' rotation move? (it must not)
 *
 * The MODEL binding is deliberately not wired. It would spend a slot, answer differently every time
 * and need an operator's plugin configured; the floor writer produces a real script from the
 * station's own phrasings, which is all this needs to have something to record. What the model would
 * be asked is the request builder's own tests.
 *
 * ## It cleans up after itself
 *
 * Both runs are deleted at the end, breaks included, through the cascade. It is safe against a
 * development station and pointless against a live one — it writes two rows nobody asked for.
 *
 * Run from `apps/api`, with the dev database up:
 *   node --import @swc-node/register/esm-register ./scripts/audition.smoke.ts
 *
 * It picks up `DATABASE_*` from the environment like every other script here.
 */
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { ConsoleLogger, type Logger } from '@maroonedsoftware/logger';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';

import type { DB } from '../src/modules/data/db.js';
import { settingsConfigSource } from '../src/server/settings.config.source.js';
import { StationIdentity } from '../src/modules/shared/station.identity.js';
import { BreakWriterRegistry } from '../src/modules/director/break.writer.registry.js';
import { TalkBreakWriter } from '../src/modules/director/talk.break.writer.js';
import { PersonaRepository } from '../src/modules/personas/persona.repository.js';
import { PersonaNotesRepository } from '../src/modules/personas/persona.notes.repository.js';
import { PersonaStoriesRepository } from '../src/modules/personas/persona.stories.repository.js';
import { PersonaAuditionRepository } from '../src/modules/personas/persona.audition.repository.js';
import { PersonaAuditionJob } from '../src/modules/personas/persona.audition.job.js';
import type { AuditionRecord } from '../src/modules/personas/persona.audition.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
const loud = new ConsoleLogger();

// The same two-step build `setup.server.ts` does: `deadair.settings` is a LAYER of the config, and
// the station's title — which every break is written under — lives there rather than in the file.
const boot = await new AppConfigBuilder()
    .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
    .addResolver(new AppConfigResolverEnv())
    .buildSnapshot();

const config = (
    await new AppConfigBuilder()
        .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
        .addSource(settingsConfigSource(boot, quiet))
        .addResolver(new AppConfigResolverEnv())
        .buildStore(quiet)
).toLiveConfig();

const pool = new KyselyPool({
    host: config.get('DATABASE_HOST', ''),
    port: config.get('DATABASE_PORT', 55432),
    user: config.get('DATABASE_USER', ''),
    password: config.get('DATABASE_PASSWORD', ''),
    database: config.get('DATABASE_NAME', ''),
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), plugins: [...KyselyDefaultPlugins] });

const station = new StationIdentity();
const personas = new PersonaRepository(db, station);
const notes = new PersonaNotesRepository(db, station);
const stories = new PersonaStoriesRepository(db, station);
const auditions = new PersonaAuditionRepository(db, station);

// The floor alone. It cannot fail, it needs no plugin, and it writes from the station's own
// phrasings — which is everything this script needs and nothing it does not.
const writers = new BreakWriterRegistry([new TalkBreakWriter(config, quiet)], quiet);

/** Every job the chain sends, rather than a broker: the script drives them itself, in order. */
const sent: { auditionId: string; ordinal: number }[] = [];
const jobs = {
    send: async (_name: string, payload: { auditionId: string; ordinal: number }) => {
        sent.push(payload);
    },
} as never;

const job = new PersonaAuditionJob(auditions, personas, notes, stories, writers, jobs, config, { id: 'smoke' } as never, {} as never, quiet);
const runJob = (auditionId: string, ordinal: number) =>
    (job as unknown as { execute: (payload: { auditionId: string; ordinal: number }) => Promise<void> }).execute({ auditionId, ordinal });

/** Three ordinary records with nothing remarkable about them, and no `trackId`: nothing is enriched here. */
const RECORDS: AuditionRecord[] = [
    { pluginId: 'smoke', externalId: 'r1', title: 'Green Onions', artist: 'Booker T. & the M.G.s', year: 1962 },
    { pluginId: 'smoke', externalId: 'r2', title: 'Ain’t No Sunshine', artist: 'Bill Withers', year: 1971 },
    { pluginId: 'smoke', externalId: 'r3', title: 'Move On Up', artist: 'Curtis Mayfield', year: 1970 },
];

/** What the tables that must not move hold right now. */
async function watermarks() {
    const [segments, history, notesUsed, storiesTold] = await Promise.all([
        db
            .selectFrom('deadair.segments')
            .select(({ fn }) => fn.countAll().as('n'))
            .executeTakeFirst(),
        db
            .selectFrom('deadair.scriptHistory')
            .select(({ fn }) => fn.countAll().as('n'))
            .executeTakeFirst(),
        db
            .selectFrom('deadair.personaNotes')
            .select(({ fn }) => fn.count('lastUsedAt').as('n'))
            .executeTakeFirst(),
        db
            .selectFrom('deadair.personaStories')
            .select(({ fn }) => fn.count('lastToldAt').as('n'))
            .executeTakeFirst(),
    ]);

    return {
        segments: Number(segments?.n ?? 0),
        history: Number(history?.n ?? 0),
        notesUsed: Number(notesUsed?.n ?? 0),
        storiesTold: Number(storiesTold?.n ?? 0),
    };
}

let failures = 0;
const check = (ok: boolean, said: string) => {
    loud.info(`${ok ? '  ok  ' : ' FAIL '} ${said}`);
    if (!ok) failures += 1;
};

const host = (await personas.list()).find(persona => persona.kind !== 'caller');
if (host === undefined) {
    loud.error('personas: this station has no host to audition. Seed one and run this again.');
    await db.destroy();
    process.exit(1);
}

loud.info(`auditioning "${host.label}" (${host.key}) over ${RECORDS.length} records`);
const before = await watermarks();

// ── 1. A run writes one break per transition, and finishes ────────────────────────────
const run = await auditions.open({
    personaId: host.id,
    personaKey: host.key,
    sourcePluginId: 'smoke',
    sourcePlaylistId: 'audition.smoke',
    sourceName: 'the smoke script',
    records: RECORDS,
});

check(run.transitions === 2, `three records make ${run.transitions} transitions (expected 2)`);

await runJob(run.id, 0);
await runJob(run.id, 1);

const written = await auditions.breaksOf(run.id);
const settled = await auditions.findById(run.id);

check(written.length === 2, `the run wrote ${written.length} breaks (expected 2)`);
check(settled?.state === 'done', `the run settled as "${settled?.state}" (expected done)`);
check(settled?.cursor === 2, `the cursor stopped at ${settled?.cursor} (expected 2)`);
check(sent.length === 1 && sent[0]?.ordinal === 1, `the chain sent ${sent.length} job(s), the last for transition ${sent.at(-1)?.ordinal}`);

for (const one of written) {
    loud.info(`  [${one.ordinal}] ${one.previous.title} → ${one.next.title}`);
    loud.info(`       ${one.writer ?? 'nothing'}: ${one.script ?? one.reason ?? 'nothing to say'}`);
}

// ── 2. A second delivery of a transition already written does nothing ─────────────────
const beforeReplay = sent.length;
await runJob(run.id, 0);

check((await auditions.breaksOf(run.id)).length === 2, 'a redelivered transition wrote no second break');
check(sent.length === beforeReplay, 'a redelivered transition sent no job');

// ── 3. The next transition is shown what this run already said ────────────────────────
const carried = await auditions.recentScripts(run.id);
check(carried.length === written.filter(one => one.script !== undefined).length, `the run carries ${carried.length} of its own scripts forward`);
check(carried[0] === written.at(-1)?.script, 'the newest script comes first, as `recent` is read');

// ── 4. A cancelled run refuses the job already in flight for it ───────────────────────
const stopped = await auditions.open({
    personaId: host.id,
    personaKey: host.key,
    sourcePluginId: 'smoke',
    sourcePlaylistId: 'audition.smoke.cancelled',
    records: RECORDS,
});
await auditions.cancel(stopped.id);
await runJob(stopped.id, 0);

const afterCancel = await auditions.findById(stopped.id);
check((await auditions.breaksOf(stopped.id)).length === 0, 'a cancelled run wrote nothing when its job arrived');
check(afterCancel?.state === 'cancelled', `a cancelled run stayed "${afterCancel?.state}"`);

// ── 5 and 6. Nothing that could air, and nothing spent ────────────────────────────────
const after = await watermarks();

check(after.segments === before.segments, `segments: ${before.segments} → ${after.segments} (must not move)`);
check(after.history === before.history, `script_history: ${before.history} → ${after.history} (must not move)`);
check(after.notesUsed === before.notesUsed, `notes rested: ${before.notesUsed} → ${after.notesUsed} (must not move)`);
check(after.storiesTold === before.storiesTold, `stories told: ${before.storiesTold} → ${after.storiesTold} (must not move)`);

// The breaks go with the runs, which is the cascade doing what migration 0024 says it does.
await db.deleteFrom('deadair.personaAuditions').where('id', 'in', [run.id, stopped.id]).execute();
const orphans = await db
    .selectFrom('deadair.personaAuditionBreaks')
    .select(({ fn }) => fn.countAll().as('n'))
    .where('auditionId', 'in', [run.id, stopped.id])
    .executeTakeFirst();
check(Number(orphans?.n ?? 0) === 0, 'deleting the runs took their breaks with them');

// Kept out of the `check` list because it is the script's own hygiene rather than the feature's.
await sql`select 1`.execute(db);
await db.destroy();

loud.info(failures === 0 ? 'audition: everything held' : `audition: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
