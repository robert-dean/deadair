/**
 * A character's own history, against the real database.
 *
 * The unit tests mock this repository, so nothing else runs the SQL under it — and every interesting
 * decision in `deadair.persona_stories` is SQL: the least-recently-told rotation that decides which
 * of a shelf a break actually hears, the counter that changes how a model is asked to tell one, the
 * partial unique index that stops the enrichment pass proposing the same story every night while
 * leaving an operator free to write their own, and the cascade that makes a detail belong to its
 * story rather than outlive it.
 *
 * It also covers the one thing this store must NOT have borrowed from `deadair.facts`: there is no
 * evidence constraint here, because a story is fiction about a character rather than a claim about
 * the world. A model story with no source is legal and must stay legal — what keeps it safe is that
 * it arrives `suggested`.
 *
 * Everything it writes is in a transaction that is thrown away, so it leaves nothing behind on a
 * station that is running. It is safe against the live database, including on air.
 *
 * Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/persona.stories.smoke.ts
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
import { PERSONA_STORY_DETAIL_LIMIT } from '../src/modules/personas/persona.story.js';
import { StationIdentity } from '../src/modules/shared/station.identity.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const pool = new KyselyPool({
    host: env('DATABASE_HOST', 'localhost'),
    port: Number(env('DATABASE_PORT', '55432')),
    user: env('DATABASE_USER', 'postgres'),
    password: env('DATABASE_PASSWORD', 'postgres'),
    database: env('DATABASE_NAME', 'deadair'),
    // See the note in `rating.smoke.ts`: without these a timestamptz comes back as a string and the
    // rotation below would be comparing something the app never sees.
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
const KEY = 'smoke-shelf';

await db
    .transaction()
    .execute(async trx => {
        const stories = new PersonaStoriesRepository(trx, new StationIdentity());

        say('what the store will accept');
        // Deliberately NOT `facts`' posture, and this is the check that says so. A claim about the
        // world with no source must not be expressible; a story is the character's own and there is
        // nothing to source it to, so a model one with no `source` is a legal row. What makes it
        // safe is the state it arrives in, which is the next check.
        const unsourced = await stories.add({
            personaKey: KEY,
            title: 'A night with no provenance',
            story: 'Something happened.',
            state: 'suggested',
            origin: 'model',
        });
        check('a model story needs no source, because there is nothing to source it to', unsourced.origin, 'model');
        check('and it arrives waiting for somebody', unsourced.state, 'suggested');

        say('');
        say('the partial unique index');
        check(
            'a second story under the same handle is dropped rather than duplicated',
            await stories.addAll([
                { personaKey: KEY, title: '  a night WITH no provenance ', story: 'A different telling.', state: 'active', origin: 'model' },
            ]),
            0,
        );

        // The partial half: turning a proposal down must not stand between an operator and their own
        // story about the same night.
        await stories.setState(unsourced.id, 'rejected');
        check(
            'a rejected story does not block the same handle being written again',
            await stories.addAll([
                { personaKey: KEY, title: 'A night with no provenance', story: 'The operator’s own version.', state: 'active', origin: 'operator' },
            ]),
            1,
        );
        check(
            'and `holds` still sees the rejected one, which is what stops the pass re-proposing it',
            await stories.holds(KEY, 'A night with no provenance'),
            true,
        );

        say('');
        say('what a break is actually handed');
        // Only `active`, and only ONE. A proposal must never reach the air: the whole reason a
        // model's story arrives suggested is that nothing verified it, because nothing could.
        const barstow = await stories.add({
            personaKey: KEY,
            title: 'The Barstow lights',
            story: 'You saw three lights over the desert.',
            state: 'active',
            origin: 'operator',
        });
        const first = await stories.forPrompt(KEY);
        check('a break is handed exactly one story', first !== undefined, true);
        check(
            'and never a rejected or suggested one',
            first?.story.title === 'The Barstow lights' || first?.story.title === 'A night with no provenance',
            true,
        );

        say('');
        say('the rotation');
        // Least recently told first, `nulls first`, so a story that has never gone out is ahead of
        // every story that has. Rest what was chosen and the other one has to come round, or a
        // character tells the same anecdote until somebody deletes it.
        await stories.markTold(first!.id);
        const second = await stories.forPrompt(KEY);
        check('resting the one that was told brings the other round', second?.id === first!.id, false);

        // And a reader that does NOT rest gets the same answer twice, which is what makes a
        // rehearsal repeatable and what stops a preview spending the next real break's story.
        check('reading without resting changes nothing', (await stories.forPrompt(KEY))?.id, second?.id);

        // The counter is what the prompt reads to ask for a story to be told differently the second
        // time round. It has to move with the stamp rather than beside it.
        check('telling one counts it', (await stories.find(KEY, first!.id))?.timesTold, 1);
        check('and leaves the one nobody has told alone', (await stories.find(KEY, second!.id))?.timesTold, 0);

        // **`now()` is the TRANSACTION's clock**, so every stamp taken inside this script is the same
        // instant and the rotation stops moving once both stories carry one — the order then falls
        // through to `created_at` forever. That is an artefact of running the whole thing in one
        // transaction rather than anything the station does: `markTold` is one statement per break
        // out there, minutes apart. Everything below therefore leaves exactly one story tellable
        // rather than asking the rotation to pick a particular one. Named explicitly rather than as
        // "the other one", because which of the two came round first is exactly what this paragraph
        // says cannot be relied on in here.
        for (const held of await stories.list(KEY)) {
            if (held.id !== barstow.id) await stories.setState(held.id, 'rejected');
        }

        say('');
        say('a story that grows');
        await stories.addDetail({ storyId: barstow.id, detail: 'The truck radio went to static.', state: 'active', origin: 'operator' });
        const proposed = await stories.addDetails([
            { storyId: barstow.id, detail: 'The dogs would not go out.', state: 'suggested', origin: 'model', source: 'nothing at all' },
        ]);
        check('a proposed detail is written', proposed, 1);
        check(
            'and dropped rather than duplicated',
            await stories.addDetails([{ storyId: barstow.id, detail: '  the DOGS would not go out.  ', state: 'active', origin: 'model' }]),
            0,
        );

        const held = await stories.find(KEY, barstow.id);
        check('the console sees both, in every state', held?.details.length, 2);

        // Only the ACTIVE ones reach a break, for the same reason only active stories do: a detail a
        // model invented is a sentence nobody has approved.
        const tellable = await stories.forPrompt(KEY);
        check('the shelf is down to the one story', tellable?.id, barstow.id);
        check('and a break is handed only the details somebody kept', tellable?.story.details, ['The truck radio went to static.']);

        // The cap, tested by writing past it: every line of accumulated colour is a line of "never
        // name a record you were not given" further from the end of the turn.
        for (let index = 0; index < PERSONA_STORY_DETAIL_LIMIT + 3; index += 1) {
            await stories.addDetails([{ storyId: barstow.id, detail: `something else numbered ${index}`, state: 'active', origin: 'operator' }]);
        }
        check('a long story is capped at the limit', (await stories.forPrompt(KEY))?.story.details.length, PERSONA_STORY_DETAIL_LIMIT);

        say('');
        say('the cascade');
        // Against the habit of every other reference here, and deliberately: a detail whose story is
        // gone is not a smaller story, it is a fragment nothing can render and nobody can place.
        await stories.remove(barstow.id);
        const orphans = await sql<{
            count: string;
        }>`select count(*)::text as count from deadair.persona_story_details where story_id = ${barstow.id}::uuid`.execute(trx);
        check('deleting a story takes its details with it', orphans.rows[0]?.count, '0');

        say('');
        say('what another station holds');
        // Every read here is narrowed by `station_key`, which is the column that makes the second
        // station a row rather than a migration.
        const elsewhere = new PersonaStoriesRepository(trx, { stationKey: 'somewhere-else' } as unknown as StationIdentity);
        check('a shelf is per station', (await elsewhere.list(KEY)).length, 0);

        throw new Rollback();
    })
    .catch(error => {
        if (!(error instanceof Rollback)) throw error;
    });

await db.destroy();
say('');
say(process.exitCode === 1 ? 'something above is wrong' : 'the shelf behaves');
