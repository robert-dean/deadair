/**
 * Why the station's breaks fall through to the floor, per persona.
 *
 * ## What this is for
 *
 * A model that declines is the writer registry working: the floor underneath speaks in the same
 * character, so the station gets a correct line at once instead of paying for a second generation.
 * But the RATE is a measurement, and until this existed nobody had taken it.
 *
 * Taken on the live station for the first time, it says something the code does not: **the decline
 * rate is a property of the PERSONA SHEET, not of the model or the prompt.** Same model, same
 * prompt, same gate, and `videoage` declined 8.3% against `classic`'s 30.0% — and each sheet has
 * exactly one dominant reason rather than a spread, which is the sheet's own shape showing through:
 * `conspiracy` is refused for the time of day (27 of 68), `classic` for naming no record (20 of 30),
 * `wisecrack` for not sounding like herself (39 of 71).
 *
 * WHY each sheet fails its own way is the open question, and this report is deliberately not an
 * answer to it. The first plausible story — that a sheet whose markers are single slang words lands
 * one wherever the sentence goes — is contradicted by the recall column the moment it is printed:
 * `videoage` declines least of anybody and carries a marker in 15.7% of its answers, against
 * `conspiracy`'s 60.6%. Read the caveats below before building anything on that number.
 *
 * So every sheet change is judged here rather than argued about. The alternative is what happened
 * to the last one: a marker list was fixed on a measurement of recall against the SEEDS, predicted a
 * large improvement, shipped, and moved the live rate by four tenths of a point — which nobody would
 * have known without asking the table.
 *
 * ## The recall half is `keepsCharacter` asked backwards
 *
 * `persona.markers.test.ts` measures a marker list for PRECISION, against the roster: does this
 * marker fire on somebody else? That is only half the question, and the half that cannot be
 * measured from the seeds alone is whether a marker fires on THIS character when a model is
 * actually writing as them. The raws in `script_history` are that corpus and there is no other one.
 *
 * It reads what the model SENT rather than the tidied script, deliberately: `readAnswer` is what
 * refused it, so judging its output would be judging words that never existed. And it reads the
 * live `personas` rows rather than the seeds, because a running station's sheets are its own — a
 * seed change reaches nothing until somebody applies it to the row.
 *
 * ## Two things the recall column is NOT, both of which it looks like
 *
 * **It is measured against the sheet as it stands NOW, and every row it reads was written against
 * the sheet as it stood THEN.** A marker list edited on Tuesday makes Monday's breaks look as
 * though they were written under it. That is unavoidable — nothing stores the sheet a break was
 * judged by — and it is why a sheet change is measured by running this AFTER the change and
 * comparing windows, rather than by reading one run as history.
 *
 * **It is not the inverse of the decline rate, and reading it as one will mislead.** Recall is
 * counted over every attempt; `keepsCharacter` is asked of a fraction of them — a sheet with an
 * empty marker list passes unconditionally, and `CharacterContext.dialect` is `optional` for a
 * bulletin, which is the kind whose job is the stories rather than the voice. Low recall beside few
 * out-of-character refusals means the check was mostly not asked, which is a fact about the sheet
 * worth knowing and is not the same fact.
 *
 * ## It writes nothing
 *
 * Read-only, so it is safe against the live station. Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/break.declines.ts
 *
 * It picks up `DATABASE_*` from the environment like every other script here, so against a station
 * somewhere else the five fields are what to override. See the pool below for why not a URL.
 *
 * Optional arguments, in any order:
 *   --days=7        how far back to read. Default 30.
 *   --persona=key   only this one.
 *   --reasons       print the raws behind each decline reason, which is what a sheet change is
 *                   written from. Off by default: it is a lot of text and the rates are the report.
 */
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv, AppConfigSourceEnv } from '@maroonedsoftware/appconfig';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';
import type { DateTime } from 'luxon';

import type { DB } from '../src/modules/data/db.js';
import { catchphrasesIn, dictionMarkersIn } from '../src/modules/personas/persona.sheet.js';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
    args
        .find(arg => arg.startsWith(`--${name}=`))
        ?.split('=')
        .slice(1)
        .join('=');

