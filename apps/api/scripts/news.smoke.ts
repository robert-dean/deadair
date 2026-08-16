/**
 * A bulletin, against the real feeds and the real publishers.
 *
 * The unit tests cover both writers and the source with stories handed to them, because that half
 * is pure and deserves to be tested without a network. What they cannot cover is the half this
 * script exists for: whether the STORY behind a headline actually arrives on this install.
 * Specifically —
 *
 * - whether the operator's feed carries anything beyond titles, which most do not;
 * - whether the article pages are reachable, which needs this plugin listed under
 *   `plugins.unrestrictedNetwork` because the stories live on a different host from the feed;
 * - what the floor would say with what came back, which is the read a listener gets whenever the
 *   model declines, is slow, or is not configured at all.
 *
 * It reads. It writes no row, drives no transport and puts nothing on air, so it is safe against a
 * station that is broadcasting. It does make real requests to the operator's own publishers, at the
 * same pace and through the same allowlist the station uses, because that is the thing being tested.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/news.smoke.ts
 *
 * The model binding is deliberately NOT run: it would spend a model slot and answer differently
 * every time, and what is worth checking here is the substrate both writers share. What the model
 * would be shown is printed instead, which is the thing to read when a bulletin comes out oddly.
 */
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { ConsoleLogger, type Logger } from '@maroonedsoftware/logger';
import { Kysely, PostgresDialect } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';
import type { NewsItem, PluginHost, PluginManifest } from '@deadair/plugin-sdk';
import { RssPlugin } from '../../../plugins/rss/src/rss.plugin.js';
import { rssManifest } from '../../../plugins/rss/src/rss.manifest.js';

import type { DB } from '../src/modules/data/db.js';
import { settingsConfigSource } from '../src/server/settings.config.source.js';
import { BulletinSource } from '../src/modules/director/bulletin.source.js';
import { breakPrompt } from '../src/modules/director/break.prompt.js';
import { NEWS_KIND, NewsBreakWriter } from '../src/modules/director/news.break.writer.js';
import { NEWS_MAX_WORDS, NEWS_SHAPE } from '../src/modules/director/model.news.break.writer.js';
import { isPrivateAddress, PLUGIN_NETWORK_KEYS } from '../src/modules/plugins/plugin.network.policy.js';
import type { NewsService } from '../src/modules/news/news.service.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
const loud = new ConsoleLogger();

// The same two-step build `setup.server.ts` does. `deadair.settings` is a LAYER of the config, and
// every number this script reports — how many stories, how old is too old, which feed — lives there.
const boot = await new AppConfigBuilder()
    .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
    .addResolver(new AppConfigResolverEnv())
    .buildSnapshot();

const config = (
    await new AppConfigBuilder()
        .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
        .addSource(settingsConfigSource(boot, quiet))
        .addResolver(new AppConfigResolverEnv())
        .buildStore(quiet)
).toLiveConfig();

const pool = new KyselyPool({
    host: config.get('DATABASE_HOST', ''),
    port: config.get('DATABASE_PORT', 55432),
    user: config.get('DATABASE_USER', ''),
    password: config.get('DATABASE_PASSWORD', ''),
    database: config.get('DATABASE_NAME', ''),
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), plugins: [...KyselyDefaultPlugins] });

const manifest: PluginManifest = rssManifest;

/** The plugin's own row, as the operator saved it. */
const pluginConfig = await db.selectFrom('deadair.pluginConfigs').select('config').where('pluginId', '=', manifest.id).executeTakeFirst();

if (pluginConfig === undefined) {
    console.log(`no configuration for ${manifest.id}. Point it at a feed on the plugins page first.`);
    await db.destroy();
    process.exit(0);
}

const settings = pluginConfig.config as Record<string, unknown>;
const unrestricted = String(config.get(PLUGIN_NETWORK_KEYS.unrestricted, ''))
    .split('\n')
    .map(line => line.trim().toLowerCase())
    .includes(manifest.id.toLowerCase());

