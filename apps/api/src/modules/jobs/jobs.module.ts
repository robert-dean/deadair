import { Container, Registry } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { JobBroker, JobRunner, registerJobContext } from '@maroonedsoftware/jobbroker';
import { PgBossConnectionProvider, PgBossJobBroker, PgBossJobRegistryMap, PgBossJobRunner } from '@maroonedsoftware/jobbroker/pgboss';
import { TracingJobBroker } from './tracing.job.broker.js';
import { PgBoss } from 'pg-boss';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { JobMappings, jobClassOf } from './job.mappings.js';
import { Logger } from '@maroonedsoftware/logger';
import { resolveOwnerConnection } from '#modules/data/database.connection.js';
import { serverkitErrorText } from '#modules/shared/error.text.js';

export const JobsModule: ServerKitModule = {
    name: 'Jobs',
    setup: async (registry: Registry, config: AppConfig) => {
        // The owner role, through the one function that decides connection identity. pg-boss owns
        // its own schema and runs its own migrations, which is why it is the owner rather than the
        // runtime role — and `resolveOwnerConnection`'s doc has named pg-boss as a caller since it
        // was written, while this rebuilt the same five fields inline and was not one.
        const dbConfig = resolveOwnerConnection(config);

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

        // `Registry.build()` rejects a service whose dependency has no
        // registration, and the runner's per-execution JobContext override only
        // exists at runtime, inside the scope. This registers the placeholder
        // that satisfies the up-front check and throws if anything resolves
        // JobContext outside a job. TransactionalJob depends on it.
        registerJobContext(registry);

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
        // The BASE provider at the root, whose executor answers `undefined` — pg-boss's own pool.
        // The transaction-bound subclass is installed per request, as an override, by
        // audit.context.middleware; registering it here as well looked like belt and braces and was
        // the opposite. Constructed at the root it has no transaction to bind to, so every
        // non-request caller got a provider that threw on `withoutPlugins` of undefined — which is
        // exactly the set of callers the two-broker split below exists to serve.
        //
        // It failed silently in the one place it mattered most: the director asks for a refill when
        // a lineup runs short, off the request path, and that send threw every time. A station that
        // reached the end of its programming stayed there.
        registry.register(PgBossConnectionProvider).useClass(PgBossConnectionProvider).asSingleton();

        // Two brokers, by lifetime:
        //  - PgBossJobBroker (singleton): for non-request callers — bootstrap
        //    scheduling in start() hooks, job workers. Resolves the default
        //    provider → pg-boss's own pool.
        //  - JobBroker → PgBossJobBroker (scoped): what request-path services
        //    inject. Created per request scope so it picks up the overridden,
        //    transaction-bound connection provider. Must NOT be resolved at the
        //    root container, or request scopes would inherit a root-cached,
        //    non-transactional instance.
        //
        // Both resolve to `TracingJobBroker`, which is `PgBossJobBroker` plus the parent-trace
        // stamp. Registered under the base token as well as its own so that the twenty-odd callers
        // typed against `PgBossJobBroker` get it without being touched — see that class for why the
        // link cannot be a call-site responsibility.
        registry.register(PgBossJobBroker).useClass(TracingJobBroker).asSingleton();
        registry.register(JobBroker).useClass(TracingJobBroker).asScoped();
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
    // Ready hooks run in registration order and this module now FOLLOWS
    // PluginsModule, so plugins are both discovered and initialized by the time
    // workers begin dequeuing. A job that calls into a plugin still has to
    // tolerate a non-active one (a plugin can be disabled, quarantined or
    // reinitializing at any moment), so nothing here depends on that — it just
    // removes a gap this comment used to have to argue was tolerable.
    //
    // The position is fixed by shutdown, which runs in REVERSE registration
    // order: registering after PluginsModule is what tears this down BEFORE it,
    // so workers stop consuming before the plugin instances under them are
    // disposed. It sat ahead of PluginsModule for as long as teardown ran
    // forwards, which bought the same guarantee from the opposite side.
    //
    // And a runner that cannot start STOPS THE STATION. The ready loop is fault-isolated by design:
    // a hook that throws is logged and boot carries on, which is right for a cache warm and wrong
    // for this. Everything on a schedule runs through the runner — the clock's changeovers, the
    // catalog sync and its enrichment, the scrobble flush — and every refill, break and render the
    // director asks for is a row the runner consumes. With `start()` failed (the owner credentials
    // wrong, the pg-boss schema migration refused, a queue that would not create) the process
    // printed "Boot complete", answered every route and reported healthy while the running order
    // ran out and nothing was written to fill it: a station that was up in every way except the one
    // that airs. That is the wrong side of fail-open, so the failure is made the loud kind. It asks
    // for the same graceful close a SIGTERM does rather than calling `process.exit` itself, so every
    // module still tears down in order and the log store flushes the line that says why; the exit
    // code is set first so what supervises the process sees a failure rather than a clean stop.
    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        const jobRunner = container.get(JobRunner);
        try {
            await jobRunner.start();
        } catch (error) {
            // A start abandoned because shutdown already began is not a failure of the runner.
            if (signal.aborted) return;
            container
                .get(Logger)
                .error('jobs: the runner failed to start; stopping the station rather than serving without it', { error: serverkitErrorText(error) });
            process.exitCode = 1;
            process.kill(process.pid, 'SIGTERM');
        }
    },
    shutdown: async (container: Container) => {
        const jobRunner = container.get(JobRunner);
        await jobRunner.stop();
    },
};
