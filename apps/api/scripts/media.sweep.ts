/**
 * Delete files in a content store that no database row claims.
 *
 * Three stores, one shape: each is a `ContentStore` keyed by the sha256 of its own bytes, and each
 * has exactly one table naming the checksums that are still wanted. So "what is down there that
 * nothing points at" is one query and one `list()`, and the only thing that differs per store is
 * which pair to use.
 *
 * **This is not an eviction policy.** It answers "what is unreachable", not "what is worth keeping":
 * a file with a row is left alone however old it is. See [track-cache-eviction](https://github.com/robert-dean/deadair/discussions/46) for the
 * harder question, which is about a store that grows while every file in it is perfectly valid.
 *
 * What makes a file unreachable is worth stating, because it is the whole justification for deleting
 * one. Every read starts from a row: the row holds the checksum and the checksum is the path. So a
 * file whose row is gone cannot be found by anything, and re-fetching is not a waste being avoided
 * here — it is what will happen regardless, because nothing can tell that these bytes are the ones
 * being asked for.
 *
 * Two orderings matter and neither is enforced here:
 *
 *  - For `segments`, scan the inbox FIRST (`POST /segments/scan`, or a boot). The store is content
 *    addressed, so a file re-imported from the inbox re-adopts its existing bytes rather than being
 *    written again — sweep first and you delete exactly what the scan was about to claim.
 *  - For `art` and `tracks`, run it while nothing is fetching, or accept that a file written between
 *    the query and the delete is a file this will remove out from under its own fresh row. Both are
 *    re-fetchable, so the cost is a download rather than a loss.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/media.sweep.ts <segments|tracks|art> [--root DIR] [--delete]
 *
 * Without `--delete` it only says what it would remove. `--root` is for a store this process does not
 * hold the path to — the containers mount their own volume, so the app's own default is not where
 * the station's files actually are.
 */
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';

import type { ContentStore } from '../src/modules/shared/content.store.js';
import type { DB } from '../src/modules/data/db.js';
import { ArtStore } from '../src/modules/art/art.store.js';
import { SegmentStore } from '../src/modules/render/segment.store.js';
import { TrackStore } from '../src/modules/playout/audio/track.store.js';

/** A store, where its files live by default, and the one column that says a file is still wanted. */
const STORES = {
    segments: {
        dirKey: 'SEGMENT_DIR',
        dirDefault: './media/segments',
        // `audio_checksum` on any row in any state: a `failed` segment keeps its old audio
        // deliberately, and a segment that cannot air is still not a file to delete.
        claims: 'select distinct audio_checksum as checksum from deadair.segments where audio_checksum is not null',
        make: (root: string) => new SegmentStore(root),
    },
    tracks: {
        dirKey: 'TRACKS_DIR',
        dirDefault: './media/tracks',
        claims: 'select distinct checksum from deadair.track_audio where checksum is not null',
        make: (root: string) => new TrackStore(root),
    },
    art: {
        dirKey: 'ART_DIR',
        dirDefault: './media/art',
        claims: 'select distinct checksum from deadair.art_assets where checksum is not null',
        make: (root: string) => new ArtStore(root),
    },
} as const;

type StoreName = keyof typeof STORES;

const isStoreName = (value: string | undefined): value is StoreName => value !== undefined && Object.hasOwn(STORES, value);

const args = process.argv.slice(2);
const which = args.find(arg => !arg.startsWith('--'));
const DELETE = args.includes('--delete');
const rootOverride = args[args.indexOf('--root') + 1];

if (!isStoreName(which)) {
    console.error(`Usage: media.sweep.ts <${Object.keys(STORES).join('|')}> [--root DIR] [--delete]`);
    process.exit(2);
}

const store = STORES[which];

const config = await new AppConfigBuilder()
    .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
    .addResolver(new AppConfigResolverEnv())
    .buildSnapshot();

const root = args.includes('--root') && rootOverride !== undefined ? rootOverride : config.get(store.dirKey, store.dirDefault);

const pool = new KyselyPool({
    host: config.get('DATABASE_HOST', ''),
    port: config.get('DATABASE_PORT', 55432),
    user: config.get('DATABASE_USER', ''),
    password: config.get('DATABASE_PASSWORD', ''),
    database: config.get('DATABASE_NAME', ''),
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), plugins: [...KyselyDefaultPlugins] });

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

try {
    const rows = await sql<{ checksum: string }>`${sql.raw(store.claims)}`.execute(db);
    const claimed = new Set(rows.rows.map(row => row.checksum));

    const files = await (store.make(root) as ContentStore<string>).list();
    // Anything the store cannot name is left alone rather than swept: a `.tmp-` file an interrupted
    // write left behind, something a person dropped in, and — for `segments` — everything in the
    // inbox, which sits under this root and is not the store's to remove.
    const named = files.filter((file): file is { checksum: string; ext: string; bytes: number } => 'checksum' in file);
    const orphans = named.filter(file => !claimed.has(file.checksum));
    const bytes = orphans.reduce((total, file) => total + file.bytes, 0);

    console.log(`\n${which}: ${root}`);
    console.log(`  ${files.length} files, ${named.length} the store can name, ${claimed.size} checksums claimed by a row`);
    console.log(`  ${orphans.length} orphaned, ${megabytes(bytes)}`);

    if (orphans.length === 0) {
        console.log('\nNothing to sweep.\n');
    } else if (!DELETE) {
        console.log('\nNothing deleted. Re-run with --delete to remove them.\n');
    } else {
        let removed = 0;
        for (const orphan of orphans) if (await (store.make(root) as ContentStore<string>).remove(orphan.checksum, orphan.ext)) removed += 1;
        console.log(`\nRemoved ${removed} files, ${megabytes(bytes)}.\n`);
    }
} finally {
    await db.destroy();
}
