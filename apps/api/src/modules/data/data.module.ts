import { Container, Registry } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { AfterCommit } from './after.commit.js';
import { DB } from './db.js';
import { Kysely, type LogEvent } from 'kysely';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Redis } from 'ioredis';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { EmptyUpdateRewriteDialect, KyselyPool, KyselyDefaultPlugins, KyselyPgTypeOverrides } from '@maroonedsoftware/kysely';
import { CacheProvider } from '@maroonedsoftware/cache';
import { IoRedisCacheProvider } from '@maroonedsoftware/cache/ioredis';

const queryErrorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const DataModule: ServerKitModule = {
    name: 'Data',
    setup: async (registry: Registry, config: AppConfig) => {
        // Runtime query pool. When DATABASE_APP_USER is configured we connect as
        // the non-owner `app_user` role so the org-isolation RLS policies
        // actually enforce (the table owner bypasses RLS). dbmate (migrations)
        // and pg-boss (queue-schema management, see JobsModule) keep their own
        // owner connections via DATABASE_USER. Falls back to the owner when
        // app_user isn't configured.
        const appUser = config.get('DATABASE_APP_USER', '');
        const useAppUser = !!appUser;
        // The owner connection details (DATABASE_USER). When app_user is
        // configured the runtime pool uses app_user; the MaintenanceDb pool
        // always uses these owner details for privileged ops.
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

        const ownerConfig = {
            host: config.get('DATABASE_HOST', ''),
            port: config.get('DATABASE_PORT', 55432),
            user: config.get('DATABASE_USER', ''),
            password: config.get('DATABASE_PASSWORD', ''),
            database: config.get('DATABASE_NAME', ''),
            types: KyselyPgTypeOverrides,
        };
        const dbConfig = {
            ...ownerConfig,
            ...poolTuning,
            user: useAppUser ? appUser : ownerConfig.user,
            password: useAppUser ? config.get('DATABASE_APP_PASSWORD', '') : ownerConfig.password,
        };

        registry
            .register(KyselyPool)
            .useFactory(container => {
                const pool = new KyselyPool(dbConfig);
                const logger = container.get(Logger);
                pool.on('error', err => {
                    logger.error(`db: pool error: ${queryErrorText(err)}`);
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
                        logger.error(`db: query failed: ${queryErrorText(event.error)}`, {
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
                    logger.error(`redis: ${queryErrorText(err)}`);
                });
                return redis;
            })
            .asSingleton();

        registry.register(CacheProvider).useClass(IoRedisCacheProvider).asScoped();

        // Scoped because it holds one request's follow-up work: the transaction it
        // waits on is this request's, opened and committed by
        // `audit.context.middleware`, which is also the only thing that runs it.
        registry.register(AfterCommit).useClass(AfterCommit).asScoped();
    },
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
