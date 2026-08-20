/**
 * The gloss reader, against every article this station actually holds.
 *
 * The unit fixture pins the reader against thirty-odd hand-checked samples, which is what keeps the
 * confidence bar honest. It cannot answer the other question: what does this do to the WHOLE
 * library, including the several hundred articles nobody has ever looked at? That is what this is
 * for — it reads every stored document, prints what would be said unasked and what would wait for a
 * glance, and writes nothing at all.
 *
 * Read-only by construction: there is no transaction here because there is nothing to roll back.
 * Safe to run against the live station at any time, including while it is on air.
 *
 * Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/pronunciation.smoke.ts
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
import { CONFIDENCE_BAR, readGloss } from '../src/modules/render/pronunciation.gloss.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const pool = new KyselyPool({
    host: env('DATABASE_HOST', 'localhost'),
    port: Number(env('DATABASE_PORT', '55432')),
    user: env('DATABASE_USER', 'postgres'),
    password: env('DATABASE_PASSWORD', 'postgres'),
    database: env('DATABASE_NAME', 'deadair'),
    // See the note in `rating.smoke.ts`.
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new EmptyUpdateRewriteDialect({ pool }, quiet), plugins: [...KyselyDefaultPlugins] });

const say = (line: string) => process.stdout.write(`${line}\n`);

/**
 * Every stored article and what it is about, across all three levels.
 *
 * The same union `FactRepository.listPendingDocuments` walks, minus the mark test: this wants to see
 * what the reader makes of the whole library rather than of what is still outstanding.
 */
const documents = await sql<{ kind: string; name: string; url: string; text: string }>`
    select 'artist' as kind, a.name, d.doc->>'url' as url, d.doc->>'text' as text
      from deadair.artists a
      join deadair.artist_enrichment e on e.artist_id = a.id
      cross join lateral jsonb_array_elements(coalesce(e.data->'documents', '[]'::jsonb)) as d(doc)
     where a.merged_into_id is null
    union all
    select 'album', al.name, d.doc->>'url', d.doc->>'text'
      from deadair.albums al
      join deadair.album_enrichment e on e.album_id = al.id
      cross join lateral jsonb_array_elements(coalesce(e.data->'documents', '[]'::jsonb)) as d(doc)
     where al.merged_into_id is null
    union all
    select 'track', t.title, d.doc->>'url', d.doc->>'text'
      from deadair.tracks t
      join deadair.track_enrichment e on e.track_id = t.id
      cross join lateral jsonb_array_elements(coalesce(e.data->'documents', '[]'::jsonb)) as d(doc)
     where t.merged_into_id is null
`.execute(db);

await db.destroy();

const active: string[] = [];
const suggested: string[] = [];

for (const row of documents.rows) {
    if (row.name == null || row.text == null) continue;

    const reading = readGloss(row.name, row.text);
    if (reading === undefined) continue;

    const line = `${row.kind.padEnd(6)} ${row.name.slice(0, 30).padEnd(32)} ${reading.written} => ${reading.spoken}`;
    if (reading.confident) active.push(line);
    else suggested.push(line);
}

say(`${documents.rows.length} documents, bar ${CONFIDENCE_BAR}\n`);

say(`SAID UNASKED (${active.length})`);
for (const line of active.sort()) say(`  ${line}`);

// The interesting half. Anything here that is obviously right costs one click; anything obviously
// WRONG is the reason the bar exists, and is what to look at before moving it.
say(`\nWAITING TO BE LOOKED AT (${suggested.length})`);
for (const line of suggested.sort()) say(`  ${line}`);
