/**
 * The ledger of what a character has actually told, against the real database.
 *
 * The unit tests compile this repository's SQL and answer it with rows somebody chose, so nothing
 * else runs it against Postgres — and the decisions worth checking here are all decisions Postgres
 * makes:
 *
 *   * the unique index on `segment_id`, which is what makes a rewritten break one telling rather
 *     than a second one;
 *   * the evidence constraint, which says a break that told a story has to have kept the words;
 *   * `coalesce` on the aired mark, so a segment re-aired by hand has not stopped having been heard;
 *   * the cascade, so a telling of a story that is gone does not outlive it;
 *   * and the one this whole feature's rollback rests on: **a timestamp read back as the column's
 *     own text compares correctly against its own row.** Luxon is millisecond-resolution and
 *     Postgres is microsecond, so a `DateTime` round trip truncates and the value reads as EARLIER
 *     than the row it came from. That is the bug `persona_note_passes.read_through` was carried as
 *     text to avoid, and here it would delete the row an operator clicked on.
 *
 * Everything it writes is in a transaction that is thrown away, so it leaves nothing behind on a
 * station that is running. It is safe against the live database, including on air.
 *
 * Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/persona.tellings.smoke.ts
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
    // See the note in `persona.stories.smoke.ts`: without these a timestamptz comes back as a string
    // and half of what is checked below would be comparing something the app never sees.
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

/** A key nothing else can be using, so a failure here is about this script rather than about the station. */
const KEY = 'smoke-ledger';

/**
 * A real segment, written below inside the same throwaway transaction.
 *
 * `on delete set null` governs what happens when the segment GOES, and says nothing about writing a
 * telling for one that was never there: the reference still has to resolve, so this script plants a
 * row rather than inventing an id. Which is itself worth knowing, because it is what guarantees the
 * ledger cannot accumulate tellings for breaks the station never planned.
 */
const SEGMENT = '00000000-0000-4000-8000-00000000beef';

