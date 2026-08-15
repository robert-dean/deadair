/**
 * The fact store, end to end against the real database.
 *
 * The unit tests cover the extractor, which is pure. Nothing else runs this SQL: the three-armed
 * unnest that finds documents nothing has read, the `not exists` that keeps a document from being
 * read twice, the partial unique indexes that keep one claim per subject even though two of the
 * three subject columns are null on every row, and the transaction that has to land the claims and
 * the mark together or not at all.
 *
 * It plants its own enrichment payload against a real track, extracts from it, reads the claims
 * back, and removes everything it wrote. It restores every row it touches.
 *
 * Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/facts.smoke.ts
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
import { FactRepository } from '../src/modules/enrichment/fact.repository.js';
import { FactExtractionService } from '../src/modules/enrichment/fact.extraction.service.js';

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

const facts = new FactRepository(db);
const extraction = new FactExtractionService(facts, quiet);

/** The provider this pretends to be, so nothing it writes can be confused for a real plugin's. */
const PROVIDER = 'deadair.smoke';
const ARTICLE_URL = 'https://en.wikipedia.org/wiki/Deadair_Smoke_Test';

const ARTICLE = [
    '"Smoke Test" is a song by the fictional band The Rollbacks. Written for this script, it was released in 1992 as the third single from their second studio album, Nothing Real (1991).',
    '',
    'The song has never appeared in a film, because it does not exist.',
].join('\n');

let failures = 0;

function check(what: string, actual: unknown, expected: unknown): void {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) console.log(`       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Removes everything this run wrote, by the provider and URL only it uses. */
async function clean(trackId: string): Promise<void> {
    await db.deleteFrom('deadair.facts').where('sourceProvider', '=', PROVIDER).execute();
    await db.deleteFrom('deadair.factExtractions').where('documentUrl', '=', ARTICLE_URL).execute();
    await db.deleteFrom('deadair.trackEnrichment').where('trackId', '=', trackId).where('provider', '=', PROVIDER).execute();
}

const track = await db.selectFrom('deadair.tracks').where('mergedIntoId', 'is', null).select(['id', 'title']).limit(1).executeTakeFirst();

if (!track) {
    console.log('No tracks in the catalog. Sync one and run this again.');
    await db.destroy();
    process.exit(1);
}

console.log(`Using "${track.title}"\n`);

try {
    await clean(track.id);

    // A plugin's payload, in the shape the sanitizer would have stored it.
    await db
        .insertInto('deadair.trackEnrichment')
        .values({
            trackId: track.id,
            provider: PROVIDER,
            providerRef: 'Q0',
            data: sql`${JSON.stringify({
                providerRef: 'Q0',
                documents: [{ url: ARTICLE_URL, title: 'Smoke Test', text: ARTICLE, retrievedAt: new Date().toISOString() }],
            })}::jsonb`,
            fetchedAt: sql`now()`,
        })
        .execute();

    const pending = await facts.listPendingDocuments('lead', 100);
    const mine = pending.filter(document => document.url === ARTICLE_URL);
    check('the unnest finds a document nothing has read', mine.length, 1);
    check('and says which subject it is about', mine[0]?.subject, { type: 'track', id: track.id });

    const first = await extraction.extractLead(100);
    check('the first pass writes the claims the lead yields', first.written, 2);

    const stored = (await facts.findFacts([{ type: 'track', id: track.id }])).filter(fact => fact.sourceProvider === PROVIDER);
    check('which read back against the track', stored.length, 2);
    check('as summaries from the deterministic floor', [stored[0]?.category, stored[0]?.source], ['summary', 'lead']);
    check('never used yet', stored[0]?.lastUsedAt, undefined);
    check('carrying a citation', stored[0]?.sourceUrl, ARTICLE_URL);
    check('and a quote that really occurs in the article', ARTICLE.includes(stored[0]?.sourceQuote ?? 'x'), true);

    const again = await extraction.extractLead(100);
    check('a second pass reads the same document again: never', again.read, 0);
    check('and writes nothing', again.written, 0);

    // The two extractors are tracked apart, which is what makes turning a model on later re-read
    // every article the floor has already been over rather than skipping them as done.
    check(
        'the model pass still sees a document the floor has read',
        (await facts.listPendingDocuments('model', 100)).filter(document => document.url === ARTICLE_URL).length,
        1,
    );

    // The unique index, exercised directly: the same claim offered twice is one row.
    const repeat = await facts.recordExtraction(
        { subject: { type: 'track', id: track.id }, provider: PROVIDER, url: ARTICLE_URL, title: 'Smoke Test', text: ARTICLE },
        'model',
        [
            {
                subject: { type: 'track', id: track.id },
                claim: stored[0]!.claim,
                category: 'placement',
                source: 'model',
                sourceProvider: PROVIDER,
                sourceUrl: ARTICLE_URL,
                sourceQuote: stored[0]!.sourceQuote,
            },
        ],
    );
    check('a claim already known is not stored a second time', repeat, 0);
    check(
        'so the store still holds what it held',
        (await facts.findFacts([{ type: 'track', id: track.id }])).filter(fact => fact.sourceProvider === PROVIDER).length,
        2,
    );

    check(
        'and once the model has read it, it is not offered again either',
        (await facts.listPendingDocuments('model', 100)).filter(document => document.url === ARTICLE_URL).length,
        0,
    );

    await facts.markUsed([stored[0]!.id]);
    const used = (await facts.findFacts([{ type: 'track', id: track.id }])).filter(fact => fact.id === stored[0]!.id);
    check('a used fact is stamped', used[0]?.lastUsedAt !== undefined, true);

    const order = (await facts.findFacts([{ type: 'track', id: track.id }])).filter(fact => fact.sourceProvider === PROVIDER);
    check('and sorts behind the one that has never been said', order[0]?.id, stored[1]?.id);
} finally {
    await clean(track.id);
    await db.destroy();
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
