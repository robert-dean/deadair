/**
 * The four ways a break is repaired, against the real table.
 *
 * `BreakPlanner` decides WHICH breaks need repairing and the unit tests cover that, because it is
 * arithmetic over an order held in memory. What they cannot cover is the half that is SQL, and that
 * is where the interesting failures are: a state guard that lets a row be moved underneath a job
 * that still holds it, a `where` that matches every segment on the station instead of the window,
 * or a transition that lands somewhere `claimForRender` will not take it from.
 *
 * So this drives one throwaway segment through each state and asserts both the row and its
 * `segment_events` trail, which is the thing an operator reads when they ask why a break never
 * aired.
 *
 * Note what it does NOT do: backdate `updated_at` to make a claim look old. It cannot —
 * `deadair.set_updated_at` is a BEFORE UPDATE trigger and overwrites any value handed to it — so
 * the bound is moved instead of the row, which tests exactly the same comparison from the other
 * side.
 *
 * It writes, and cleans up after itself in a `finally`. Everything it creates carries the kind
 * below, so a run killed halfway leaves one obvious row.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/segment.repair.smoke.ts
 */
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';

import type { DB } from '../src/modules/data/db.js';
import { PersonaRepository } from '../src/modules/personas/persona.repository.js';
import { SegmentRepository } from '../src/modules/render/segment.repository.js';
import { StationIdentity } from '../src/modules/shared/station.identity.js';

/** Everything this script makes, so the cleanup is one predicate. */
const KIND = 'smoke.repair';

const config = await new AppConfigBuilder()
    .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
    .addResolver(new AppConfigResolverEnv())
    .buildSnapshot();

const pool = new KyselyPool({
    host: config.get('DATABASE_HOST', ''),
    port: config.get('DATABASE_PORT', 55432),
    user: config.get('DATABASE_USER', ''),
    password: config.get('DATABASE_PASSWORD', ''),
    database: config.get('DATABASE_NAME', ''),
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), plugins: [...KyselyDefaultPlugins] });
const segments = new SegmentRepository(db, new StationIdentity());

let failures = 0;
const check = (ok: boolean, said: string): void => {
    console.log(`  ${ok ? '✓' : '✗'} ${said}`);
    if (!ok) failures += 1;
};

/** A fresh break with words on it, claimed and written the way `WriteBreakJob` does. */
async function written(claimsItemId: string): Promise<string> {
    const planned = await segments.plan({ kind: KIND, label: 'Smoke' });
    await segments.claimForWrite(planned.id);
    await segments.writeScript(planned.id, { script: 'Coming up, something.', label: 'Smoke', writer: 'deterministic', claimsItemId });
    return planned.id;
}

/** The states this row has been through, oldest first. */
const trail = async (id: string): Promise<string[]> => (await segments.events(id)).map(event => `${event.fromState ?? 'new'}→${event.toState}`);

/** A break whose promise broke: back to exactly the state a freshly planted one is in. */
async function reopens(): Promise<void> {
    const id = await written('item-that-moved');

    const reopened = await segments.reopenSegments([id]);
    const row = await segments.findById(id);

    check(reopened.length === 1 && reopened[0] === id, 'reopenSegments answers with the row it reopened');
    check(row?.state === 'planned', `the row is planned again (it is ${row?.state})`);
    check(row?.script === undefined && row?.writer === undefined, 'the words and the writer are cleared, so the next job writes rather than edits');
    check(row?.claimsItemId === undefined, 'the forward claim goes with the words it described');
    check((await trail(id)).includes('written→planned'), 'the trail says it was un-written');
}

/** A break a job is in the middle of. The one thing the repair must never touch. */
async function refusesAClaimedRow(): Promise<void> {
    const id = await written('item-that-moved');
    await segments.claimForRender(id);

    const reopened = await segments.reopenSegments([id]);
    const row = await segments.findById(id);

    check(reopened.length === 0, 'reopenSegments will not touch a row a renderer holds');
    check(row?.state === 'rendering', `the row is still rendering (it is ${row?.state})`);
}

/** A writer that died holding the claim: back to `planned`, because there are no words yet. */
async function releasesAStrandedWrite(): Promise<void> {
    const planned = await segments.plan({ kind: KIND, label: 'Smoke' });
    await segments.claimForWrite(planned.id);

    // The bound is moved rather than the row: "anything claimed before a minute from now".
    const early = await segments.releaseStranded([planned.id], { writing: Date.now() - 60_000, rendering: Date.now() - 60_000 });
    check(early.writing.length === 0, 'a claim younger than the bound is left alone');

    const released = await segments.releaseStranded([planned.id], { writing: Date.now() + 60_000, rendering: Date.now() + 60_000 });
    const row = await segments.findById(planned.id);

    check(released.writing.length === 1, 'releaseStranded hands back a write nobody finished');
    check(row?.state === 'planned', `the row is planned again (it is ${row?.state})`);
    check((await trail(planned.id)).includes('writing→planned'), 'the trail says the claim was given back');
}

/** A renderer that died holding the claim: back to `written`, so the retry re-speaks the same words. */
async function releasesAStrandedRender(): Promise<void> {
    const id = await written('item-1');
    await segments.claimForRender(id);

    const released = await segments.releaseStranded([id], { writing: Date.now() + 60_000, rendering: Date.now() + 60_000 });
    const row = await segments.findById(id);

    check(released.rendering.length === 1, 'releaseStranded hands back a render nobody finished');
    check(row?.state === 'written', `the row is written rather than planned (it is ${row?.state})`);
    check(row?.script !== undefined, 'the words survive, which is the whole reason it stops at written');
    check((await segments.claimForRender(id)) !== undefined, 'and the render job can claim it again');
}

