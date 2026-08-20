/**
 * The topics table, against the real database.
 *
 * Two things here are worth a real database and nothing else is: the unique key per KIND, which is
 * what stops one station holding two `technology` categories that anything pointing at one of them
 * would have to choose between; and the `config` round trip, which is a jsonb column holding a shape
 * this chassis deliberately knows nothing about, so "what went in comes back" is the whole contract
 * it offers the kind that wrote it.
 *
 * It WRITES, and cleans up after itself in a `finally`: everything it creates is under one kind and
 * is deleted at the end whichever way the run goes.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/topics.smoke.ts
 */
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { Kysely, PostgresDialect } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';

import type { DB } from '../src/modules/data/db.js';
import { TopicRepository } from '../src/modules/topics/topic.repository.js';
import { StationIdentity } from '../src/modules/shared/station.identity.js';

/** Everything this run writes carries it, so the cleanup can be one statement. */
const KIND = 'smoke-topic-kind';

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

const topics = new TopicRepository(db, new StationIdentity());

let failures = 0;
const check = (ok: boolean, said: string): void => {
    console.log(`  ${ok ? '✓' : '✗'} ${said}`);
    if (!ok) failures += 1;
};

try {
    console.log('topics');

    // ── what goes in comes back, config included ──────────────────────────────
    const settings = { feeds: ['deadair.rss:tech'], words: ['ai', 'chip'], depth: 3, on: true };
    const tech = await topics.create({ kind: KIND, key: 'technology', label: 'Technology', config: settings, position: 0 });
    const local = await topics.create({ kind: KIND, key: 'local', label: 'Round here', config: {}, position: 1 });

    // Compared field by field rather than as one string: `jsonb` stores an object rather than the
    // text it arrived as, so it is free to hand the keys back in another order. What is promised
    // here is the VALUES, which is all a kind reads.
    check(
        JSON.stringify(tech.config.feeds) === JSON.stringify(settings.feeds) &&
            JSON.stringify(tech.config.words) === JSON.stringify(settings.words) &&
            tech.config.depth === settings.depth &&
            tech.config.on === settings.on,
        "a kind's own settings survive the round trip whole, lists and numbers and flags alike",
    );
    check(Object.keys(local.config).length === 0, 'and a subject nobody has configured comes back with none, rather than null');

    // ── one key per kind ──────────────────────────────────────────────────────
    const twice = await topics
        .create({ kind: KIND, key: 'technology', label: 'Tech again', config: {}, position: 2 })
        .then(() => false)
        .catch(() => true);
    check(twice, 'two subjects of one kind cannot share a key');

    const elsewhere = await topics.create({ kind: `${KIND}-other`, key: 'technology', label: 'Technology', config: {}, position: 0 });
    check(elsewhere.key === 'technology', 'but another sort of break may use the same word');

    // ── the operator's order, and one kind at a time ──────────────────────────
    const ours = await topics.list(KIND);
    check(ours.map(topic => topic.key).join() === 'technology,local', 'the list comes back in the order they were put in');
    check(ours.length === 2, 'and asking for one kind answers with that kind alone');
    check((await topics.countFor(KIND)) === 2, 'a seeder can ask whether this station holds any');

    // ── editing and deleting ──────────────────────────────────────────────────
    const renamed = await topics.update(local.id, { kind: KIND, key: 'local', label: 'Atlanta', config: { place: 'Atlanta, GA' }, position: 1 });
    check(renamed?.label === 'Atlanta' && renamed.config.place === 'Atlanta, GA', 'a subject can be rewritten, settings and all');
    check(
        (await topics.update('00000000-0000-0000-0000-000000000000', renamed!)) === undefined,
        'and one this station does not have answers nothing',
    );

    check(await topics.remove(tech.id), 'a subject this station has can be deleted');
    check(!(await topics.remove(tech.id)), 'and deleting it twice is not an error the second time');

    console.log(failures === 0 ? '\nall good' : `\n${failures} problem${failures === 1 ? '' : 's'}`);
} finally {
    // Everything under one kind, deleted whichever way the run went: this script writes to the same
    // database an operator is running a station on.
    await db
        .deleteFrom('deadair.topics')
        .where('kind', 'in', [KIND, `${KIND}-other`])
        .execute();
    await db.destroy();
}

process.exit(failures === 0 ? 0 : 1);
