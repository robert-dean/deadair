/**
 * The running order's grip on the enrichment walk, against the real database.
 *
 * Two pieces of SQL and nothing unit-tests either, for the reason `rating.smoke.ts` gives: the
 * interesting part IS the SQL. `StationLineupRepository.lineupTrackIds` reads a jsonb document with
 * `jsonb_array_elements ... with ordinality` and filters on states spelled out in a string list, and
 * the three `list*NeedingEnrichment` queries lead their sort with `array_position` over a uuid array
 * that is usually empty. Both are the kind of thing that returns plausible rows while being wrong.
 *
 * It writes a running order into `deadair.station_lineup` and rolls the whole run back, so a station
 * that is on air keeps what it was playing. Nothing else here writes.
 *
 * Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/enrichment.priority.smoke.ts
 */

/** The database half of `.env`, read by hand: this script wants a pool, not the app's whole config. */
function env(key: string, fallback: string): string {
    if (process.env[key] !== undefined) return process.env[key];
    const line = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
    return line?.[1]?.trim() ?? fallback;
}

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Kysely } from 'kysely';
import { EmptyUpdateRewriteDialect, KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';
import type { Logger } from '@maroonedsoftware/logger';

import type { DB } from '../src/modules/data/db.js';
import { toJsonb } from '../src/modules/data/jsonb.js';
import { StationLineupRepository } from '../src/modules/director/station.lineup.repository.js';
import { EnrichmentRepository } from '../src/modules/enrichment/enrichment.repository.js';
import { LineupPriorityReader } from '../src/modules/enrichment/lineup.priority.js';

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

/** A transaction thrown away on purpose, so a live running order survives the run. */
class Rollback extends Error {}

/**
 * Five real records to build a running order out of.
 *
 * Real ones, because `array_position` is over `uuid[]` and the walk's queries join through
 * `deadair.tracks` to reach an artist — invented ids would pass the jsonb half and quietly test
 * nothing at all on the other side.
 */
const records = await db
    .selectFrom('deadair.tracks')
    .innerJoin('deadair.trackSources', 'deadair.trackSources.trackId', 'deadair.tracks.id')
    .select(['deadair.tracks.id as trackId', 'deadair.tracks.artistId', 'deadair.trackSources.pluginId', 'deadair.trackSources.externalId'])
    .where('deadair.tracks.mergedIntoId', 'is', null)
    .where('deadair.trackSources.missingAt', 'is', null)
    .distinctOn('deadair.tracks.id')
    .limit(5)
    .execute();

if (records.length < 5) {
    say('this station has fewer than five bound records; nothing to build a running order out of');
    process.exit(1);
}

const [first, second, third, fourth, fifth] = records as [
    (typeof records)[number],
    (typeof records)[number],
    (typeof records)[number],
    (typeof records)[number],
    (typeof records)[number],
];

/** One line of a running order, in the shape `toItems` reads back. */
const line = (state: string, record: (typeof records)[number]) => ({
    id: randomUUID(),
    kind: 'track',
    state,
    track: { pluginId: record.pluginId, externalId: record.externalId, title: 't', artists: ['a'], trackId: record.trackId },
});

try {
    await db.transaction().execute(async trx => {
        const lineup = new StationLineupRepository(trx);
        const enrichment = new EnrichmentRepository(trx);
        const priorityReader = new LineupPriorityReader(trx, lineup);

        // ── what the order says ────────────────────────────────────────────────────────
        // Deliberately awkward: two states that count and four that must not, one record named
        // twice, a segment, and an item with no `trackId` at all — which is the ordinary state of a
        // record the catalog has never seen.
        const items = [
            line('played', first),
            line('airing', second),
            { id: randomUUID(), kind: 'segment', state: 'planned', segmentId: randomUUID() },
            line('planned', third),
            line('skipped', fourth),
            line('planned', second),
            { id: randomUUID(), kind: 'track', state: 'planned', track: { pluginId: 'p', externalId: 'x', title: 't', artists: ['a'] } },
            line('removed', fifth),
            line('unavailable', first),
            line('planned', fourth),
        ];

        await trx
            .insertInto('deadair.stationLineup')
            .values({ stationKey: 'main', name: 'smoke', source: 'smoke', items: toJsonb(items) })
            .onConflict(oc => oc.column('stationKey').doUpdateSet({ items: toJsonb(items) }))
            .execute();

        const ids = await lineup.lineupTrackIds();

        // `airing` and `planned` only, in SLOT order, deduplicated to the EARLIEST position — the
        // second record appears twice and its `airing` line is what the deadline belongs to.
        check('lineupTrackIds keeps what is still to come, in slot order', ids, [second.trackId, third.trackId, fourth.trackId]);
        check('lineupTrackIds drops a record already behind the cursor', ids.includes(first.trackId), false);
        check('lineupTrackIds drops one cut before its turn', ids.includes(fifth.trackId), false);

        // ── what that resolves to ──────────────────────────────────────────────────────
        const priority = await priorityReader.read();
        check('the priority carries the order it was read in', priority.trackIds, ids);
        check('every record still to come contributes its artist', new Set(priority.artistIds).size, priority.artistIds.length);
        check(
            'and those artists are the ones behind those records',
            priority.artistIds.every(id => [second.artistId, third.artistId, fourth.artistId].includes(id)),
            true,
        );

        // ── what the walk then does with it ────────────────────────────────────────────
        // The providers list is what the walk would pass. Any non-empty list will do: the query's
        // set difference decides which rows are outstanding and this is only asking about ORDER.
        const providers = ['musicbrainz'];
        const plain = await enrichment.listTracksNeedingEnrichment(providers, [], 200);
        const ranked = await enrichment.listTracksNeedingEnrichment(providers, [], 200, priority.trackIds);

        check('priority does not change WHICH tracks are outstanding', new Set(ranked.map(t => t.id)), new Set(plain.map(t => t.id)));

        // Only the outstanding members of the order can lead, so the bar is the ones that are
        // actually in the batch — a station whose whole running order is already described is a
        // pass with nothing to promote, which is success rather than a failed check.
        const outstanding = priority.trackIds.filter(id => ranked.some(t => t.id === id));
        check(
            outstanding.length === 0 ? 'the order is fully described, so there is nothing to lead (vacuous)' : 'the order leads the batch',
            ranked.slice(0, outstanding.length).map(t => t.id),
            outstanding,
        );
        check(
            'an empty priority sorts exactly as it always did',
            plain.map(t => t.id),
            (await enrichment.listTracksNeedingEnrichment(providers, [], 200, [])).map(t => t.id),
        );

        say(`\n  (${ranked.length} tracks outstanding, ${outstanding.length} of them in the running order)`);

        throw new Rollback();
    });
} catch (error) {
    if (!(error instanceof Rollback)) throw error;
}

await db.destroy();
