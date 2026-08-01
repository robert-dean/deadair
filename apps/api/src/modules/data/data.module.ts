import { Container, Registry } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { DB } from './db.js';
import { Kysely, type LogEvent } from 'kysely';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Redis } from 'ioredis';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { EmptyUpdateRewriteDialect, KyselyPool, KyselyDefaultPlugins, KyselyPgTypeOverrides } from '@maroonedsoftware/kysely';
import { CacheProvider } from '@maroonedsoftware/cache';
import { IoRedisCacheProvider } from '@maroonedsoftware/cache/ioredis';

export const DataModule: ServerKitModule = {
    name: 'Data',
    setup: async (registry: Registry, config: AppConfig) => {
        // Runtime query pool. When DATABASE_APP_USER is configured we connect as
        // the non-owner `app_user` role so the org-isolation RLS policies
        // actually enforce (the table owner bypasses RLS). dbmate (migrations)
        // and pg-boss (queue-schema management, see JobsModule) keep their own
        // owner connections via DATABASE_USER. Falls back to the owner when
        // app_user isn't configured — AppConfig.getString returns the literal
        // string "undefined" for an absent key, so guard against that.
        const appUser = config.getString('DATABASE_APP_USER');
        const useAppUser = !!appUser && appUser !== 'undefined';
        // The owner connection details (DATABASE_USER). When app_user is
        // configured the runtime pool uses app_user; the MaintenanceDb pool
        // always uses these owner details for privileged ops.
        // Pool tunables. Each HTTP request holds a connection for its whole lifetime (one
        // transaction per request), so an unbounded acquire wait (pg default) means a burst of
        // slow requests queues forever with no signal. Cap the pool and time out acquisition.
        // KyselyPool extends pg.Pool, so these are standard pg.PoolConfig options.
        const numberOr = (key: string, fallback: number): number => {
            const raw = config.get(key, '');
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
            host: config.getString('DATABASE_HOST'),
            port: config.getNumber('DATABASE_PORT'),
            user: config.getString('DATABASE_USER'),
            password: config.getString('DATABASE_PASSWORD'),
            database: config.getString('DATABASE_NAME'),
            types: KyselyPgTypeOverrides,
        };
        const dbConfig = {
            ...ownerConfig,
            ...poolTuning,
            user: useAppUser ? appUser : ownerConfig.user,
            password: useAppUser ? config.getString('DATABASE_APP_PASSWORD') : ownerConfig.password,
        };

        registry
            .register(KyselyPool)
            .useFactory(container => {
                const pool = new KyselyPool(dbConfig);
                const logger = container.get(Logger);
                pool.on('error', err => {
                    logger.error(err);
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
                        if (event.level === 'error') {
                            logger.error(event.error);
                        }
                    },
                });
            })
            .asSingleton();

        registry
            .register(Redis)
            .useFactory(container => {
                const logger = container.get(Logger);
                const redis = new Redis({
                    host: config.getString('REDIS_HOST'),
                    port: config.getNumber('REDIS_PORT'),
                    enableOfflineQueue: false,
                });
                redis.on('error', err => {
                    logger.error(err);
                });
                return redis;
            })
            .asSingleton();

        registry.register(CacheProvider).useClass(IoRedisCacheProvider).asScoped();
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
