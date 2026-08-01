import { Kysely } from 'kysely';
import { PgBossConnectionProvider } from '@maroonedsoftware/jobbroker/pgboss';
import { fromKysely, type Db } from 'pg-boss';
import { DB } from '#src/modules/data/db.js';

/**
 * Request-scoped {@link PgBossConnectionProvider} bound to the active database
 * transaction. The audit-context middleware installs one of these as a
 * per-request override (alongside its `Kysely<DB>` → trx override), so any job
 * enqueued during the request is inserted on the transaction's connection and
 * commits or rolls back atomically with it — closing the dual-write gap between
 * domain writes and job enqueues.
 *
 * Plugins are stripped from the transaction before adapting it: `fromKysely`
 * runs pg-boss's raw SQL straight through `executeQuery`, and the default
 * CamelCasePlugin / StripSysPeriodPlugin would otherwise rewrite pg-boss's own
 * result columns. `withoutPlugins()` keeps the same (transaction-bound)
 * connection, so atomicity is preserved.
 */
export class KyselyTransactionConnectionProvider extends PgBossConnectionProvider {
    constructor(private readonly trx: Kysely<DB>) {
        super();
    }

    override executor(): Db {
        return fromKysely(this.trx.withoutPlugins());
    }
}
