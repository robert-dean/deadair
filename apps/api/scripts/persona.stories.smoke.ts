/**
 * A character's own history, against the real database.
 *
 * The unit tests mock this repository, so nothing else runs the SQL under it — and every interesting
 * decision in `deadair.persona_stories` is SQL: the least-recently-carried rotation that decides
 * which of a shelf a break actually hears, the counter that changes how a model is asked to tell
 * one, the partial unique index that stops the enrichment pass proposing the same story every night
 * while leaving an operator free to write their own, and the cascade that makes a detail belong to
 * its story rather than outlive it.
 *
 * The first two are now READ off `deadair.persona_tellings` rather than stored beside the story, so
 * what this checks is a pair of correlated subqueries rather than two columns — and with them the
 * distinction those columns could not express: a carry the writer IGNORED spends the story's turn
 * without counting as a telling, so a story the model keeps passing over stops blocking the shelf
 * and the station never claims a listener heard it.
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

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Kysely, sql } from 'kysely';
import { EmptyUpdateRewriteDialect, KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';
import type { Logger } from '@maroonedsoftware/logger';

import type { DB } from '../src/modules/data/db.js';
import { PersonaStoriesRepository } from '../src/modules/personas/persona.stories.repository.js';
import { PersonaTellingRepository } from '../src/modules/personas/persona.telling.repository.js';
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

/** A real segment, so the ledger's reference resolves. See `persona.tellings.smoke.ts`. */
const SEGMENT = '00000000-0000-4000-8000-00000000cafe';

