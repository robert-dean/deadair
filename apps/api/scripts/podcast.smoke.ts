/**
 * The podcast episodes table, and the syndicated segments beside it, against the real database.
 *
 * The unit tests pin the SQL each method compiles to. What they cannot pin is what Postgres then does
 * with it, and every claim here has a failure mode nothing else would show:
 *
 * - **a refresh describes and never decides**: an upsert that wrote over the fetch bookkeeping or the
 *   aired mark would have the station fetch and air an episode again every half hour;
 * - **"new" comes from `xmax`**, which is Postgres's behaviour and not the query builder's;
 * - **the fetch claim is exclusive and ages out**, which is the whole of how a scheduler running every
 *   few seconds asks for one download, and how a fetch that died without a word is asked for again;
 * - **a syndicated segment is never on the shelf**, or a band would draw last week's episode at random;
 * - **the first airing is kept**, and **newest never goes backwards**, which together are what stops a
 *   band carrying an episode twice or reaching into last month on a night with nothing new.
 *
 * It WRITES, and cleans up after itself in a `finally`: everything it creates is under one show id and
 * one segment label prefix, and is deleted at the end whichever way the run goes.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/podcast.smoke.ts
 */
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { Kysely, PostgresDialect } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';

import type { DB } from '../src/modules/data/db.js';
import { PodcastEpisodeRepository } from '../src/modules/podcasts/podcast.episode.repository.js';
import { SYNDICATED_KIND } from '../src/modules/podcasts/syndicated.kind.js';
import { SegmentRepository, SYNDICATED_SOURCE } from '../src/modules/render/segment.repository.js';
import { StationIdentity } from '../src/modules/shared/station.identity.js';

/** Everything this run writes carries one of these, so the cleanup is two statements. */
const SHOW = 'smoke.podcast:show';
const LABEL = 'smoke:podcast';

const config = await new AppConfigBuilder()
    .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
    .addResolver(new AppConfigResolverEnv())
    .buildSnapshot();

const pool = new KyselyPool({
    host: config.get('DATABASE_HOST', ''),
    port: config.get('DATABASE_PORT', 55432),
    user: config.get('DATABASE_USER', ''),
    password: config.get('DATABASE_PASSWORD', ''),
    database: config.get('DATABASE_NAME', ''),
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), plugins: [...KyselyDefaultPlugins] });

const identity = new StationIdentity();
const episodes = new PodcastEpisodeRepository(db, identity);
const segments = new SegmentRepository(db, identity);

let failures = 0;
const check = (ok: boolean, said: string): void => {
    console.log(`  ${ok ? '✓' : '✗'} ${said}`);
    if (!ok) failures += 1;
};

const listing = (episodeId: string, title: string, overrides: Partial<Parameters<typeof episodes.record>[0][number]> = {}) => ({
    showId: SHOW,
    episodeId,
    showTitle: 'The Smoke Show',
    title,
    audioUrl: `https://cdn.example.com/${episodeId}.mp3`,
    ...overrides,
});

try {
    console.log('podcast episodes');

    // ── a refresh is an upsert that only describes ────────────────────────────
    const firstAdded = await episodes.record([
        listing('ep11', 'Episode 11', { publishedAt: Date.parse('2026-09-07T06:00:00Z') }),
        listing('ep12', 'Episode 12', { publishedAt: Date.parse('2026-09-14T06:00:00Z'), durationMs: 3_723_000, audioBytes: 3_000_000_000 }),
    ]);
    check(firstAdded === 2, 'two episodes never seen are two new rows');

    const newest = await episodes.newest(SHOW);
    check(newest?.episodeId === 'ep12', 'the newest dated episode is the one a band would carry');
    check(newest?.audioBytes === undefined, 'a size claim past what the column holds is dropped, and the listing kept');

    await episodes.markFetchFailed(newest!.id, 'the publisher answered 503');
    const againAdded = await episodes.record([listing('ep12', 'Episode 12 (corrected)', { publishedAt: Date.parse('2026-09-14T06:00:00Z') })]);
    const reread = await episodes.get(newest!.id);
    check(againAdded === 0, 'the same episode listed again is not new: the count comes from the database, not from a read');
    check(reread?.title === 'Episode 12 (corrected)', 'a corrected title is written');
    check(reread?.fetchAttempts === 1 && reread.fetchError === 'the publisher answered 503', 'a re-read never touches what the station did with it');

    // ── the fetch claim ───────────────────────────────────────────────────────
    const now = Date.now();
    check(await episodes.claimFetch(newest!.id, now, 60_000, now + 3_600_000), 'the first ask for the audio claims the row');
    check(!(await episodes.claimFetch(newest!.id, now + 1_000, 60_000)), 'a second ask inside the window finds it already out');
    check(await episodes.claimFetch(newest!.id, now + 120_000, 60_000), 'a fetch that never reported back ages out and is asked for again');

    // ── the segment, and the shelf it must stay off ───────────────────────────
    const segment = await segments.createSyndicated({
        kind: SYNDICATED_KIND,
        label: `${LABEL} The Smoke Show: Episode 12`,
        audioChecksum: 'a'.repeat(64),
        audioExt: 'mp3',
        durationMs: 3_723_000,
        context: { showTitle: 'The Smoke Show', episodeTitle: 'Episode 12' },
    });
    check(segment.source === SYNDICATED_SOURCE && segment.state === 'ready', 'an episode is kept as a syndicated segment, born ready');
    check(segment.context?.episodeTitle === 'Episode 12', 'its context comes back as it went in');

    const shelf = await segments.listReady(SYNDICATED_KIND);
    check(!shelf.some(row => row.id === segment.id), 'it is never on the shelf a band draws from at random');
    check(!(await segments.readyKinds()).includes(SYNDICATED_KIND), 'and never makes `syndicated` look fillable from the shelf');

    await episodes.markFetched(newest!.id, segment.id);
    const fetched = await episodes.get(newest!.id);
    check(
        fetched?.segmentId === segment.id && fetched.fetchAttempts === 0 && fetched.fetchError === undefined,
        'a fetch clears the failures before it',
    );
    check(fetched?.scheduledFor !== undefined, 'the slot it was fetched for is kept');
    check(!(await episodes.claimFetch(newest!.id, now + 999_999, 60_000)), 'an episode the station holds is never asked for again');

    // ── airing, once ──────────────────────────────────────────────────────────
    await episodes.markAired(segment.id, Date.parse('2026-09-15T21:00:00Z'));
    await episodes.markAired(segment.id, Date.parse('2026-09-16T21:00:00Z'));
    check((await episodes.get(newest!.id))?.airedAt === Date.parse('2026-09-15T21:00:00Z'), 'the first airing is kept, not the second hand-over');
    check((await episodes.newest(SHOW)) === undefined, 'with the newest aired, nothing older is offered in its place');
} finally {
    await db.deleteFrom('deadair.podcastEpisodes').where('showId', '=', SHOW).execute();
    await db.deleteFrom('deadair.segments').where('label', 'like', `${LABEL}%`).execute();
    await db.destroy();
}

if (failures > 0) {
    console.log(`\n${failures} check(s) failed.`);
    process.exit(1);
}
console.log('\nall checks passed.');
