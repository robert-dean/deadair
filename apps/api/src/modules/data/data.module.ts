import { Container, Registry } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { Heartbeat } from '#modules/shared/heartbeat.js';
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

        // The runtime query pool connects as the non-owner `app_user` role where one is configured,
        // so the RLS policies actually enforce (the table owner bypasses them) and falls back to
        // the owner otherwise. dbmate (migrations) and pg-boss (queue-schema management, see
        // JobsModule) keep their own owner connections.
        //
        // Which role that is gets decided in one place rather than here, because there are now two
        // callers of the answer: this pool, and the settings config source that reads
        // `deadair.settings` in `setup.server.ts` before any pool exists.
        const dbConfig = { ...resolveRuntimeConnection(config), ...poolTuning, types: KyselyPgTypeOverrides };

        registry
            .register(KyselyPool)
            .useFactory(container => {
                const pool = new KyselyPool(dbConfig);
                const logger = container.get(Logger);
                pool.on('error', err => {
                    logger.error(`db: pool error: ${errorText(err)}`);
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
                        logger.error(`db: query failed: ${errorText(event.error)}`, {
                            sql: event.query.sql,
                            parameters: event.query.parameters,
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
    },
};

/**
 * Closing the pools, which is deliberately NOT part of {@link DataModule}.
 *
 * ServerKit walks one list for both directions, so shutdown runs in registration order — and
 * registration order is a DEPENDENCY order, which is exactly backwards for teardown. `DataModule`
 * has to be first, so its shutdown was first too: the database and Redis closed while every module
 * that depends on them was still running, and each of those then tore down against a pool that had
 * already gone.
 *
 * That is not hypothetical. `DirectorService` writes the running order down on shutdown — the
 * guarantee is that a graceful stop flushes what memory holds — and it logged
 * `could not write the running order down (driver has already been destroyed)` on nine of the
 * shutdowns in this install's log. The write was lost every one of those times, silently as far as
 * anything but that line was concerned.
 *
 * So the REGISTRATION stays first and the CLOSE moves to the end of the list, one place ahead of
 * `LoggingModule`, which still has to be last so this module's own two lines are flushed. Nothing
 * else changes: same container, same instances, same order for setup, start and ready.
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