/** A render that failed with the words intact, and one that failed with nothing to say. */
async function findsWhatCanBeSpokenAgain(): Promise<void> {
    const spoken = await written('item-1');
    await segments.claimForRender(spoken);
    await segments.markFailed(spoken, 'render: no active plugin can speak', 'rendering');

    const wordless = await segments.plan({ kind: KIND, label: 'Smoke' });
    await segments.claimForWrite(wordless.id);
    await segments.markFailed(wordless.id, 'nothing wrote this talkbreak', 'writing');

    const found = await segments.failedWithScript([spoken, wordless.id]);

    check(found.length === 1 && found[0]?.id === spoken, 'failedWithScript answers with the break whose words survived');
    check(found[0]?.failures === 1, `and counts what it has been through (it says ${found[0]?.failures})`);
    check(
        !found.some(row => row.id === wordless.id),
        'a break that failed with nothing to say is not offered, because asking again does not change that',
    );

    // A second failure has to move the count, or the cap can never be reached.
    await segments.claimForRender(spoken);
    await segments.markFailed(spoken, 'render: no active plugin can speak', 'rendering');
    check((await segments.failedWithScript([spoken]))[0]?.failures === 2, 'the count follows the row rather than a process');
}

/**
 * The station changed presenter: the outgoing host's breaks are re-opened and nobody else's are.
 *
 * Four rows, because being "out of character" is a property of the ROW rather than of the change,
 * and each of the three exemptions is a different `where`. The voice case is the one worth having a
 * real database for: it is a correlated subquery against `deadair.personas`, so a unit test could
 * only assert that it was asked for.
 */
async function recasts(): Promise<void> {
    const personas = new PersonaRepository(db, new StationIdentity());
    const outgoing = await personas.create({ key: `${KIND}.outgoing`, label: 'Outgoing', style: 'A voice', voice: 'outgoing-voice' });
    const incoming = await personas.create({ key: `${KIND}.incoming`, label: 'Incoming', style: 'Another voice', voice: 'incoming-voice' });

    const theirs = await writtenBy(outgoing.id, outgoing.voice);
    const already = await writtenBy(incoming.id, incoming.voice);
    const nobodys = await written('item-1');
    const operators = await writtenBy(outgoing.id, 'a-voice-the-operator-chose');

    const reopened = await segments.recast([theirs, already, nobodys, operators], incoming.id);
    const row = await segments.findById(theirs);
    // `persona_id` is on the row and not on `Segment`, because nothing reads it back through the
    // repository. It is the whole subject here, so this one asks the table.
    const stamped = async (id: string) =>
        (await db.selectFrom('deadair.segments').select(['personaId', 'voice']).where('id', '=', id).executeTakeFirst())!;

    check(reopened.length === 2, `only the outgoing host's breaks are re-opened (it moved ${reopened.length})`);
    check(!reopened.includes(already), 'a break already in the incoming character is left alone');
    check(!reopened.includes(nobodys), 'a break nobody presented is left alone, because it is in no character to be out of');
    check(row?.state === 'planned' && row?.script === undefined, `the words are gone and it is planned again (it is ${row?.state})`);
    check((await stamped(theirs)).personaId == null, 'the stamped host goes with the words it describes');
    check((await stamped(theirs)).voice == null, 'and the voice goes with it, since it was the outgoing host’s');
    check((await stamped(operators)).voice === 'a-voice-the-operator-chose', 'a voice an operator set by hand survives the recast');
    check((await trail(theirs)).includes('written→planned'), 'the trail says it was un-written');
}

/** The same as {@link written}, under a persona and in a voice, as a break the station planted is. */
async function writtenBy(personaId: string, voice: string | undefined): Promise<string> {
    const planned = await segments.plan({ kind: KIND, label: 'Smoke' });
    await segments.claimForWrite(planned.id);
    await segments.writeScript(planned.id, {
        script: 'In character, at length.',
        label: 'Smoke',
        writer: 'model',
        personaId,
        ...(voice === undefined ? {} : { voice }),
    });
    return planned.id;
}

/** Nothing outside the window the caller named may move. */
async function staysInsideItsWindow(): Promise<void> {
    const mine = await written('item-1');
    const theirs = await written('item-1');

    await segments.reopenSegments([mine]);
    await segments.releaseStranded([mine], { writing: Date.now() + 60_000, rendering: Date.now() + 60_000 });

    const other = await segments.findById(theirs);
    check(other?.state === 'written', `a row nobody named is untouched (it is ${other?.state})`);
}

console.log('segment repair\n');

try {
    await reopens();
    await refusesAClaimedRow();
    await releasesAStrandedWrite();
    await releasesAStrandedRender();
    await findsWhatCanBeSpokenAgain();
    await recasts();
    await staysInsideItsWindow();
} finally {
    const { numDeletedRows } = await db.deleteFrom('deadair.segments').where('kind', '=', KIND).executeTakeFirst();
    // After the segments, because `segments.persona_id` references them: `on delete set null` would
    // otherwise leave the rows above pointing at nothing halfway through the cleanup.
    await db.deleteFrom('deadair.personas').where('key', 'like', `${KIND}.%`).execute();
    console.log(`\n  cleaned up ${numDeletedRows} segment${numDeletedRows === 1n ? '' : 's'}`);
    await db.destroy();
}

console.log(`\n${failures === 0 ? 'ok' : `${failures} failed`}`);
process.exit(failures === 0 ? 0 : 1);
