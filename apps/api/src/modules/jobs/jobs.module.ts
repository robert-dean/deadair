import { Container, Registry } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { JobBroker, JobRunner } from '@maroonedsoftware/jobbroker';
import {
    KyselyTransactionConnectionProvider,
    PgBossConnectionProvider,
    PgBossJobBroker,
    PgBossJobRegistryMap,
    PgBossJobRunner,
} from '@maroonedsoftware/jobbroker/pgboss';
import { PgBoss } from 'pg-boss';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { JobMappings } from './job.mappings.js';
import { Logger } from '@maroonedsoftware/logger';

export const JobsModule: ServerKitModule = {
    name: 'Jobs',
    setup: async (registry: Registry, config: AppConfig) => {
        const dbConfig = {
            host: config.get('DATABASE_HOST', ''),
            port: config.get('DATABASE_PORT', 55432),
            user: config.get('DATABASE_USER', ''),
            password: config.get('DATABASE_PASSWORD', ''),
            database: config.get('DATABASE_NAME', ''),
        };

        registry
            .register(PgBoss)
            .useFactory(container => {
                const pgBoss = new PgBoss(dbConfig);
                pgBoss.on('error', err => {
                    container.get(Logger).error(err);
                });
                return pgBoss;
            })
            .asSingleton();

        const jobRegistry = new PgBossJobRegistryMap();
        for (const [name, job] of Object.entries(JobMappings)) {
            jobRegistry.set(name, job);
            registry.register(job).useClass(job).asTransient();
        }

        registry.register(PgBossJobRegistryMap).useInstance(jobRegistry);
        registry.register(PgBossConnectionProvider).useClass(KyselyTransactionConnectionProvider).asSingleton();

        // Two brokers, by lifetime:
        //  - PgBossJobBroker (singleton): for non-request callers — bootstrap
        //    scheduling in start() hooks, job workers. Resolves the default
        //    provider → pg-boss's own pool.
        //  - JobBroker → PgBossJobBroker (scoped): what request-path services
        //    inject. Created per request scope so it picks up the overridden,
        //    transaction-bound connection provider. Must NOT be resolved at the
        //    root container, or request scopes would inherit a root-cached,
        //    non-transactional instance.
        registry.register(PgBossJobBroker).useClass(PgBossJobBroker).asSingleton();
        registry.register(JobBroker).useClass(PgBossJobBroker).asScoped();
        registry
            .register(JobRunner)
            .useFactory(container => {
                const runner = new PgBossJobRunner(container, container.get(PgBossJobRegistryMap), container.get(PgBoss), container.get(Logger));
                return runner;
            })
            .asSingleton();
    },
    shutdown: async (container: Container) => {
        const jobRunner = container.get(JobRunner);
        await jobRunner.stop();
    },
    start: async (container: Container) => {
        const jobRunner = container.get(JobRunner);
        await jobRunner.start();
    },
};