const days = Number(flag('days') ?? 30);
const onlyPersona = flag('persona');
const showReasons = args.includes('--reasons');

/** How many raws are quoted per reason under `--reasons`. Enough to see the shape, not the corpus. */
const QUOTED_PER_REASON = 6;
/** How much of one raw is quoted. A break is forty words; this is most of one. */
const QUOTE_CHARS = 220;

const config = await new AppConfigBuilder()
    .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
    // LAST, so a variable set on the command line beats the `.env` beside it. Every other script
    // here reads dotenv alone, which is right for one that only ever talks to the dev stack — this
    // one exists to be pointed at a station somewhere else, and without this layer
    // `DATABASE_HOST=127.0.0.1 node ./scripts/break.declines.ts` silently reports on the dev
    // database instead, which looks exactly like a working run.
    .addSource(new AppConfigSourceEnv({ groupSeparator: '__' }))
    .addResolver(new AppConfigResolverEnv())
    .buildSnapshot();

/**
 * Where to read from: the same five fields every other script here uses.
 *
 * **Not `DATABASE_URL`**, which was the obvious choice and is already taken. This repo's `.env`
 * defines it as a `${DATABASE_USER}:${DATABASE_PASSWORD}@…` TEMPLATE for dbmate, so a script that
 * read it got a connection string full of unexpanded placeholders and a `TypeError: Invalid URL`
 * naming nothing that would help. Pointing this at a station somewhere else means setting the five,
 * which for a tunnel is `DATABASE_HOST=127.0.0.1` and the forwarder's port.
 */
const pool = new KyselyPool({
    host: config.get('DATABASE_HOST', ''),
    port: config.get('DATABASE_PORT', 55432),
    user: config.get('DATABASE_USER', ''),
    password: config.get('DATABASE_PASSWORD', ''),
    database: config.get('DATABASE_NAME', ''),
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), plugins: [...KyselyDefaultPlugins] });

/** A sheet as this report needs it: the two lists `keepsCharacter` counts as evidence. */
interface Sheet {
    markers: string[];
    catchphrases: string[];
}

/** A jsonb column read back as the string list it holds, tolerating a row that holds something else. */
const stringsIn = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];

/** One persona's attempts, and what became of them. */
interface Tally {
    attempts: number;
    declined: number;
    failed: number;
    /** Attempts with a raw to judge, which is the denominator recall is a share OF. */
    judged: number;
    /** Of those, how many carried a marker or a catchphrase. `keepsCharacter`'s own question. */
    carried: number;
    reasons: Map<string, Refusal>;
}

/**
 * One reason, and the answers behind it.
 *
 * The count is kept separately from the quotes and that is not redundancy: `llm.captureWrites` is a
 * switch for an evening of prompt tuning rather than a default, so a station with it off declines
 * exactly as often and stores no raws at all. Counting the quotes reported every reason as zero.
 */
interface Refusal {
    count: number;
    quoted: string[];
}

const tally = (): Tally => ({ attempts: 0, declined: 0, failed: 0, judged: 0, carried: 0, reasons: new Map() });

const pct = (part: number, whole: number): string => (whole === 0 ? '   -  ' : `${((100 * part) / whole).toFixed(1).padStart(5)}%`);