await db
    .transaction()
    .execute(async trx => {
        const stories = new PersonaStoriesRepository(trx, new StationIdentity());
        const tellings = new PersonaTellingRepository(trx, new StationIdentity());

        const barstow = await stories.add({
            personaKey: KEY,
            title: 'The Barstow lights',
            story: 'You saw three lights over the desert.',
            state: 'active',
            origin: 'operator',
        });

        await sql`insert into deadair.segments (id, label, kind) values (${SEGMENT}::uuid, ${'A smoke break'}, ${'talkbreak'})`.execute(trx);

        say('one row per segment');
        await tellings.replaceForSegment(SEGMENT, {
            personaKey: KEY,
            storyId: barstow.id,
            source: 'break',
            mode: 'offered',
            told: true,
            said: 'The first attempt at saying it.',
        });
        await tellings.replaceForSegment(SEGMENT, {
            personaKey: KEY,
            storyId: barstow.id,
            source: 'break',
            mode: 'offered',
            told: true,
            said: 'The rewrite, which is what actually goes out.',
        });

        const afterRewrite = await tellings.timeline(KEY);
        // Segments are reopened and rewritten constantly, and every rewrite of one break is still
        // one thing a listener hears. Without the unique index this is where a story quietly counts
        // twice for one airing.
        check('a rewritten break is one telling, not two', afterRewrite.length, 1);
        check('and the ledger holds what actually went out', afterRewrite[0]?.said, 'The rewrite, which is what actually goes out.');

        // The case an upsert cannot express: rewritten into a break that carries no story at all.
        await tellings.replaceForSegment(SEGMENT, undefined);
        check('a rewrite that dropped the story leaves no row behind', (await tellings.timeline(KEY)).length, 0);

        say('');
        say('what the store will accept');
        // Behind an explicit SAVEPOINT, as `persona.notes.smoke.ts` takes its own expected failure
        // and for the reason written out there: a constraint violation poisons the whole
        // transaction, so an expected failure taken bare aborts every check after it and reports
        // the constraint as broken everywhere at once.
        await sql`savepoint unsaid`.execute(trx);
        let refused = false;
        try {
            await tellings.record({ personaKey: KEY, storyId: barstow.id, source: 'break', mode: 'told', told: true });
        } catch {
            refused = true;
        }
        await sql`rollback to savepoint unsaid`.execute(trx);
        // A telling that went out in a break has to carry what it said, or the callback it exists to
        // feed has nothing to show.
        check('a break that told a story must keep the words', refused, true);

        // The two that are excused, and for different reasons: a production stores its script
        // elsewhere, and a backfilled row is reconstructing something whose words are long gone.
        await tellings.record({ personaKey: KEY, storyId: barstow.id, source: 'production', mode: 'told', told: true });
        check('a production turn is excused, because its script lives elsewhere', (await tellings.timeline(KEY)).length, 1);

        say('');
        say('the timestamps, which is what a rollback is chosen against');
        const written = await tellings.timeline(KEY);
        const at = written[0]!.at;
        // The whole point. `created_at > at` must exclude the row `at` came from — if the value had
        // been truncated to milliseconds on the way out, it would compare as earlier than its own
        // row and "roll back to here" would delete the thing an operator clicked on.
        const after = await sql<{
            count: string;
        }>`select count(*)::text as count from deadair.persona_tellings where persona_key = ${KEY} and created_at > ${at}::timestamptz`.execute(trx);
        check('a row is not after itself', after.rows[0]?.count, '0');

        const including = await sql<{
            count: string;
        }>`select count(*)::text as count from deadair.persona_tellings where persona_key = ${KEY} and created_at >= ${at}::timestamptz`.execute(trx);
        check('and it is found by a read that includes it, so the value is the row and not a rounding of it', including.rows[0]?.count, '1');

        say('');
        say('the aired mark');
        await tellings.replaceForSegment(SEGMENT, {
            personaKey: KEY,
            storyId: barstow.id,
            source: 'break',
            mode: 'told',
            told: true,
            said: 'What the listener heard.',
        });
        await tellings.markAired(SEGMENT, Date.UTC(2026, 4, 12, 14, 30));
        const first = (await tellings.timeline(KEY)).find(row => row.segmentId === SEGMENT)?.airedAt;
        check('airing stamps the row', first !== undefined, true);

        await tellings.markAired(SEGMENT, Date.UTC(2026, 4, 12, 18, 45));
        const again = (await tellings.timeline(KEY)).find(row => row.segmentId === SEGMENT)?.airedAt;
        // A segment re-aired by hand has not stopped having been heard the first time, and for an
        // arc this column is the station's place in the story.
        check('a second airing does not move the first', again, first);

        // One statement matching nothing is cheaper than asking first whether this segment carried
        // anything at all, which is the posture the aired edge already takes for programmes. Note
        // this id does NOT have to be a real segment: an update matching no row is not a reference.
        await tellings.markAired('00000000-0000-4000-8000-0000000000aa', Date.now());
        check('marking a segment that carried nothing is harmless', process.exitCode !== 1, true);

        say('');
        say('what a later break is shown');
        const heard = await tellings.lastFor(barstow.id);
        check('only what a listener actually heard', heard.length, 1);
        check('and it is the aired one', heard[0]?.said, 'What the listener heard.');

        say('');
        say('the cascade');
        await stories.remove(barstow.id);
        const orphans = await sql<{
            count: string;
        }>`select count(*)::text as count from deadair.persona_tellings where story_id = ${barstow.id}::uuid`.execute(trx);
        // As `persona_story_details` is, and for the same reason: a telling of a story that is gone
        // is a row nothing can place.
        check('deleting a story takes its tellings with it', orphans.rows[0]?.count, '0');

        say('');
        say('what another station holds');
        const elsewhere = new PersonaTellingRepository(trx, { stationKey: 'somewhere-else' } as unknown as StationIdentity);
        check('a ledger is per station', (await elsewhere.timeline(KEY)).length, 0);

        throw new Rollback();
    })
    .catch(error => {
        if (!(error instanceof Rollback)) throw error;
    });

await db.destroy();
say('');
say(process.exitCode === 1 ? 'something above is wrong' : 'the ledger behaves');
