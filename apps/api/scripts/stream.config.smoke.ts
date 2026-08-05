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
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { Kysely } from 'kysely';
import { KyselyPool, KyselyDefaultPlugins, KyselyPgTypeOverrides } from '@maroonedsoftware/kysely';
import type { DB } from '../src/modules/data/db.js';
import { SettingsRepository } from '../src/modules/settings/settings.repository.js';
import { ensureStreamSecrets, resolveStreamSettings } from '../src/modules/stream/stream.settings.js';
import { defaultStreamAssetsDir, defaultStreamConfigDir, writeStreamConfig } from '../src/modules/stream/stream.config.js';
import { playoutAiredUrl, resolvePlayoutBaseUrl } from '../src/modules/playout/playout.urls.js';

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
const db = new Kysely<DB>({ dialect: new (await import('kysely')).PostgresDialect({ pool }), plugins: [...KyselyDefaultPlugins] });

const repository = new SettingsRepository(db);
const encryption = new EncryptionProvider(Buffer.from(config.get('KMS_LOCAL_ROOT_KEY', ''), 'hex'));

const seeded = await ensureStreamSecrets(repository, encryption);
console.log(seeded ? 'seeded missing stream secrets' : 'stream secrets already set');

const settings = await resolveStreamSettings(repository, encryption);
const configDir = config.get('STREAM_CONFIG_DIR', defaultStreamConfigDir());

const wrote = writeStreamConfig({
    settings,
    playout: {
        playoutAiredUrl: playoutAiredUrl(resolvePlayoutBaseUrl(config)),
        playoutBridgeSecret: settings.playoutBridgeSecret ?? '',
        talkOverTracks: true,
        duckGainDb: -12,
        duckFadeMs: 300,
    },
    assetsDir: config.get('STREAM_ASSETS_DIR', defaultStreamAssetsDir()),
    configDir,
    log: message => console.log(`stream: ${message}`),
});

if (wrote) {
    // Secrets are redacted: this prints to a terminal and, often enough, into a log.
    const redact = (line: string): string => line.replace(/^(\w*(?:PASSWORD|SECRET))='.*'$/, "$1='<redacted>'");
    console.log('\n--- radio.env ---');
    console.log(readFileSync(join(configDir, 'radio.env'), 'utf8').split('\n').map(redact).join('\n'));
    console.log('--- icecast.xml (identity only) ---');
    for (const line of readFileSync(join(configDir, 'icecast.xml'), 'utf8').split('\n')) {
        if (/<(hostname|mount-name|stream-name|genre|stream-url)>/.test(line)) console.log(line.trim());
    }
}

await db.destroy();
