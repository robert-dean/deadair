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
import { JobMappings, jobClassOf } from './job.mappings.js';
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

        // A mapping is either the bare job class or `{ job, cron, policy }`; the
        // registry takes both, but the container has to be handed the class
        // either way, so unwrap before registering.
        const jobRegistry = new PgBossJobRegistryMap();
        for (const [name, mapping] of Object.entries(JobMappings)) {
            jobRegistry.set(name, mapping);
            const jobClass = jobClassOf(mapping);
            registry.register(jobClass).useClass(jobClass).asTransient();
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
        registry.register(JobRunner).useClass(PgBossJobRunner).asSingleton();
    },
    // `ready`, not `start`. Nothing the first request does depends on a worker
    // being up, so consuming belongs after the socket is bound. It also buys
    // ordering: the ready phase runs only once EVERY module's `start` has
    // settled, so by the time workers begin dequeuing, PluginsModule.start has
    // populated PluginRegistry. In `start` the two race, and a job left over
    // from the previous boot could dequeue against an empty registry and record
    // a failure that says nothing about the plugin.
    //
    // Ready hooks still run in registration order, and this module precedes
    // PluginsModule, so plugins are discovered but not yet INITIALIZED here. A
    // job that calls into a plugin has to tolerate a non-active one regardless
    // (a plugin can be disabled, quarantined or reinitializing at any moment),
    // so that residual gap is the same case, not a new one. The position is
    // fixed by shutdown, which also runs in registration order: workers must
    // stop consuming before PluginsModule disposes the instances under them.
    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        const jobRunner = container.get(JobRunner);
        await jobRunner.start();
    },
    shutdown: async (container: Container) => {
        const jobRunner = container.get(JobRunner);
        await jobRunner.stop();
    },
};
