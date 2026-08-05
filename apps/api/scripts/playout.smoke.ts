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
import type { DB } from '../src/modules/data/db.js';
import { SettingsRepository } from '../src/modules/settings/settings.repository.js';
import { resolveStreamSettings } from '../src/modules/stream/stream.settings.js';
import { LiquidsoapEndpoint } from '../src/modules/playout/liquidsoap.endpoint.js';
import { PlayoutControlClient } from '../src/modules/playout/liquidsoap.control.js';
import { PlayoutPusher } from '../src/modules/playout/playout.pusher.js';
import { Rundown, type RundownItem } from '../src/modules/playout/rundown.js';
import { TrackResolver } from '../src/modules/playout/playout.capability.js';

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

const config = await new AppConfigBuilder()
    .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
    .addResolver(new AppConfigResolverEnv())
    .buildSnapshot();
const logger = new ConsoleLogger();

const pool = new KyselyPool({
    host: config.get('DATABASE_HOST', ''),
    port: config.get('DATABASE_PORT', 55432),
    user: config.get('DATABASE_USER', ''),
    password: config.get('DATABASE_PASSWORD', ''),
    database: config.get('DATABASE_NAME', ''),
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), plugins: [...KyselyDefaultPlugins] });

const settings = await resolveStreamSettings(
    new SettingsRepository(db),
    new EncryptionProvider(Buffer.from(config.get('KMS_LOCAL_ROOT_KEY', ''), 'hex')),
);
await db.destroy();

if (!settings.playoutBridgeSecret) {
    console.error('no playout bridge secret in the settings; boot the API once so StreamModule can seed it');
    process.exit(1);
}

const endpoint = new LiquidsoapEndpoint(config, logger);
endpoint.useSecret(settings.playoutBridgeSecret);
const control = new PlayoutControlClient(endpoint, logger);

if (!(await control.status())) {
    console.error('liquidsoap is not answering; start the stream stack first');
    process.exit(1);
}

const uris = new Map(URIS.map((uri, index) => [`smoke-${index}`, uri]));
const rundown = new Rundown(new FileResolver(uris), logger);
const pusher = new PlayoutPusher(rundown, control, logger);

rundown.load(
    URIS.map((uri, index) => ({
        pluginId: 'deadair.smoke',
        externalId: `smoke-${index}`,
        title: uri.split('/').pop() ?? uri,
        artists: ['smoke test'],
    })),
);

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
// Leave nothing of the smoke test in the player: what is on air finishes, the rest goes.
await control.flush();

console.log(aired > 0 ? `\ndone: ${aired} of ${URIS.length} item(s) reached the mount` : '\nnothing ever went on air — see the reading above');
process.exit(aired > 0 ? 0 : 1);
