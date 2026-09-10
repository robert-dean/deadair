/**
 * Drains a real rundown into the real Liquidsoap, with no Spotify in the picture.
 *
 * The unit tests cover the rundown and the pusher against a stub player. This
 * covers what they cannot: that `radio.liq`'s control endpoints behave the way
 * `parseReading` assumes, that an `annotate:` uri survives the round trip, and
 * that an item handed over actually reaches the mount and reports itself back.
 *
 * Items resolve to `file://` paths INSIDE the Liquidsoap container, so this needs
 * nothing but the stream stack:
 *
 *   node --import @swc-node/register/esm-register ./scripts/playout.smoke.ts [uri ...]
 *
 * Defaults to the bundled station ident twice, which is always present in the
 * image. Pass your own container-side paths (e.g. file:///music/track.mp3) to
 * hear something else.
 *
 * The air confirmation normally arrives over HTTP from the container, which needs
 * the API running. This does not require that: it polls the reading, which
 * carries the same `onAir` id, and reports whichever gets there.
 */
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { ConsoleLogger } from '@maroonedsoftware/logger';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { Kysely, PostgresDialect } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';
import type { Logger } from '@maroonedsoftware/logger';
import type { DB } from '../src/modules/data/db.js';
import { settingsConfigSource } from '../src/server/settings.config.source.js';
import { MOUNT_PATHS, resolveStreamSettings, streamMounts } from '../src/modules/stream/stream.settings.js';
import { IcecastStatsClient } from '../src/modules/stream/icecast.stats.client.js';
import { IcecastEventFeed } from '../src/modules/stream/icecast.eventfeed.client.js';
import { HlsAudience } from '../src/modules/stream/hls.audience.js';
import { StreamConfigWatch } from '../src/modules/stream/stream.staleness.js';
import { StationLineup, isTrackItem } from '../src/modules/director/station.lineup.js';
import { AudienceWatch } from '../src/modules/playout/audience.watch.js';
import { LiquidsoapEndpoint } from '../src/modules/playout/liquidsoap.endpoint.js';
import { PlayoutControlClient } from '../src/modules/playout/liquidsoap.control.js';
import { PlayoutPusher } from '../src/modules/playout/playout.pusher.js';
import { Rundown, type RundownItem } from '../src/modules/playout/rundown.js';
import { TrackResolver } from '../src/modules/playout/playout.capability.js';
import { Heartbeat } from '../src/modules/shared/heartbeat.js';
import { StationBus } from '../src/modules/shared/station.bus.js';

/** Container-side uris to air. Defaults to the ident, which the image always has. */
const URIS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['file:///radio/station-id.mp3', 'file:///radio/station-id.mp3'];

/** How long to watch before giving up, and how often to take a reading. */
const WATCH_MS = 45_000;
const POLL_MS = 1_000;

/** Hands back the uri the item was built from. Stands in for the plugin resolvers. */
class FileResolver extends TrackResolver {
    constructor(private readonly uris: Map<string, string>) {
        super();
    }
    async resolve(item: RundownItem): Promise<string | undefined> {
        return this.uris.get(item.externalId);
    }
}

// Two steps, the way `setup.server.ts` does it: `deadair.settings` is a LAYER of the
// app's config, so a dotenv-only build resolves the mount, the bridge secret and the air
// mode to their defaults and this would drive a station that does not exist.
const boot = await new AppConfigBuilder()
    .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
    .addResolver(new AppConfigResolverEnv())
    .buildSnapshot();
const logger = new ConsoleLogger();
const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const config = (
    await new AppConfigBuilder()
        .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
        .addSource(settingsConfigSource(boot, quiet))
        .addResolver(new AppConfigResolverEnv())
        .buildStore(quiet)
).toLiveConfig();

const pool = new KyselyPool({
    host: boot.get('DATABASE_HOST', ''),
    port: boot.get('DATABASE_PORT', 55432),
    user: boot.get('DATABASE_USER', ''),
    password: boot.get('DATABASE_PASSWORD', ''),
    database: boot.get('DATABASE_NAME', ''),
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), plugins: [...KyselyDefaultPlugins] });

const settings = resolveStreamSettings(config, new EncryptionProvider(Buffer.from(boot.get('KMS_LOCAL_ROOT_KEY', ''), 'hex')));
await db.destroy();

if (!settings.playoutBridgeSecret) {
    console.error('no playout bridge secret in the settings; boot the API once so StreamModule can seed it');
    process.exit(1);
}

