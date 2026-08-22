/**
 * What the station remembers having played, against the real table.
 *
 * The interesting part here is not who gets written down, which is pure and unit-tested upstream.
 * It is that a record's LEAD survives the round trip — and the failure it exists to catch is one
 * only the database can show: the lead used to be recovered on the way out by splitting the joined
 * credit line on its first comma, which is right about "USHER, Lil Jon, Ludacris" and wrong about
 * "Earth, Wind & Fire". The wrong half is invisible in every unit test that happens to pick an
 * artist with no comma in their name, and the symptom on air is a similarity seed and a presenter's
 * memory both quietly naming a band that does not exist.
 *
 * So this writes the two shapes that pull in opposite directions — a genuine collaboration whose
 * credit line has commas between ARTISTS, and a single act whose own name has commas IN it — and
 * asserts that both reads answer with the lead the writer was given: **the credit line is not the
 * lead**, **a comma in a name is not a separator**, and **the keys still identify what aired**.
 *
 * It writes, and cleans up after itself in a `finally`. Everything it writes carries a station key
 * of its own, so a run against a live install cannot touch that station's memory.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/play.history.smoke.ts
 */
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { Kysely, PostgresDialect } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';

import type { DB } from '../src/modules/data/db.js';
import { PlayHistoryRepository } from '../src/modules/director/play.history.repository.js';
import { artistKey } from '../src/modules/director/rotation.keys.js';
import type { RundownItem } from '../src/modules/playout/rundown.js';

/** Its own station, so a run against a live install cannot see or touch the real memory. */
const STATION = 'play-history-smoke';
const PLUGIN = 'deadair.smoke';
const BROADCAST = '00000000-0000-4000-8000-00000000f00d';

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
const repository = new PlayHistoryRepository(db);

let failures = 0;
const check = (ok: boolean, said: string): void => {
    console.log(`  ${ok ? '✓' : '✗'} ${said}`);
    if (!ok) failures += 1;
};

/**
 * One item as the director hands it over.
 *
 * `artists` is the credit as written and `artist` is the lead, and they are passed separately
 * because that separation is the whole subject here.
 */
const item = (title: string, artists: string[], artist: string): RundownItem => ({
    id: `${title}-id`,
    pluginId: PLUGIN,
    externalId: title,
    title,
    artists,
    artist,
});

try {
    console.log('\nwriting what aired');

    // A resolved collaboration: the whole credit line arrives in ONE element, which is what makes
    // `artists[0]` useless as a lead and why `artist` is carried beside it.
    await repository.record({
        stationKey: STATION,
        broadcastId: BROADCAST,
        item: item('Yeah!', ['USHER, Lil Jon, Ludacris'], 'USHER'),
        source: 'director',
    });

    // A single act whose own name contains commas. The old read could not tell this from the row
    // above, and there is no spelling of `split` that can.
    await repository.record({
        stationKey: STATION,
        broadcastId: BROADCAST,
        item: item('September', ['Earth, Wind & Fire'], 'Earth, Wind & Fire'),
        source: 'director',
    });

    console.log('\nthe seeds a refill draws from');
    const recent = await repository.recentArtists(10, STATION);
    check(recent.includes('USHER'), 'a collaboration seeds on its lead, not on the credit line');
    check(recent.includes('Earth, Wind & Fire'), 'a name with commas in it survives whole');
    check(!recent.some(name => name === 'Earth'), 'a comma inside a name is not read as a separator');

    console.log('\nwhat a presenter is told they have played');
    const played = await repository.duringBroadcast(BROADCAST, 10);
    const yeah = played.find(row => row.title === 'Yeah!');
    const september = played.find(row => row.title === 'September');
    check(yeah?.artist === 'USHER', 'the broadcast memory names the lead of a collaboration');
    check(september?.artist === 'Earth, Wind & Fire', 'the broadcast memory keeps a comma-carrying name whole');

    console.log('\nand the keys still say what aired');
    // The identity half, unchanged by any of the above: both rows key off the lead, so a repeat
    // window and an artist cooldown can still match a collaboration.
    const rows = await db
        .selectFrom('deadair.playHistory')
        .select(['title', 'artist', 'artists', 'artistKey'])
        .where('stationKey', '=', STATION)
        .execute();
    const stored = rows.find(row => row.title === 'Yeah!');
    check(stored?.artists === 'USHER, Lil Jon, Ludacris', 'the credit line is kept for display');
    check(stored?.artist === 'USHER', 'the lead is kept beside it rather than derived later');
    check(stored?.artistKey === artistKey(['USHER']), 'the key is the lead normalized, as the readers expect');

    console.log(failures === 0 ? '\nall good\n' : `\n${failures} failed\n`);
} finally {
    await db.deleteFrom('deadair.playHistory').where('stationKey', '=', STATION).execute();
    await db.destroy();
}

process.exit(failures === 0 ? 0 : 1);