try {
    const sheets = new Map<string, Sheet>(
        (await db.selectFrom('deadair.personas').select(['key', 'dictionMarkers', 'catchphrases']).execute()).map(row => [
            row.key,
            { markers: stringsIn(row.dictionMarkers), catchphrases: stringsIn(row.catchphrases) },
        ]),
    );

    let attempts = db
        .selectFrom('deadair.scriptHistory')
        .select(['personaKey', 'outcome', 'reason', 'raw', 'writer', 'model'])
        // The model's own attempts. The floor never declines and counting it would dilute every
        // rate here with rows that could not have gone the other way.
        .where('writer', '=', 'model')
        // The floored literal interval `ScriptHistoryRepository` uses, and for its reason: the
        // window is a number this script was given rather than a value bound into the statement.
        .where('createdAt', '>=', sql<DateTime>`now() - ${sql.lit(`${Math.floor(days)} days`)}::interval`);

    if (onlyPersona !== undefined) attempts = attempts.where('personaKey', '=', onlyPersona);

    const rows = await attempts.execute();
    if (rows.length === 0) {
        console.log(`No model write attempts in the last ${days} days${onlyPersona === undefined ? '' : ` under "${onlyPersona}"`}.`);
        process.exit(0);
    }

    const byPersona = new Map<string, Tally>();
    const models = new Map<string, number>();

    for (const row of rows) {
        // A break written while nobody was presenting is an ordinary state, and it still has a rate
        // worth seeing — it is just not a sheet's rate. Named rather than dropped.
        const key = row.personaKey ?? '(nobody presenting)';
        const seen = byPersona.get(key) ?? tally();
        byPersona.set(key, seen);

        seen.attempts += 1;
        if (row.outcome === 'declined') seen.declined += 1;
        if (row.outcome === 'failed') seen.failed += 1;

        models.set(row.model ?? '(not recorded)', (models.get(row.model ?? '(not recorded)') ?? 0) + 1);

        if (row.outcome === 'declined' && row.reason != null) {
            const refusal = seen.reasons.get(row.reason) ?? { count: 0, quoted: [] };
            seen.reasons.set(row.reason, refusal);
            refusal.count += 1;
            if (row.raw != null) refusal.quoted.push(row.raw);
        }

        // Recall is measured over every attempt with a raw, declined or not: the question is how
        // often this character's own words appear when the model writes as them, and a break that
        // passed for some other reason still answers it.
        const sheet = sheets.get(key);
        if (sheet === undefined || row.raw === null || row.raw === undefined) continue;

        seen.judged += 1;
        if (dictionMarkersIn(sheet.markers, row.raw).length + catchphrasesIn(sheet.catchphrases, row.raw).length > 0) seen.carried += 1;
    }

    const ranked = [...byPersona.entries()].sort((a, b) => b[1].attempts - a[1].attempts);

    console.log(`\nModel write attempts, last ${days} days\n`);
    console.log('persona                  attempts  declined  failed   marker recall');
    console.log('-'.repeat(72));
    for (const [key, seen] of ranked) {
        console.log(
            `${key.padEnd(24)}${String(seen.attempts).padStart(8)}` +
                `${String(seen.declined).padStart(7)} ${pct(seen.declined, seen.attempts)}` +
                `${String(seen.failed).padStart(8)}` +
                `   ${pct(seen.carried, seen.judged)} of ${seen.judged}`,
        );
    }

    console.log('\nWhy they were refused\n');
    for (const [key, seen] of ranked) {
        if (seen.reasons.size === 0) continue;

        console.log(`${key}:`);
        const worst = [...seen.reasons.entries()].sort((a, b) => b[1].count - a[1].count);
        for (const [reason, refusal] of worst) console.log(`  ${String(refusal.count).padStart(4)}  ${reason}`);
        console.log('');

        if (!showReasons) continue;
        for (const [reason, refusal] of worst) {
            console.log(`  --- ${reason}`);
            if (refusal.quoted.length === 0) {
                // Not "no answers": no answers KEPT. Said out loud, because a silent gap here reads
                // as a reason nothing was ever refused for.
                console.log(`      (nothing captured; llm.captureWrites was off for these ${refusal.count})`);
                console.log('');
                continue;
            }

            for (const raw of refusal.quoted.slice(0, QUOTED_PER_REASON)) console.log(`      ${raw.replace(/\s+/g, ' ').slice(0, QUOTE_CHARS)}`);
            if (refusal.quoted.length > QUOTED_PER_REASON) console.log(`      (and ${refusal.quoted.length - QUOTED_PER_REASON} more captured)`);
            if (refusal.quoted.length < refusal.count) console.log(`      (${refusal.count - refusal.quoted.length} more with nothing captured)`);
            console.log('');
        }
    }

    // Which model actually answered, which the row could not say until `LlmConversation.model`
    // carried it. Printed last and unranked: it is the caveat on every number above, because a rate
    // measured against one model says nothing about another.
    console.log('Answered by\n');
    for (const [model, count] of [...models.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(5)}  ${model}`);
    console.log('');
} finally {
    await db.destroy();
}
