import { Kysely, sql } from 'kysely';
import { ScopedContainer } from 'injectkit';
import { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { KyselyTransactionConnectionProvider, PgBossConnectionProvider } from '@maroonedsoftware/jobbroker/pgboss';
import { AfterCommit } from '#modules/data/after.commit.js';
import { DB } from '#modules/data/db.js';
import { DEFAULT_TRANSACTION_EXEMPTIONS, isTransactionExempt } from './transaction.exemptions.js';

export const auditContextMiddleware: () => ServerKitMiddleware = () => {
    return async (ctx, next) => {
        // GET runs in a transaction too. authorization.context sets the `app.actor_org_id` GUC with
        // is_local=true, which only survives inside a transaction; without one it expires after a
        // single statement on the pooled connection, so the org-isolation RLS policies
        // (current_setting without missing_ok) would raise on every read under the non-owner
        // DATABASE_APP_USER role. Exempt routes (OPTIONS, health/root, streaming — see
        // transaction.exemptions.ts) don't rely on those policies and skip the transaction.
        if (isTransactionExempt(ctx, DEFAULT_TRANSACTION_EXEMPTIONS)) {
            await next();
            // There was no transaction to wait for, so "after the commit" is here.
            // Running it on this branch too is what keeps `AfterCommit.add` from
            // meaning "never" on a route somebody later exempts.
            await ctx.container.get(AfterCommit).run();
            return;
        }

        const db = ctx.container.get(Kysely<DB>);
        // Resolved BEFORE the override below shadows it, because it is what the scope
        // has to be put back to once the transaction ends. A singleton, so this is the
        // root's instance and the pool's own connection provider.
        const pooledJobConnections = ctx.container.get(PgBossConnectionProvider);

        const actorId = ctx.authenticationSession?.subject ?? null;
        const actorType = ctx.path.startsWith('/webhooks/') ? 'webhook' : ctx.authenticationSession ? 'user' : 'anonymous';
        const requestId = ctx.requestId;
        const actorIp = ctx.ipAddress ?? null;

        await db.transaction().execute(async trx => {
            await sql`
                select set_config('app.actor_type', ${actorType}, true),
                       set_config('app.actor_id', ${actorId}, true),
                       set_config('app.request_id', ${requestId}, true),
                       set_config('app.actor_ip', ${actorIp}, true)
            `.execute(trx);

            (ctx.container as ScopedContainer).override(Kysely<DB>, trx);
            // Bind job enqueues to this request transaction: the scoped
            // JobBroker reads its executor from this provider, so jobs sent
            // during the request commit/roll back atomically with it.
            (ctx.container as ScopedContainer).override(PgBossConnectionProvider, new KyselyTransactionConnectionProvider(trx));

            await next();
        });

        // Past here the transaction has COMMITTED. It rejects instead when `next()`
        // threw, so a rolled-back request never reaches the follow-up work its
        // handler registered, which is the point of registering it rather than doing
        // it inline.
        //
        // The scope is pointed back at the pool first: its `Kysely` is still the
        // transaction object that has just ended, and anything resolving one from
        // here would get `Transaction is already committed`.
        (ctx.container as ScopedContainer).override(Kysely<DB>, db);
        (ctx.container as ScopedContainer).override(PgBossConnectionProvider, pooledJobConnections);

        await ctx.container.get(AfterCommit).run();
    };
};
