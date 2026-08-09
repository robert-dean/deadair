import { Injectable } from 'injectkit';

/**
 * Work a request wants done once its transaction has committed, rather than
 * inside it.
 *
 * A request is one transaction (`audit.context.middleware`), and a service that
 * writes a row and then asks a process-wide singleton to act on that write is
 * asking it to read a row nobody else can see yet. The singleton is on another
 * pooled connection, so it reads the row as it was BEFORE the write, and if it
 * then writes that same row it blocks on the lock the request is holding. The
 * request is meanwhile waiting for the singleton, and neither side gives way:
 * Postgres does not call that a deadlock, because only one of the two is
 * waiting in the database, so nothing breaks the tie and the request hangs
 * holding a pooled connection.
 *
 * Measured against the dev database, on the row `PluginsService` writes and
 * `PluginLifecycleManager` reinitializes: the second connection's read returned
 * the pre-write row, and its follow-up upsert was still waiting on
 * `Lock/transactionid` two seconds later, with no `statement_timeout` or
 * `lock_timeout` set to end it.
 *
 * So: register the follow-up here instead, and it runs after the commit, where
 * the row it is about to read is the row the operator just wrote.
 *
 * Scoped, so a task registered by one request cannot be run by another.
 *
 * Two things about the moment tasks run. They run BEFORE the response is
 * written, so a route that defers work still answers only once that work is
 * done, and a throw from a task still reaches the error handler — over a write
 * that is by then durable, which is the trade this class makes and the reason it
 * does not swallow. And they run after the request scope's `Kysely` has been put
 * back to the pool, so a task may use the container it was closed over, but what
 * it gets is a fresh connection rather than the transaction that has just ended.
 */
@Injectable()
export class AfterCommit {
    private readonly tasks: (() => Promise<void>)[] = [];

    /** Registers work to run once this request's transaction has committed. */
    add(task: () => Promise<void>): void {
        this.tasks.push(task);
    }

    /**
     * Runs everything registered, in the order it was registered, and clears the
     * list as it goes so a second call is a no-op rather than a repeat.
     *
     * Called by `audit.context.middleware` and nothing else.
     */
    async run(): Promise<void> {
        const pending = this.tasks.splice(0);
        for (const task of pending) {
            await task();
        }
    }
}
