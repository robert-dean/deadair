/**
 * Rolling a character's accumulated memory back, against the real database.
 *
 * `persona.memory.service.test.ts` mocks all three repositories, so it pins the service's decisions
 * and runs none of the SQL those decisions are made of — and every interesting property of a
 * rollback is a predicate:
 *
 *   * **the boundary itself.** `created_at > to` is exclusive, and `to` is the column's own text, so
 *     rolling back to a row's own moment must KEEP that row and take the one after it. This is the
 *     check the whole feature rests on: had the value gone through a `DateTime` on the way out, it
 *     would compare as earlier than its own row and delete the thing an operator clicked on.
 *   * **whose work is whose.** An operator's stories and notes survive at any depth, including a
 *     reset; only `origin = 'model'` rows go.
 *   * **the detail that has no cascade.** A model detail hung on an OPERATOR's story is exactly the
 *     row that survives if the deletes are done in the wrong order.
 *   * **the watermark goes BACKWARDS**, which `markRead` is built never to do.
 *   * and the rotation columns come back in step with what is left of the ledger.
 *
 * Everything it writes is in a transaction that is thrown away, so it leaves nothing behind on a
 * station that is running. It is safe against the live database, including on air.
 *
 * Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/persona.memory.smoke.ts
 */

/** The database half of `.env`, read by hand: this script wants a pool, not the app's whole config. */
function env(key: string, fallback: string): string {
    if (process.env[key] !== undefined) return process.env[key];
    const line = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
    return line?.[1]?.trim() ?? fallback;
}

import { readFileSync } from 'node:fs';
import { Kysely, sql } from 'kysely';
import { EmptyUpdateRewriteDialect, KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';
import type { Logger } from '@maroonedsoftware/logger';

import type { DB } from '../src/modules/data/db.js';
import { PersonaNotesRepository } from '../src/modules/personas/persona.notes.repository.js';
import { PersonaStoriesRepository } from '../src/modules/personas/persona.stories.repository.js';
import { PersonaTellingRepository } from '../src/modules/personas/persona.telling.repository.js';
import { StationIdentity } from '../src/modules/shared/station.identity.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const pool = new KyselyPool({
    host: env('DATABASE_HOST', 'localhost'),
    port: Number(env('DATABASE_PORT', '55432')),
    user: env('DATABASE_USER', 'postgres'),
    password: env('DATABASE_PASSWORD', 'postgres'),
    database: env('DATABASE_NAME', 'deadair'),
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new EmptyUpdateRewriteDialect({ pool }, quiet), plugins: [...KyselyDefaultPlugins] });

const say = (line: string) => process.stdout.write(`${line}\n`);
const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    say(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) process.exitCode = 1;
};

/** Thrown to unwind the transaction once the checks inside it are done. */
class Rollback extends Error {}

const KEY = 'smoke-memory';

