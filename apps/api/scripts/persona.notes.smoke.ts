/**
 * The notebook, against the real database.
 *
 * The unit tests mock this repository, so nothing else runs the SQL under it — and every interesting
 * decision in `deadair.persona_notes` is SQL: the constraint that makes an unsourced model note
 * inexpressible, the partial unique index that stops the distil pass writing the same line every
 * night while leaving an operator free to write their own, and the least-recently-used rotation that
 * decides which of a long notebook a break actually hears.
 *
 * Everything it writes is in a transaction that is thrown away, so it leaves no note behind on a
 * station that is running. It is safe against the live database, including on air.
 *
 * Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/persona.notes.smoke.ts
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
import { PERSONA_NOTE_LIMITS } from '../src/modules/personas/persona.note.js';
import { ScriptHistoryRepository } from '../src/modules/render/script.history.repository.js';
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
const KEY = 'smoke-notebook';

await db
    .transaction()
    .execute(async trx => {
        const notes = new PersonaNotesRepository(trx, new StationIdentity());

        say('the evidence constraint');
        // A claim the station will say out loud, with no source, must not be expressible. This is
        // `facts.source_quote` one table over, and it is a constraint rather than a check in the
        // service because the distil pass is not the only thing that will ever write here.
        //
        // Behind an explicit SAVEPOINT, which is not a detail: a constraint violation poisons the
        // whole transaction, so an expected failure taken bare would abort every check after it with
        // `current transaction is aborted` and report the constraint as broken in seven places.
        await sql`savepoint unsourced`.execute(trx);
        let refused = false;
        try {
            await notes.add({ personaKey: KEY, kind: 'said', note: 'said something unsourceable', state: 'active', origin: 'model' });
        } catch {
            refused = true;
        }
        await sql`rollback to savepoint unsourced`.execute(trx);
        check('the database refuses a model note with no quote', refused, true);
        check(
            'and takes the same note with one',
            (
                await notes.add({
                    personaKey: KEY,
                    kind: 'said',
                    note: 'called Booker T. the tightest band alive',
                    state: 'active',
                    origin: 'model',
                    sourceQuote: 'Booker T. and the boys, tightest band alive.',
                })
            ).origin,
            'model',
        );
        check('while an operator needs none', (await notes.add({ personaKey: KEY, kind: 'trait', note: 'calls the listener a shipmate', state: 'active', origin: 'operator' })).origin, 'operator');

        say('');
        say('the partial unique index');
        // What stops the pass writing the same line every night. `addAll` leans on it rather than
        // reading first, because an operator's own note can land in the same moment.
        check(
            'a second note in the same words is dropped rather than duplicated',
            await notes.addAll([{ personaKey: KEY, kind: 'trait', note: 'CALLS the listener a Shipmate  ', state: 'active', origin: 'operator' }]),
            0,
        );

        // And the partial half: turning a proposal down must not stand between an operator and their
        // own note saying the same thing. Reject the row, then write it again by hand.
        const rejected = await notes.add({
            personaKey: KEY,
            kind: 'trait',
            note: 'keeps coming back to Detroit records',
            state: 'suggested',
            origin: 'model',
            sourceQuote: 'Another one out of Detroit, because of course.',
        });
        await notes.setState(rejected.id, 'rejected');
        check(
            'a rejected note does not block the same words being written again',
            await notes.addAll([{ personaKey: KEY, kind: 'trait', note: 'keeps coming back to Detroit records', state: 'active', origin: 'operator' }]),
            1,
        );
        check('and `holds` still sees the rejected one, which is what stops a pass re-proposing it', await notes.holds(KEY, 'keeps coming back to Detroit records'), true);

        say('');
        say('what a break is actually handed');
        // Only `active` rows, capped per kind, and rotated. A suggestion must never reach the air:
        // the whole reason `trait` notes arrive proposed is that nothing verified them.
        await notes.add({ personaKey: KEY, kind: 'said', note: 'a proposal nobody has looked at', state: 'suggested', origin: 'model', sourceQuote: 'x' });
        const chosen = await notes.forPrompt(KEY);
        check('a suggestion is not carried into a break', chosen.notes.said.includes('a proposal nobody has looked at'), false);
        check('the two kinds come back separately', chosen.notes.trait.length >= 1 && chosen.notes.said.length >= 1, true);

        // The cap, tested by writing past it. `trait` is the tighter of the two, so it is the one
        // that fails first if the limit ever stops reaching the query.
        for (let index = 0; index < PERSONA_NOTE_LIMITS.trait + 3; index += 1) {
            await notes.addAll([{ personaKey: KEY, kind: 'trait', note: `a trait numbered ${index}`, state: 'active', origin: 'operator' }]);
        }
        const capped = await notes.forPrompt(KEY);
        check('a long notebook is capped at the limit', capped.notes.trait.length, PERSONA_NOTE_LIMITS.trait);

        // The rotation. Rest what was just chosen and ask again: a notebook longer than its cap has
        // to come round, or a character says the same four things until somebody edits it.
        await notes.markUsed(capped.ids);
        const next = await notes.forPrompt(KEY);
        const overlap = next.notes.trait.filter(note => capped.notes.trait.includes(note));
        check('resting what was used brings the rest round', overlap.length, 0);

        // And a reader that does NOT rest gets the same answer twice, which is what makes a rehearsal
        // repeatable and what stops a preview spending the next real break's lines.
        check('reading without resting changes nothing', (await notes.forPrompt(KEY)).notes.trait, next.notes.trait);

        say('');
        say('the window the distil pass reads');
        // Raw SQL with an optional fragment in the middle of it, which no unit test touches: the
        // per-segment dedup, the exclusive watermark, and the oldest-first order the model needs to
        // see a habit developing rather than a list read backwards.
        const scripts = new ScriptHistoryRepository(trx, new StationIdentity());

        // Two attempts at one break — a model that declined and the floor that covered for it — plus
        // a second break. Told about the first twice, a pass notes the repetition as a habit.
        const segment = '00000000-0000-4000-8000-00000000beef';
        await sql`
            insert into deadair.segments (id, kind, state, station_key, label)
            values (${segment}::uuid, 'talkbreak', 'ready', 'main', 'a smoke break')
            on conflict do nothing
        `.execute(trx);
        await sql`
            insert into deadair.script_history (station_key, persona_key, segment_id, kind, writer, outcome, script, created_at) values
                ('main', ${KEY}, ${segment}::uuid, 'talkbreak', 'model', 'declined', null, now() - interval '3 hours'),
                ('main', ${KEY}, ${segment}::uuid, 'talkbreak', 'deterministic', 'written', 'the floor covered for it', now() - interval '3 hours'),
                ('main', ${KEY}, null, 'talkbreak', 'model', 'written', 'an older break', now() - interval '5 hours'),
                ('main', ${KEY}, null, 'talkbreak', 'model', 'written', 'a newer break', now() - interval '1 hour')
        `.execute(trx);

        const whole = await scripts.writtenBy(KEY, undefined, 20);
        check('one break with two attempts counts once', whole.length, 3);
        check('oldest first, so a habit reads as one developing', whole.map(row => row.script), [
            'an older break',
            'the floor covered for it',
            'a newer break',
        ]);
        check('a declined attempt carries no words and is not offered as any', whole.some(row => row.script == null), false);

        const since = whole[1]!.at;
        check('the watermark is exclusive, so a script read once is not read again', (await scripts.writtenBy(KEY, since, 20)).map(row => row.script), [
            'a newer break',
        ]);

        // And the round trip through the column, which is the half the check above cannot see: a
        // watermark that lost precision on the way OUT would re-read its own last row even though
        // the comparison is right. This is why both ends carry text rather than a `DateTime`.
        await notes.markRead(KEY, whole.at(-1)!.at);
        check('the watermark survives the column exactly', await notes.readThrough(KEY), whole.at(-1)!.at);
        check('so the pass that stored it reads nothing new', await scripts.writtenBy(KEY, await notes.readThrough(KEY), 20), []);

        // A second pass over a thinner window must not un-read what the first got through.
        await notes.markRead(KEY, whole[0]!.at);
        check('and never moves backwards', await notes.readThrough(KEY), whole.at(-1)!.at);

        say('');
        const total = await sql<{ n: number }>`select count(*)::int as n from deadair.persona_notes where persona_key = ${KEY}`.execute(trx);
        say(`wrote ${total.rows[0]?.n ?? 0} notes under "${KEY}", all of which are about to be rolled back`);

        throw new Rollback();
    })
    .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
    })
    .finally(async () => {
        await db.destroy();
    });