const endpoint = new LiquidsoapEndpoint(config, logger);
endpoint.useSecret(settings.playoutBridgeSecret);
// The staleness watch is fed by every reading and consulted by none of them, so this
// process gives it a real one and never asks it anything.
const stats = new IcecastStatsClient(config, quiet);
// Every mount the station publishes, primary first, exactly as `StreamModule.ready`
// installs them. Not just the MP3 one: the gate below sums listeners across all of them,
// so a smoke run naming one would report an empty station while somebody was on Opus.
stats.useMounts({
    host: settings.icecastHost,
    port: settings.icecastPort,
    mount: MOUNT_PATHS.mp3,
    alsoMounts: streamMounts(settings)
        .slice(1)
        .map(mount => mount.path),
    adminPassword: settings.adminPassword,
});
const control = new PlayoutControlClient(endpoint, new StreamConfigWatch(stats, quiet), logger);

if (!(await control.status())) {
    console.error('liquidsoap is not answering; start the stream stack first');
    process.exit(1);
}

const uris = new Map(URIS.map((uri, index) => [`smoke-${index}`, uri]));
const rundown = new Rundown(new FileResolver(uris), logger);

// The rundown stopped holding a list of its own: there is ONE ordered list, the
// director's, and an item's position in it IS its state. So a running order is a
// `StationLineup` attached here, with the playable form of each item prepared alongside
// it — the same two calls the director makes on its commit pass.
const order = new StationLineup({ name: 'Playout smoke', mode: 'rotation', onEnd: 'stop', source: 'import' });
order.replaceFrom(
    URIS.map((uri, index) => ({
        pluginId: 'deadair.smoke',
        externalId: `smoke-${index}`,
        title: uri.split('/').pop() ?? uri,
        artists: ['smoke test'],
        artist: 'smoke test',
    })),
);
rundown.attach(order);
rundown.prepare(order.all().flatMap(item => (isTrackItem(item) ? [{ ...item.track, id: item.id } as RundownItem] : [])));

// The pusher will not hand anything over unless the audience gate is open, so this needs
// a real watch: `always` mode opens it permanently, which is what a smoke test wants and
// what an operator listening for it would otherwise have to provide in person.
// The HLS half of the audience is an empty register here and stays one: it is fed by the
// playlist requests the API serves, and this process serves nothing. So the count is
// Icecast's alone, which is what a smoke run against the mount wants anyway.
const audience = new AudienceWatch(
    stats,
    new IcecastEventFeed(stats, quiet),
    new HlsAudience(),
    config,
    new Heartbeat(),
    new StationBus(quiet),
    quiet,
);
const pusher = new PlayoutPusher(rundown, control, audience, config, new Heartbeat(), logger);

// Started before the gate is judged, and then given a moment: `gateOpen()` answers from
// the last reading, and before the first poll lands there has not been one. Asking too
// early reports every station as having no audience, including one somebody is listening
// to right now.
audience.start();
await new Promise(resolve => setTimeout(resolve, 1_000));

if (!audience.gateOpen()) {
    console.log('nobody is listening and the station airs only for an audience: open the mount, or set playout.airMode to `always`');
}

// Take back whatever the player is still holding before pushing anything.
//
// Not tidiness: the pusher tops up to a fixed lead and counts what the player ALREADY
// holds towards it, so a Liquidsoap left queued by a previous session (an API that was
// stopped, an earlier run of this script) is already at the lead and this hands over
// nothing at all. Measured: the run reported "nothing ever went on air" while the player
// sat on three items from a process that no longer existed.
await control.flush();

console.log(`airing ${URIS.length} item(s): ${URIS.join(', ')}`);
pusher.start();

// Watch until the running order drains, reporting each boundary the player reports.
const startedAt = Date.now();
let lastReported: string | undefined;
let aired = 0;

while (Date.now() - startedAt < WATCH_MS) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS));

    const playing = rundown.nowPlaying();
    const id = playing?.item.id;
    if (id && id !== lastReported) {
        lastReported = id;
        aired += 1;
        const remaining = playing.remainingMs === undefined ? 'unknown' : `${Math.round(playing.remainingMs / 1000)}s`;
        console.log(`on air: ${playing.item.title} (${uris.get(playing.item.externalId)}) — ${remaining} left`);
    }
    if (aired >= URIS.length && !rundown.nowPlaying()) break;
}

pusher.stop();
audience.stop();
// Leave nothing of the smoke test in the player: what is on air finishes, the rest goes.
await control.flush();

console.log(aired > 0 ? `\ndone: ${aired} of ${URIS.length} item(s) reached the mount` : '\nnothing ever went on air — see the reading above');
process.exit(aired > 0 ? 0 : 1);