await db
    .transaction()
    .execute(async trx => {
        const stories = new PersonaStoriesRepository(trx, new StationIdentity());
        const notes = new PersonaNotesRepository(trx, new StationIdentity());
        const tellings = new PersonaTellingRepository(trx, new StationIdentity());

        // `now()` is the TRANSACTION's clock, so every row written in here shares one instant and
        // nothing could be "after" anything else. Each row is therefore planted at an explicit
        // moment, which is also closer to what the table actually looks like on a running station.
        const at = (days: number) => sql`now() - (${days} || ' days')::interval`;
        const plant = async (table: 'persona_stories' | 'persona_notes', id: string, days: number) =>
            await sql`update deadair.${sql.raw(table)} set created_at = ${at(days)} where id = ${id}::uuid`.execute(trx);

        say('a shelf with some history on it');
        const mine = await stories.add({
            personaKey: KEY,
            title: 'A story the operator wrote',
            story: 'You wrote this one yourself.',
            state: 'active',
            origin: 'operator',
        });
        await plant('persona_stories', mine.id, 10);

        const theirs = await stories.add({
            personaKey: KEY,
            title: 'A story the station proposed',
            story: 'The station thought of this one.',
            state: 'suggested',
            origin: 'model',
        });
        await plant('persona_stories', theirs.id, 2);

        // The row with no cascade to take it: a model's detail hung on the OPERATOR's story.
        await stories.addDetail({ storyId: mine.id, detail: 'A clause the station invented.', state: 'suggested', origin: 'model' });
        await sql`update deadair.persona_story_details set created_at = ${at(2)} where story_id = ${mine.id}::uuid`.execute(trx);

        const mineNote = await notes.add({ personaKey: KEY, kind: 'trait', note: 'A note the operator wrote', state: 'active', origin: 'operator' });
        await plant('persona_notes', mineNote.id, 10);

        const theirNote = await notes.add({
            personaKey: KEY,
            kind: 'said',
            note: 'A note the pass distilled',
            state: 'active',
            origin: 'model',
            sourceQuote: 'what was said',
        });
        await plant('persona_notes', theirNote.id, 2);

        // Two tellings, one either side of the line the rollback will be drawn on.
        await tellings.record({ personaKey: KEY, storyId: mine.id, source: 'production', mode: 'told', told: true });
        await sql`update deadair.persona_tellings set created_at = ${at(5)} where persona_key = ${KEY}`.execute(trx);
        await tellings.record({ personaKey: KEY, storyId: mine.id, source: 'production', mode: 'told', told: true });
        await sql`update deadair.persona_tellings set created_at = ${at(1)} where persona_key = ${KEY} and created_at > ${at(3)}`.execute(trx);

        const timeline = await tellings.timeline(KEY);
        check('both tellings are on the timeline', timeline.length, 2);

        // The older of the two, which is the row an operator would click "roll back to here" on.
        const older = timeline[1]!;

        say('');
        say('the boundary');
        const planned = await tellings.countAfter(KEY, older.at);
        // Exclusive, and exact. If `older.at` had been rounded anywhere on its way out here, this
        // would be 2 and the row an operator picked would be the first thing deleted.
        check('rolling back to a row counts what came after it and not the row itself', planned, 1);

        say('');
        say('what a rollback takes, and what it leaves');
        await tellings.removeAfter(KEY, older.at);
        check('the later telling is gone', (await tellings.timeline(KEY)).length, 1);
        check('and the one at the boundary is still there', (await tellings.timeline(KEY))[0]?.id, older.id);

        const noteCounts = await notes.countAfter(KEY, older.at);
        check('only the model note is counted', noteCounts.notes, 1);
        await notes.rollbackAfter(KEY, older.at);
        const heldNotes = await notes.list(KEY);
        check('the operator keeps their own note', heldNotes.length, 1);
        check('and it is theirs', heldNotes[0]?.origin, 'operator');

        const storyCounts = await stories.countAfter(KEY, older.at);
        check('the proposed story is counted', storyCounts.stories, 1);
        // The row with no cascade to take it, which is why the deletes are ordered the way they are.
        check('and so is the model detail on the operator’s own story', storyCounts.details, 1);

        await stories.rollbackAfter(KEY, older.at);
        const heldStories = await stories.list(KEY);
        check('the operator keeps their own story', heldStories.length, 1);
        check('and it is theirs', heldStories[0]?.origin, 'operator');
        check('the invented clause is off it', heldStories[0]?.details.length, 0);

        say('');
        say('the rotation, which needs no putting back');
        // Nothing was called between the delete and this read. The count and the stamp are READ off
        // the ledger rather than stored beside the story, so cutting the ledger down is the whole of
        // undoing them — which is most of why the ledger is worth having, and the property that
        // would break silently if either of them ever became a column again.
        const after = await stories.find(KEY, mine.id);
        check('the counter follows what is left of the ledger', after?.timesTold, 1);
        check('and so does the stamp', after?.lastToldAt !== undefined, true);

        say('');
        say('the watermark');
        await notes.markRead(KEY, undefined);
        await sql`update deadair.persona_note_passes set read_through = ${at(1)} where persona_key = ${KEY}`.execute(trx);
        const before = await notes.readThrough(KEY);
        await notes.pullReadThrough(KEY, older.at);
        const pulled = await notes.readThrough(KEY);
        // `markRead` is `greatest(...)` and cannot go backwards, which is right for two passes racing
        // and wrong for an operator who has just deleted what a pass concluded.
        check('it moves backwards, which the pass’s own writer cannot do', pulled !== before, true);

        // And never forwards: rolling back to a moment the pass had not reached yet must not skip
        // scripts nothing has read.
        await notes.pullReadThrough(KEY, `${new Date().toISOString()}`);
        check('but never forwards', await notes.readThrough(KEY), pulled);

        say('');
        say('a reset');
        // The same path with no moment given, which is what `-infinity` is for: one code path rather
        // than a second operation to keep in step.
        check('everything left is counted', await tellings.countAfter(KEY, '-infinity'), 1);
        await tellings.removeAfter(KEY, '-infinity');
        await notes.rollbackAfter(KEY, '-infinity');
        await stories.rollbackAfter(KEY, '-infinity');
        check('the ledger is empty', (await tellings.timeline(KEY)).length, 0);
        // The whole point of the feature, at its most destructive setting.
        check('and the operator still has everything they wrote', (await stories.list(KEY)).length, 1);
        check('including their notebook', (await notes.list(KEY)).length, 1);

        throw new Rollback();
    })
    .catch(error => {
        if (!(error instanceof Rollback)) throw error;
    });

await db.destroy();
say('');
say(process.exitCode === 1 ? 'something above is wrong' : 'a character can be put back');
