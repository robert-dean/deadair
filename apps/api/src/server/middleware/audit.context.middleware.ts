import { Kysely, sql } from 'kysely';
import { ScopedContainer } from 'injectkit';
import { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { KyselyTransactionConnectionProvider, PgBossConnectionProvider } from '@maroonedsoftware/jobbroker/pgboss';
import { AfterCommit } from '#modules/data/after.commit.js';
import { DB } from '#modules/data/db.js';
import { DEFAULT_TRANSACTION_EXEMPTIONS, isTransactionExempt } from './transaction.exemptions.js';

export const auditContextMiddleware: () => ServerKitMiddleware = () => {
    return async (ctx, next) => {
        // GET runs in a transaction too, and there are TWO reasons for that — which matters,
        // because for a long time this comment gave only a third one that was not true.
        //
        // 1. `AfterCommit` means what it says. A deferred settings reload or a plugin reinit runs
        //    when the request's work is durable, and on a route with no transaction the exempt
        //    branch below has to stand in for that.
        // 2. A job enqueued during a request commits atomically with it, via the connection
        //    provider overridden below. Without the transaction a job can be picked up describing
        //    work that then rolled back.
        //
        // What it USED to say was that `authorization.context` pins an `app.actor_org_id` GUC that
        // org-isolation RLS policies read, and that they would raise on every read without it.
        // None of that exists: that middleware sets no GUC, no migration declares a policy, and
        // the four GUCs set below are read by nothing. See `docs/todo/row-level-security.md`.
        // The transaction stays because of the two reasons above, and deleting it on the grounds
        // that the RLS story was fiction would break both.
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

        try {
            await db.transaction().execute(async trx => {
                // Written and, today, read by NOTHING: no trigger, no policy, no `current_setting`
                // anywhere in the schema. They are a prepared seam rather than a live control, kept
                // because the alternative is a database-side audit trail that starts with no history
                // and because they cost one statement on a connection already being set up. Say so
                // rather than implying otherwise — see `docs/todo/row-level-security.md` for what
                // would have to be true for them to matter, including the `app.actor_org_id` this
                // deliberately does not set because there is no organization to name.
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
        } finally {
            // The scope is pointed back at the pool on BOTH paths, which is what the `finally` is
            // for: the transaction object is over either way, and only the committing path used to
            // put it back. When `next()` threw, the request's `Kysely` was left pointing at the
            // transaction that had just rolled back, so anything resolving one from the error path
            // (an error handler that wanted to write down what happened being the obvious one)
            // would be answered with `Transaction is already rolled back` rather than with the
            // pool. Nothing upstream of here touches the database today, which is the only reason
            // that was invisible instead of a bug, and is exactly what makes it a trap for whoever
            // adds the first one.
            (ctx.container as ScopedContainer).override(Kysely<DB>, db);
            (ctx.container as ScopedContainer).override(PgBossConnectionProvider, pooledJobConnections);
        }

        // Past here the transaction has COMMITTED. It rejects instead when `next()`
        // threw, so a rolled-back request never reaches the follow-up work its
        // handler registered, which is the point of registering it rather than doing
        // it inline. The `finally` above does not change that: a throw carries straight
        // past this line.
        await ctx.container.get(AfterCommit).run();
    };
};
