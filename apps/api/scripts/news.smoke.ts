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
 *   the `network.open` grant, because the stories live on a different host from the feed;
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
import { BulletinSource, CategoryWatch, ReadLog } from '../src/modules/director/bulletin.source.js';
import type { ActivityRecorder } from '../src/modules/activity/activity.recorder.js';
import { breakPrompt } from '../src/modules/director/break.prompt.js';
import { NEWS_KIND, NewsBreakWriter } from '../src/modules/director/news.break.writer.js';
import { NEWS_MAX_WORDS, NEWS_SHAPE } from '../src/modules/director/model.news.break.writer.js';
import { isPrivateAddress, NETWORK_OPEN } from '../src/modules/plugins/plugin.grants.js';
import type { NewsService } from '../src/modules/news/news.service.js';
import { categoriesOf, newsTopicRules } from '../src/modules/news/news.classify.js';
import { TopicRepository } from '../src/modules/topics/topic.repository.js';
import { StationIdentity } from '../src/modules/shared/station.identity.js';

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
// The real grant, read from the real table, because whether the stories are reachable is the
// question. `undefined` and `denied` are the same answer here and differ only on the settings page.
const granted = await db
    .selectFrom('deadair.pluginGrants')
    .select('decision')
    .where('pluginId', '=', manifest.id)
    .where('capability', '=', NETWORK_OPEN)
    .executeTakeFirst();

const allowsOpenWeb = granted?.decision === 'allowed';

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
        const permitted = allowed.has(hostname) || (allowsOpenWeb && !isPrivateAddress(hostname));
        if (!permitted) throw new Error(`refused: "${hostname}" is not on the allowlist and ${manifest.id} does not hold ${NETWORK_OPEN}`);

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

// The station's own categories, read once. They decide two things below: which category each story
// belongs to, and — for a run given one on the command line — which stories a bulletin about it
// would have.
const topics = new TopicRepository(db, new StationIdentity());
const rules = (await topics.list(NEWS_KIND)).map(newsTopicRules);

/**
 * The category to write a bulletin about, from the command line.
 *
 * `node ./scripts/news.smoke.ts technology` is the run that answers "would the half-past technology
 * bulletin have anything to read", which is the question a band with a category on it raises and
 * which nothing else here can answer.
 */
const wanted = process.argv[2]?.trim();
const asked = wanted === undefined || wanted.length === 0 ? undefined : { topic: wanted };

// A fresh `ReadLog`, which is what makes this a smoke test of the FEED rather than of the station's
// memory: in the app it is a singleton holding what the last bulletins said, and one run of a script
// has nothing to have said before.
const watch = new CategoryWatch({ record: async () => {} } as unknown as ActivityRecorder, loud);
const bulletin = await new BulletinSource(news, new ReadLog(), topics, watch, config, loud).storiesFor(NEWS_KIND, asked);
const stories = bulletin?.stories ?? [];

console.log(
    `\n${manifest.id}: ${allowed.size} feed host(s), ${NETWORK_OPEN}=${granted?.decision ?? 'undecided'}, stories=${settings.fetchArticles !== false}`,
);
console.log(
    `${stories.length} stor${stories.length === 1 ? 'y' : 'ies'} for a bulletin${bulletin?.subject === undefined ? '' : ` about ${bulletin.subject.label}`}\n`,
);

for (const [at, story] of stories.entries()) {
    console.log(`  ${at + 1}. ${story.headline}`);
    console.log(`     teaser:  ${story.summary ?? '—'}`);
    console.log(`     story:   ${story.body === undefined ? '— (headline only: no article was read)' : `${story.body.slice(0, 200)}…`}`);
    console.log('');
}

// ── the categories, against real headlines ──────────────────────────────────────
//
// The classifier is pure and is unit-tested, so what is checked here is the thing a table test
// cannot see: whether the operator's OWN feeds carry the labels the seeded categories are written
// against. A run where every story comes back uncategorised means the categories are word lists
// against publishers who tag nothing — which is the state where a band asking for one is silent, so
// it is worth seeing before it is heard.
const page = await news.fetchItems({ limit: 25 });

console.log(`─ categories (${rules.length} on this station, ${page.length} stories read) ───────────────`);
for (const item of page) {
    const found = categoriesOf({ ...item, feedId: `${manifest.id}:${item.feedId}` }, rules);
    const said = found.length === 0 ? 'nothing' : found.map(match => `${match.key} (${match.rank})`).join(', ');
    console.log(`  ${said.padEnd(34)} ${item.title.slice(0, 70)}`);
}
console.log('');

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