await db
    .transaction()
    .execute(async trx => {
        const stories = new PersonaStoriesRepository(trx, new StationIdentity());
        const tellings = new PersonaTellingRepository(trx, new StationIdentity());

        await sql`insert into deadair.segments (id, label, kind) values (${SEGMENT}::uuid, ${'A smoke break'}, ${'talkbreak'})`.execute(trx);

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
        const firstOffered = await stories.forPrompt(KEY, { now: Date.now(), gapMs: 0 });
        check('a break is handed exactly one story', firstOffered !== undefined, true);
        check(
            'and never a rejected or suggested one',
            firstOffered?.story.title === 'The Barstow lights' || firstOffered?.story.title === 'A night with no provenance',
            true,
        );

        say('');
        say('the rotation');
        // Least recently CARRIED first, `nulls first`, so a story that has never been handed over is
        // ahead of every story that has. What spends a story's turn is a row in the ledger — the two
        // columns that used to hold this are no longer read, and `markTold` no longer writes them.
        await tellings.record({
            personaKey: KEY,
            storyId: firstOffered!.id,
            source: 'break',
            mode: 'offered',
            told: true,
            said: 'And that is what I saw.',
        });
        const secondOffered = await stories.forPrompt(KEY, { now: Date.now(), gapMs: 0 });
        check('recording a telling brings the other story round', secondOffered?.id === firstOffered!.id, false);

        // And a reader that records nothing gets the same answer twice, which is what makes a
        // rehearsal repeatable and what stops a preview spending the next real break's story.
        check('reading without recording changes nothing', (await stories.forPrompt(KEY, { now: Date.now(), gapMs: 0 }))?.id, secondOffered?.id);

        // The counter the prompt reads to ask for a re-telling, derived from the ledger rather than
        // stored: only rows a writer actually read back as TOLD count.
        check('a telling counts', (await stories.find(KEY, firstOffered!.id))?.timesTold, 1);
        check('and the story nobody told is still at nought', (await stories.find(KEY, secondOffered!.id))?.timesTold, 0);

        // A carry the writer IGNORED moves the rotation and does not count as a telling, which is
        // the whole reason the ledger records the two separately: a story the model keeps passing
        // over must stop blocking the shelf, without the station claiming a listener heard it.
        await tellings.record({ personaKey: KEY, storyId: secondOffered!.id, source: 'break', mode: 'offered', told: false });
        check('an ignored carry still spends the turn', (await stories.forPrompt(KEY, { now: Date.now(), gapMs: 0 }))?.id, firstOffered!.id);
        check('but counts as no telling', (await stories.find(KEY, secondOffered!.id))?.timesTold, 0);

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
        const tellable = await stories.forPrompt(KEY, { now: Date.now(), gapMs: 0 });
        check('the shelf is down to the one story', tellable?.id, barstow.id);
        check('and a break is handed only the details somebody kept', tellable?.story.details, ['The truck radio went to static.']);

        // The cap, tested by writing past it: every line of accumulated colour is a line of "never
        // name a record you were not given" further from the end of the turn.
        for (let index = 0; index < PERSONA_STORY_DETAIL_LIMIT + 3; index += 1) {
            await stories.addDetails([{ storyId: barstow.id, detail: `something else numbered ${index}`, state: 'active', origin: 'operator' }]);
        }
        check(
            'a long story is capped at the limit',
            (await stories.forPrompt(KEY, { now: Date.now(), gapMs: 0 }))?.story.details.length,
            PERSONA_STORY_DETAIL_LIMIT,
        );

        say('');
        say('an arc, told a part at a time');
        const arc = await stories.add({
            personaKey: KEY,
            title: 'The letter from the station manager',
            story: 'It started with a letter.',
            kind: 'arc',
            state: 'active',
            origin: 'operator',
        });
        check('a story can say what sort of thing it is', (await stories.find(KEY, arc.id))?.kind, 'arc');
        check('and one that says nothing is an anecdote', (await stories.find(KEY, barstow.id))?.kind, 'anecdote');

        // Gaps are legal and deliberate: inserting a part between two others must not mean
        // renumbering the rest, and a pass proposing one for the end must not have to know the end.
        await stories.addBeat({ storyId: arc.id, ordinal: 10, beat: 'You opened it in the car park.', state: 'active', origin: 'operator' });
        await stories.addBeat({ storyId: arc.id, ordinal: 30, beat: 'You never did reply.', state: 'active', origin: 'operator' });
        await stories.addBeat({ storyId: arc.id, ordinal: 20, beat: 'You read it twice.', state: 'suggested', origin: 'model' });

        const parts = (await stories.find(KEY, arc.id))?.beats ?? [];
        check(
            'the parts come back in telling order, gaps and all',
            parts.map(beat => beat.ordinal),
            [10, 20, 30],
        );
        check('and a proposed one is waiting rather than tellable', parts[1]?.state, 'suggested');

        check(
            'the same part cannot be written twice under two numbers',
            await stories.addBeats([{ storyId: arc.id, ordinal: 40, beat: '  you READ it twice. ', state: 'active', origin: 'model' }]),
            0,
        );
        check(
            'nor can two parts claim one place in the order',
            await stories.addBeats([{ storyId: arc.id, ordinal: 10, beat: 'Something else entirely.', state: 'active', origin: 'model' }]),
            0,
        );

        // The partial half, as everywhere else here: turning a proposal down must not stand between
        // an operator and their own version of the same part.
        await stories.setBeatState(parts[1]!.id, 'rejected');
        check(
            'a rejected part does not block the operator writing that part themselves',
            await stories.addBeats([{ storyId: arc.id, ordinal: 20, beat: 'You read it twice.', state: 'active', origin: 'operator' }]),
            1,
        );

        say('');
        say('an arc actually advancing');
        // Everything else on this shelf is rejected by now, so the arc is what `forPrompt` reaches.
        for (const held of await stories.list(KEY)) {
            if (held.id !== arc.id && held.state === 'active') await stories.setState(held.id, 'rejected');
        }

        const gapMs = 40 * 60_000;
        const now = Date.now();

        const first = await stories.forPrompt(KEY, { now, gapMs });
        check('an arc is handed its first part', first?.story.beat?.text, 'You opened it in the car park.');
        check('and is told where the story stands', first?.story.beat?.leftAt, undefined);
        check('and that this is not the end of it', first?.story.beat?.last, false);

        // Written but NOT aired, which is the state a break sits in for up to eight items.
        await tellings.replaceForSegment(SEGMENT, {
            personaKey: KEY,
            storyId: arc.id,
            beatId: first!.beatId!,
            source: 'break',
            mode: 'offered',
            told: true,
            said: 'So there was this letter.',
        });

        // The double-booking case, and the whole reason the gap exists: a second break written
        // before the first has aired must not be handed part two.
        check('a second break inside the gap is handed nothing at all', await stories.forPrompt(KEY, { now, gapMs }), undefined);

        // Past the gap and still unaired: the telling is VOID and the part is owed again, so a
        // dropped break gives its part back rather than stalling the arc forever.
        const later = await stories.forPrompt(KEY, { now: now + gapMs + 1, gapMs });
        check('an unaired telling gives its part back once the gap has passed', later?.story.beat?.text, 'You opened it in the car park.');

        await tellings.markAired(SEGMENT, now);
        const second = await stories.forPrompt(KEY, { now: now + gapMs + 1, gapMs });
        check('once it has aired the next part is owed', second?.story.beat?.text, 'You read it twice.');
        check('and it carries what the last part said', second?.story.beat?.leftAt, 'You opened it in the car park.');

        say('');
        say('a running bit, and where it has got to');
        const bit = await stories.add({
            personaKey: KEY,
            title: 'The vending machine',
            story: 'The machine on the third floor has been broken since you started.',
            kind: 'bit',
            state: 'active',
            origin: 'operator',
        });

        // Three aired tellings, which is what makes one worth summarising at all.
        for (const said of ['Still nobody has fixed it.', 'Week three.', 'I have started bringing my own crisps.']) {
            const segment = randomUUID();
            await sql`insert into deadair.segments (id, label, kind) values (${segment}::uuid, ${'A smoke break'}, ${'talkbreak'})`.execute(trx);
            await tellings.replaceForSegment(segment, { personaKey: KEY, storyId: bit.id, source: 'break', mode: 'offered', told: true, said });
            await tellings.markAired(segment, Date.now());
        }

        const worth = await stories.recappable(KEY, 3);
        check('a bit with enough history is offered for summarising', worth.length, 1);
        check('with the whole run rather than the last couple', worth[0]?.said.length, 3);
        check('a bit one telling short is not', (await stories.recappable(KEY, 4)).length, 0);

        await stories.addRecap(bit.id, 'It has become a running feud with the machine.', 3);
        // The question is whether the character has MOVED it, not how long ago: nothing new has been
        // told, so there is nothing to summarise again.
        check('a bit nothing has been done with since is not summarised again', (await stories.recappable(KEY, 3)).length, 0);

        // And the prompt takes the summary INSTEAD of the words, which is the whole value of it: a
        // model cannot reproduce sentences it was never shown.
        for (const held of await stories.list(KEY)) {
            if (held.id !== bit.id && held.state === 'active') await stories.setState(held.id, 'rejected');
        }
        const offered = await stories.forPrompt(KEY, { now: Date.now() + 60 * 60_000, gapMs: 0 });
        check('a break is handed the recap', offered?.story.recap, 'It has become a running feud with the machine.');
        // `said` still travels, because it is what the verbatim guard is built from.
        check('and the words still travel for the guard', (offered?.story.said ?? []).length > 0, true);

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
