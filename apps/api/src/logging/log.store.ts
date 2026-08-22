import type { RotatingLogStore } from './rotating.log.store.js';

/**
 * Process-wide holder for the one {@link RotatingLogStore} instance.
 *
 * `setup.server.ts` builds the store before any DI container exists (the app
 * logger has to be writable from the very first line of startup), while
 * `plugins.module.ts` needs that same instance to log into plugin channels.
 * Two independently constructed stores writing the same channel would each
 * open their own writable stream onto one file: two independent size
 * counters and two rotations racing each other. Routing both construction
 * sites through `setLogStore`/`getLogStore` keeps it to exactly one instance
 * for the life of the process.
 */
let store: RotatingLogStore | undefined;

/**
 * Records the process-wide store built during server setup.
 *
 * `undefined` puts it back to never-having-been-set, which is for tests: this is module state and
 * would otherwise leak one case's store into the next.
 */
export function setLogStore(next: RotatingLogStore | undefined): void {
    store = next;
}

/** The store built during server setup, or undefined if setup has not run (tests). */
export function getLogStore(): RotatingLogStore | undefined {
    return store;
}
