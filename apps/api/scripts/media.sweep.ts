/**
 * Delete files in a content store that no database row claims.
 *
 * Three stores, one shape: each is a `ContentStore` keyed by the sha256 of its own bytes, and the
 * rows naming the files still wanted are read by `StorageRepository`. Most stores have one table
 * behind them; the segment store has two, because the soundboard's pads are written into it as well.
 * So "what is down there that nothing points at" is one read of claims and one `list()`, and the only
 * thing that differs per store is which pair to use.
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
 * **The station does this on a schedule now.** `SweepOrphansJob` runs nightly against all three
 * stores, and `storage.sweepOrphans` turns it on. It differs from this script in the one way that
 * matters: it will not take a file that has sat unclaimed for less than the grace period, which is
 * what makes both orderings below stop being a person's problem. Reach for this script for a
 * one-off, for a single store, to see what would go without turning anything on, or for a volume
 * this process is not the one mounting.
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
import { Kysely, PostgresDialect } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';

import type { ContentStore, StoredFile } from '../src/modules/shared/content.store.js';
import type { DB } from '../src/modules/data/db.js';
import { ArtStore } from '../src/modules/art/art.store.js';
import { SegmentStore } from '../src/modules/render/segment.store.js';
import { TrackStore } from '../src/modules/playout/audio/track.store.js';
import { StorageRepository, fileName } from '../src/modules/storage/storage.repository.js';

/**
 * A store, where its files live by default, and what claims a file in it.
 *
 * The claims are {@link StorageRepository}'s, the same reads the nightly sweep and the storage report
 * make, rather than a query of this script's own. This held three raw `select distinct` statements
 * once, and the segment store's asked `segments` alone, so it called every pad on the soundboard an
 * orphan exactly as the nightly job did: pads are written into the same store and `deadair.pads` is
 * the only row naming them. One reader means a table that starts writing into a store is taught to
 * both sweeps at once.
 */
const STORES = {
    segments: {
        dirKey: 'SEGMENT_DIR',
        dirDefault: './media/segments',
        // Segment rows in any state (a `failed` segment keeps its old audio deliberately) and every pad.
        claims: (repository: StorageRepository) => repository.segmentClaims(),
        make: (root: string) => new SegmentStore(root),
    },
    tracks: {
        dirKey: 'TRACKS_DIR',
        dirDefault: './media/tracks',
        claims: (repository: StorageRepository) => repository.trackClaims(),
        make: (root: string) => new TrackStore(root),
    },
    art: {
        dirKey: 'ART_DIR',
        dirDefault: './media/art',
        claims: (repository: StorageRepository) => repository.artClaims(),
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
    const claims = await store.claims(new StorageRepository(db));

    const files = await (store.make(root) as ContentStore<string>).list();
    // Anything the store cannot name is left alone rather than swept: a `.tmp-` file an interrupted
    // write left behind, something a person dropped in, and — for `segments` — everything in the
    // inbox, which sits under this root and is not the store's to remove.
    // Intersected with StoredFile rather than respelling its fields, which is what this was: a
    // literal listing checksum, ext and bytes stopped narrowing the moment the store learned to
    // report a file's age, and the failure surfaced two lines down as a checksum that might be
    // undefined rather than here.
    const named = files.filter((file): file is StoredFile & { checksum: string; ext: string } => 'checksum' in file);
    // By `<checksum>.<ext>`, as the nightly sweep compares, rather than by checksum alone.
    const orphans = named.filter(file => !claims.names.has(fileName(file.checksum, file.ext)));
    const bytes = orphans.reduce((total, file) => total + file.bytes, 0);

    console.log(`\n${which}: ${root}`);
    console.log(`  ${files.length} files, ${named.length} the store can name, ${claims.names.size} files claimed by ${claims.rows} rows`);
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
