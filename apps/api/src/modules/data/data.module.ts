import { Container, Registry } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { BuildRevision, buildRevision, buildVersion } from '#modules/shared/build.revision.js';
import { Heartbeat } from '#modules/shared/heartbeat.js';
import { StationBus } from '#modules/shared/station.bus.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { AfterCommit } from './after.commit.js';
import { DB } from './db.js';
import { Kysely, type LogEvent } from 'kysely';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Redis } from 'ioredis';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { EmptyUpdateRewriteDialect, KyselyPool, KyselyDefaultPlugins, KyselyPgTypeOverrides } from '@maroonedsoftware/kysely';
import { CacheProvider } from '@maroonedsoftware/cache';
import { resolveRuntimeConnection } from './database.connection.js';
import { IoRedisCacheProvider } from '@maroonedsoftware/cache/ioredis';
import { errorText } from '#modules/shared/error.text.js';

export const DataModule: ServerKitModule = {
    name: 'Data',
    setup: async (registry: Registry, config: AppConfig) => {
        // Pool tunables. Each HTTP request holds a connection for its whole lifetime (one
        // transaction per request), so an unbounded acquire wait (pg default) means a burst of
        // slow requests queues forever with no signal. Cap the pool and time out acquisition.
        // KyselyPool extends pg.Pool, so these are standard pg.PoolConfig options.
        const numberOr = (key: string, fallback: number): number => {
            const raw = config.get(key, fallback);
            const parsed = raw ? Number(raw) : NaN;
            return Number.isFinite(parsed) ? parsed : fallback;
        };
        const runtimePoolMax = numberOr('DATABASE_POOL_MAX', 10);
        const poolTuning = {
            max: runtimePoolMax,
            connectionTimeoutMillis: numberOr('DATABASE_POOL_CONNECTION_TIMEOUT_MS', 10_000),
            idleTimeoutMillis: numberOr('DATABASE_POOL_IDLE_TIMEOUT_MS', 10_000),
        };

        // The database's own backstop on a connection this process has stopped using, and NOT the
        // same thing as `idleTimeoutMillis` above however alike the two read: that one retires a
        // client sitting unused IN THE POOL, which is a connection nobody is holding. This one ends
        // a session sitting idle INSIDE A TRANSACTION, which is a connection somebody is holding and
        // has stopped doing anything with.
        //
        // Nothing else in the process ends that. Every non-exempt request opens a transaction in
        // `audit.context.middleware` and holds one of `max` connections for its whole lifetime, and
        // `connectionTimeoutMillis` bounds only how long a request waits FOR a connection, never how
        // long one may be held. So a handler that wedges awaiting something that never answers takes
        // a pool slot out of circulation for the life of the process, and ten of those are the whole
        // pool. That is the shape the art-thumbnail burst took in `transaction.exemptions.ts`,
        // except that one at least ended.
        //
        // Ten minutes, which is a recovery rather than a tight backstop, and deliberately still that
        // loose after the four routes that made it necessary stopped needing it. Drafting a persona,
        // rehearsing one, and the voice samples and speech preview all held a connection across a
        // language model or a speech engine, up to five minutes for the longest; all four are now
        // exempt from the request transaction entirely (`transaction.exemptions.ts`), because not
        // one of them had anything for a transaction to make atomic.
        //
        // What is left is an audit rather than a known offender: every route-reachable service was
        // checked for model and engine work when those exemptions were written and none of the rest
        // hold either, but "nothing found" is a weaker claim than "nothing can", and a figure that
        // kills a request wrongly is worse than one that recovers a connection slowly. So tightening
        // this wants a measurement of what the request path actually holds, not another reading of
        // the routers.
        //
        // Deliberately NOT joined by a `statement_timeout` or a `lock_timeout`. Background jobs run
        // on this same pool, so both of those trade a hang nobody has measured for a new way to kill
        // work that is going fine, and the one lock-wait hang this codebase has actually measured
        // (`plugins.service.ts`, the reinit that blocked on the request's own lock) was fixed by not
        // making the call rather than by bounding it.
        //
        // Sent as a startup parameter rather than a `SET` on connect, so it is in force on the first
        // statement of every connection this pool opens with no round trip of its own, and it
        // reaches only this pool: dbmate and pg-boss hold owner connections built elsewhere.
        const idleInTransactionMs = Math.round(numberOr('DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS', 600_000));
        const startupOptions = idleInTransactionMs > 0 ? { options: `-c idle_in_transaction_session_timeout=${idleInTransactionMs}` } : {};

        // The runtime query pool connects as the non-owner `app_user` role where one is configured,
        // falling back to the owner otherwise. dbmate (migrations) and pg-boss (queue-schema
        // management, see JobsModule) keep their own owner connections.
        //
        // The role is created `nobypassrls` and holds only DML grants, so it is the role RLS would
        // apply to IF any existed. None does today — no migration declares a policy — so what the
        // split currently buys is the narrower thing: the runtime path cannot DDL, and the seam is
        // in place for the day the policies are written. See [row-level-security](https://github.com/robert-dean/deadair/discussions/31).
        //
        // Which role that is gets decided in one place rather than here, because there are now two
        // callers of the answer: this pool, and the settings config source that reads
        // `deadair.settings` in `setup.server.ts` before any pool exists.
        const dbConfig = { ...resolveRuntimeConnection(config), ...poolTuning, ...startupOptions, types: KyselyPgTypeOverrides };

        registry
            .register(KyselyPool)
            .useFactory(container => {
                const pool = new KyselyPool(dbConfig);
                const logger = container.get(Logger);
                pool.on('error', err => {
                    logger.error(`db: pool error: ${errorText(err)}`);
                });
                // The handler above covers a connection sitting IDLE IN THE POOL and nothing else,
                // which is not where the interesting failure happens. `pg-pool` attaches its own
                // error listener when a connection is released and REMOVES it again when one is
                // checked out, so for the whole time a request is holding a connection there is no
                // listener on it at all. An `'error'` event with no listener is not an error in
                // Node, it is `throw`, from an event handler, with no request to attribute it to.
                //
                // That is not a hypothetical either, and it is specifically the failure mode of the
                // `idle_in_transaction_session_timeout` set above: the timeout does not make the next
                // query fail, it makes the SERVER hang up (`FATAL 25P03`), which arrives
                // asynchronously on a connection somebody is holding and nobody is listening to.
                // Measured against this install's database, at a one second timeout, in exactly the
                // shape used here (Kysely, this pool, the handler above already registered): the API
                // process died on an unhandled `'error'` event. Turning one wedged connection into a
                // dead station is not a trade worth making, so the timeout does not ship without
                // this.
                //
                // Attached on `'connect'` because that is once per real connection and `pg-pool`
                // only ever removes its OWN listener, so this one survives every checkout the
                // connection goes through. What it buys is what the same measurement showed with it
                // in place: the process lives, the held transaction rejects with something a handler
                // can turn into a 500, and the pool discards the dead connection and opens a fresh
                // one on demand. A connection that fails while idle now says so twice, once here and
                // once above, which is a small price for the two being genuinely different events.
                pool.on('connect', client => {
                    client.on('error', err => {
                        logger.error(`db: connection error: ${errorText(err)}`);
                    });
                });
                return pool;
            })
            .asSingleton();

        registry
            .register(Kysely<DB>)
            .useFactory(container => {
                const pool = container.get(KyselyPool);
                const logger = container.get(Logger);
                const dialect = new EmptyUpdateRewriteDialect({ pool }, logger);
                return new Kysely<DB>({
                    dialect,
                    plugins: [...KyselyDefaultPlugins],
                    log: (event: LogEvent) => {
                        if (event.level !== 'error') return;
                        // The SQL, not just the message. `logger.error(event.error)` alone
                        // renders as a bare `Error: <message>` with no query, no parameters
                        // and no stack, which is how "Transaction is already committed" sat
                        // in the log on every boot for days without anyone being able to
                        // say which statement caused it.
                        //
                        // The SQL and how many parameters it took, and NOT the parameters. They are
                        // the row's values, and the rows that fail are exactly the ones nobody wants
                        // in a log: a constraint violation on `actors_password_factors` carries the
                        // hash and salt, one on `plugin_configs` the secrets map, one on `settings`
                        // a secret's ciphertext, and a session insert its token. The store's
                        // redaction is keyed on the meta KEY (`token`, `secret`, `password`...), which
                        // `parameters` matches nothing in, and the stdout copy has no redaction at
                        // all — so for as long as they were here every one of those landed in
                        // `docker logs` and in the file `/logs` serves. The count still says which
                        // statement it was when the SQL alone is ambiguous.
                        logger.error(`db: query failed: ${errorText(event.error)}`, {
                            sql: event.query.sql,
                            parameterCount: event.query.parameters.length,
                            durationMs: Math.round(event.queryDurationMillis),
                        });
                    },
                });
            })
            .asSingleton();

        registry
            .register(Redis)
            .useFactory(container => {
                const logger = container.get(Logger);
                const redis = new Redis({
                    host: config.get('REDIS_HOST', 'localhost'),
                    port: config.get('REDIS_PORT', 6379),
                    enableOfflineQueue: false,
                });
                redis.on('error', err => {
                    logger.error(`redis: ${errorText(err)}`);
                });
                return redis;
            })
            .asSingleton();

        registry.register(CacheProvider).useClass(IoRedisCacheProvider).asScoped();

        // Scoped because it holds one request's follow-up work: the transaction it
        // waits on is this request's, opened and committed by
        // `audit.context.middleware`, which is also the only thing that runs it.
        registry.register(AfterCommit).useClass(AfterCommit).asScoped();

        // Which of the station's timer loops are still going round. Nothing to do with
        // data, and it is registered here anyway because this is the chassis module and
        // it has to be in front of everyone: the earliest loop is JobsModule's and the
        // reader is PlayoutModule's, which are six modules apart. A singleton, obviously
        // — a per-request copy would be a per-request empty map, so every loop would
        // read as one nobody registered.
        registry.register(Heartbeat).useClass(Heartbeat).asSingleton();

        // Which station, and which broadcast, the rows being written belong to. Registered here for
        // the same reason as the heartbeat above: the writer is the director, near the end of the
        // list, and the readers are in `render`, `catalog` and `activity`, all of them in front of
        // it. A singleton because there is one station airing one broadcast at a time, and a
        // per-request copy would answer `undefined` to every job that asked.
        registry.register(StationIdentity).useClass(StationIdentity).asSingleton();

        // The station's moments as they happen, for anything that wants to react to one. Registered
        // here for the same reason as the two above: its producers and its subscribers sit on
        // opposite sides of the module list — the audience watch is in `playout` and the thing that
        // acts on an arrival is in `director` — and neither may reach for the other.
        registry.register(StationBus).useClass(StationBus).asSingleton();

        // What this build was made from. Nothing to do with data either, and registered here on the
        // same argument as the three above: the value is resolved from config once and the readers
        // are scattered, so the chassis module is the one place already in front of all of them.
        // A singleton because it is one string that cannot change while the process runs — a
        // per-request copy would be a per-request re-read of a constant.
        registry
            .register(BuildRevision)
            .useFactory(() => new BuildRevision(buildRevision(config), buildVersion(config)))
            .asSingleton();
    },
};

