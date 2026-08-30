/**
 * What the desk's "Needs you" rows actually SAY about a real catalog.
 *
 * The unit tests mock the repository and hand `attention()` a shape, so nothing else runs the two
 * queries behind the evidence — and they are the kind of SQL that is wrong quietly: the record list
 * reuses the state chip's own predicates and the copies hang off a second read keyed by track id, so
 * a mistake in either does not throw, it just hands the desk a sentence about the wrong copy or no
 * sentence at all.
 *
 * The check that catches that is the pair below: **every sampled record has to be one the state
 * filter also lists**, and **every one has to carry at least one copy**, since a record with no
 * copies at all is `uncached` rather than benched and must not be in this sample. The sentences are
 * printed so somebody can read what an operator would read.
 *
 * Read-only. It writes nothing and needs no transaction.
 *
 * Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/attention.evidence.smoke.ts
 */

/** The database half of `.env`, read by hand: this script wants a pool, not the app's whole config. */
function env(key: string, fallback: string): string {
    if (process.env[key] !== undefined) return process.env[key];
    const line = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
    return line?.[1]?.trim() ?? fallback;
}

import { readFileSync } from 'node:fs';
import { Kysely } from 'kysely';
import { EmptyUpdateRewriteDialect, KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';
import { ANALYSIS_SCHEMA_VERSION } from '@deadair/plugin-sdk';
import type { Logger } from '@maroonedsoftware/logger';

import type { DB } from '../src/modules/data/db.js';
import { TracksRepository } from '../src/modules/catalog/tracks.repository.js';
import { attention, EVIDENCE_LIMIT, type AttentionFacts, type QuotedSilence } from '../src/modules/station/station.attention.js';

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
const tracks = new TracksRepository(db);

const say = (line: string) => process.stdout.write(`${line}\n`);
const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    say(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) process.exitCode = 1;
};

/** A station with nothing else wrong with it, so the printed list is the two rows under test. */
const airing: QuotedSilence = { audible: true, cause: 'airing', detail: '', checks: [] };

const base = { limit: 200, offset: 0, sort: 'asc' as const, schemaVersion: ANALYSIS_SCHEMA_VERSION };

try {
    const counts = await tracks.trackStateCounts(base);
    const [benchedExamples, failingExamples] = await Promise.all([
        tracks.faultingTracks('benched', EVIDENCE_LIMIT, ANALYSIS_SCHEMA_VERSION),
        tracks.faultingTracks('failing', EVIDENCE_LIMIT, ANALYSIS_SCHEMA_VERSION),
    ]);

    say(`${counts.total} records: ${counts.benched} benched, ${counts.failing} failing`);
    if (counts.benched === 0 && counts.failing === 0) {
        say('a catalog with nothing wrong with it proves nothing here; run this against one that has');
        process.exit(0);
    }

    // The sample is a handful of a possibly large set, so what is checkable is the bound and the
    // membership rather than the contents.
    for (const [state, sample, count] of [
        ['benched', benchedExamples, counts.benched],
        ['failing', failingExamples, counts.failing],
    ] as const) {
        check(`the ${state} sample is bounded`, sample.length, Math.min(count, EVIDENCE_LIMIT));

        // The whole reason the read reuses `stateFilter`'s predicates rather than restating them: a
        // record on the desk that the chip does not list is a row an operator cannot get to.
        const listed = new Set((await tracks.listTracks({ ...base, state })).data.map(row => row.id));
        check(
            `every ${state} record the desk names is one the ${state} chip lists`,
            sample.every(track => listed.has(track.trackId)),
            true,
        );

        // A record with no copies at all is an import whose lookup never resolved, which reads as
        // `uncached`. One in this sample would mean the copies read missed its rows.
        check(
            `every ${state} record carries the copies that put it there`,
            sample.every(track => track.copies.length > 0),
            true,
        );
    }

    const faultsById = await tracks.faultsForTracks(benchedExamples.map(track => track.trackId));
    check(
        'asking for the same records by id answers the same copies',
        faultsById.map(fault => [fault.trackId, fault.copies.length]).sort(),
        benchedExamples.map(track => [track.trackId, track.copies.length]).sort(),
    );

    const facts: AttentionFacts = {
        silence: airing,
        benched: counts.benched,
        failing: counts.failing,
        benchedExamples,
        failingExamples,
        tracks: counts.total,
        unavailableItems: 0,
        unavailableExamples: [],
        brokenPlugins: [],
    };

    // Printed rather than asserted: the sentences are the point of the whole change, and the only
    // check worth making on them by machine is that there is one per record.
    for (const item of attention(facts)) {
        say('');
        say(`${item.title}`);
        say(`  ${item.detail}`);
        for (const piece of item.evidence ?? []) {
            say(`  · ${piece.label}`);
            say(`      ${piece.reason}`);
        }
        check(
            `the ${item.code} row names as many records as it sampled`,
            item.evidence?.length ?? 0,
            item.code === 'benchedCopies' ? benchedExamples.length : failingExamples.length,
        );
    }
} finally {
    await db.destroy();
}