/**
 * A host with the real policy, built by hand.
 *
 * `verify.speech.ts`'s approach and for its reason: the whole DI stack is not needed to ask one
 * plugin one question, and building it here would mean the script tested the container rather than
 * the publisher. The allowlist is the REAL one, resolved the way `PluginHostFactory` resolves it,
 * because whether a story is reachable is the question.
 */
const allowed = new Set(
    String(settings.feeds ?? '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'))
        .map(line => line.slice(line.lastIndexOf('|') + 1).trim())
        .flatMap(address => {
            try {
                return [new URL(address.includes('://') ? address : `https://${address}`).hostname.toLowerCase()];
            } catch {
                return [];
            }
        }),
);

const host: PluginHost = {
    logger: loud,
    fetch: async (url: string, init?: { headers?: Record<string, string> }) => {
        const target = new URL(url);
        const hostname = target.hostname.toLowerCase();
        const permitted = allowed.has(hostname) || (unrestricted && !isPrivateAddress(hostname));
        if (!permitted) throw new Error(`refused: "${hostname}" is not on the allowlist and ${manifest.id} is not unrestricted`);

        return fetch(target, { headers: { 'user-agent': `${manifest.id}/${manifest.version} (deadair)`, ...init?.headers } });
    },
    signal: new AbortController().signal,
    // A background job's budget rather than a break's, because that is what a planted bulletin gets:
    // `WriteBreakJob` runs off the queue and not inside a request.
    remainingMs: () => 30_000,
    config: { get: async () => settings },
} as unknown as PluginHost;

const plugin = new RssPlugin();
await plugin.init(host);
console.log(`reading ${allowed.size} feed(s)…`);

/**
 * `NewsService` reduced to the one method the source calls.
 *
 * The service's own job is to enumerate several plugins and qualify their ids, which is not what is
 * being tested — one plugin, one feed list, and the same shapes on the way out.
 */
const news = {
    hasNews: () => true,
    fetchItems: async (query: { feedId?: string; limit: number; since?: string }): Promise<NewsItem[]> =>
        plugin.fetchItems({
            ...(query.feedId === undefined ? {} : { feedId: query.feedId.split(':').slice(1).join(':') }),
            limit: query.limit,
            ...(query.since === undefined ? {} : { since: query.since }),
        }),
} as unknown as NewsService;

const stories = (await new BulletinSource(news, config, loud).storiesFor(NEWS_KIND)) ?? [];

console.log(`\n${manifest.id}: ${allowed.size} feed host(s), unrestricted=${unrestricted}, stories=${settings.fetchArticles !== false}`);
console.log(`${stories.length} stor${stories.length === 1 ? 'y' : 'ies'} for a bulletin\n`);

for (const [at, story] of stories.entries()) {
    console.log(`  ${at + 1}. ${story.headline}`);
    console.log(`     teaser:  ${story.summary ?? '—'}`);
    console.log(`     story:   ${story.body === undefined ? '— (headline only: no article was read)' : `${story.body.slice(0, 200)}…`}`);
    console.log('');
}

const floor = await new NewsBreakWriter(config, loud).write({ kind: NEWS_KIND, stories, station: config.get('STREAM_TITLE', 'Deadair') });

console.log('─ what the floor would say ─────────────────────────────────────────');
console.log(floor?.script ?? '(nothing: the floor declined, so the station would pass over the slot)');

const prompt = breakPrompt(
    { kind: NEWS_KIND, stories, station: config.get('STREAM_TITLE', 'Deadair') },
    { station: config.get('STREAM_TITLE', 'Deadair'), dj: '', maxWords: NEWS_MAX_WORDS },
    NEWS_SHAPE,
);

console.log('\n─ what the model would be shown ────────────────────────────────────');
console.log(prompt.map(message => `[${message.role}]\n${message.content}`).join('\n\n'));

await plugin.dispose();
await db.destroy();