/**
 * Closing the pools, which is deliberately NOT part of {@link DataModule}.
 *
 * ServerKit walks one list for both directions, tearing down in REVERSE registration order, so a
 * module closes while everything it depends on is still alive. That is the right default and it is
 * wrong for exactly this one: `DataModule` has to REGISTER early, because everything resolves what
 * it registers — and closing in its own position would make the pools among the LAST things to go
 * under a forward walk, or among the first under a backward one. Either way the database and Redis
 * shut while modules that depend on them were still tearing down, and each of those then ran against
 * a pool that had already gone.
 *
 * That is not hypothetical. `DirectorService` writes the running order down on shutdown — the
 * guarantee is that a graceful stop flushes what memory holds — and it logged
 * `could not write the running order down (driver has already been destroyed)` on nine of the
 * shutdowns in this install's log. The write was lost every one of those times, silently as far as
 * anything but that line was concerned.
 *
 * So the REGISTRATION of the pools stays where it is and the CLOSE is this separate module, put at
 * the very TOP of the list so the backward walk reaches it last — one place inside `LoggingModule`,
 * which is first for the same reason and so still flushes this module's own two lines. Nothing else
 * changes: same container, same instances, same order for setup, start and ready.
 *
 * Anything else that must outlive the modules using it belongs here rather than in a shutdown hook
 * of its own — which is the general form of the bug above, and the reason this is a named seam
 * instead of two lines moved into `LoggingModule`.
 */
export const DataConnectionsModule: ServerKitModule = {
    name: 'Connections',
    shutdown: async (container: Container) => {
        const logger = container.get(Logger);

        const redis = container.get(Redis);
        logger.info('Shutting down Redis');
        await redis.quit();

        const db = container.get(Kysely<DB>);
        logger.info('Shutting down Kysely');
        await db.destroy();
    },
};
