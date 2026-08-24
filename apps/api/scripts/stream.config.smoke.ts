/**
 * Renders the stream config against the real database, the way `StreamModule.ready`
 * does at boot, and prints what it wrote.
 *
 * A dev tool, not a test: the unit tests cover the rendering rules, and this covers
 * the parts they cannot — that the settings table is reachable and the secrets
 * round-trip through `EncryptionProvider` with the key this install actually holds.
 *
 * Seeding is idempotent and is what the app would do on its next boot anyway.
 *
 *   node --import @swc-node/register/esm-register ./scripts/stream.config.smoke.ts
 *
 * It drives `StreamService` rather than calling `writeStreamConfig` itself. That is not
 * tidiness: it used to build the playout half of the render by hand, which meant it was
 * a SECOND opinion about what the containers should be told — and by the time anyone
 * looked it had drifted four fields behind the real one and no longer compiled. The
 * point of the script is to render what the app renders, so it has to go through the
 * thing that renders it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { Kysely, PostgresDialect } from 'kysely';
import { KyselyPool, KyselyDefaultPlugins, KyselyPgTypeOverrides } from '@maroonedsoftware/kysely';
import type { Logger } from '@maroonedsoftware/logger';
import type { DB } from '../src/modules/data/db.js';
import { settingsConfigSource } from '../src/server/settings.config.source.js';
import { SettingsRepository } from '../src/modules/settings/settings.repository.js';
import { defaultStreamConfigDir } from '../src/modules/stream/stream.config.js';
import { StreamService } from '../src/modules/stream/stream.service.js';
import { StreamConfigWatch } from '../src/modules/stream/stream.staleness.js';
import { IcecastStatsClient } from '../src/modules/stream/icecast.stats.client.js';
import { SpotifyShimClient } from '../src/modules/stream/spotify.shim.client.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
// No prefix of its own: `StreamService` already writes `stream: …` into every line it logs.
const loud = { info: console.log, warn: console.warn, error: console.error, debug: () => {} } as unknown as Logger;

// Two steps, the way `setup.server.ts` does it. `deadair.settings` is a LAYER of the
// app's config and `resolveStreamSettings` reads the stream values straight off it, so a
// dotenv-only config here would render the DEFAULT mount and title over the operator's.
const boot = await new AppConfigBuilder()
    .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
    .addResolver(new AppConfigResolverEnv())
    .buildSnapshot();

const store = await new AppConfigBuilder()
    .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
    .addSource(settingsConfigSource(boot, quiet))
    .addResolver(new AppConfigResolverEnv())
    .buildStore(quiet);
const config = store.toLiveConfig();

const pool = new KyselyPool({
    host: boot.get('DATABASE_HOST', ''),
    port: boot.get('DATABASE_PORT', 55432),
    user: boot.get('DATABASE_USER', ''),
    password: boot.get('DATABASE_PASSWORD', ''),
    database: boot.get('DATABASE_NAME', ''),
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), plugins: [...KyselyDefaultPlugins] });

const encryption = new EncryptionProvider(Buffer.from(boot.get('KMS_LOCAL_ROOT_KEY', ''), 'hex'));
// The staleness watch is fed by a render and consulted by nothing here. It is a
// constructor argument rather than an optional one because the app has exactly one and a
// second would be a second answer to disagree with; this process just gives it a real one.
const staleness = new StreamConfigWatch(new IcecastStatsClient(config, quiet), quiet);
// The track fetcher is a constructor argument for the authorization routes and is untouched by
// anything below: this script renders config files. It is given a real one with no secrets pushed
// into it, which is a client that answers "not set up" to everything and reaches nothing.
const fetcher = new SpotifyShimClient(config, quiet);
const stream = new StreamService(new SettingsRepository(db), encryption, config, staleness, fetcher, loud);

if (await stream.ensureSecrets()) {
    // The same reload `StreamModule.ready` does, for the same reason and only on the same
    // condition: everything below reads the settings through the CONFIG, whose settings
    // layer was loaded before that seed happened. Without it a fresh station renders both
    // containers' configs with no passwords in them.
    await store.reload();
    console.log('seeded the missing stream secrets; restart icecast and liquidsoap once to adopt them');
} else {
    console.log('stream secrets already set');
}

const wrote = await stream.materialize();
const configDir = config.get('STREAM_CONFIG_DIR', defaultStreamConfigDir());

if (wrote) {
    // Secrets are redacted: this prints to a terminal and, often enough, into a log.
    const redact = (line: string): string => line.replace(/^(\w*(?:PASSWORD|SECRET))='.*'$/, "$1='<redacted>'");
    console.log('\n--- radio.env ---');
    console.log(readFileSync(join(configDir, 'radio.env'), 'utf8').split('\n').map(redact).join('\n'));
    console.log('--- icecast.xml (identity only) ---');
    for (const line of readFileSync(join(configDir, 'icecast.xml'), 'utf8').split('\n')) {
        if (/<(hostname|mount-name|stream-name|genre|stream-url)>/.test(line)) console.log(line.trim());
    }
} else {
    console.log(`\nnothing changed; ${configDir} already holds this render`);
}

await db.destroy();
// The settings source holds a `LISTEN` on its own connection, so the process does not end
// on its own. Nothing here is worth draining, and the render is already on disk.
process.exit(0);
