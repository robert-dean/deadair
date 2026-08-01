import { Kysely, sql } from 'kysely';
import { ScopedContainer } from 'injectkit';
import { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { PgBossConnectionProvider } from '@maroonedsoftware/jobbroker/pgboss';
import { DB } from '#modules/data/db.js';
import { KyselyTransactionConnectionProvider } from '#modules/data/kysely.transaction.connection.provider.js';
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
            return;
        }

        const db = ctx.container.get(Kysely<DB>);

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
    };
};
