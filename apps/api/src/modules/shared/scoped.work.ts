import type { Container } from 'injectkit';

/**
 * One unit of database work in a scope of its own.
 *
 * ## Why a singleton has to do this at all
 *
 * Repositories are scoped, because on the request path each one should read and
 * write on that request's transaction. Everything that drives the station is a
 * singleton on a timer: the transport's reconcile, the director's commit pass,
 * the recorder writing an event. Those run off the request path entirely, so
 * there is no ambient scope to borrow a connection from, and they cannot hold a
 * repository either — capturing one would freeze whichever scope happened to
 * build the singleton and keep using that scope's `Kysely` long after it was
 * committed. InjectKit rejects that capture at `build()`.
 *
 * So the shape is: open a scope, resolve what you need from it, dispose it. That
 * was written out thirteen times, four of them as a private `inScope` method
 * identical to this one.
 *
 * ## Two things to keep in mind
 *
 * **Resolve from the ROOT container.** A singleton's dependencies come from the
 * root rather than from whichever scope built it, which is what keeps the scope
 * opened here from being the child of a request scope that has already been
 * disposed.
 *
 * **A scope per call, not per object.** The caller usually outlives any one unit
 * of work — the plugin host that fetches a token at boot is the same object that
 * refreshes one an hour later — so a scope held on the object would be a
 * connection held for the life of the process.
 *
 * ```ts
 * const air = await inScope(this.container, scope => scope.get(StationAirRepository).read());
 * ```
 *
 * @param container - The root container. Not a scope: this opens its own.
 * @param work - Run with the new scope. Its result is the result of the call.
 */
export async function inScope<T>(container: Container, work: (scope: Container) => Promise<T>): Promise<T> {
    const scope = container.createScopedContainer();
    try {
        return await work(scope);
    } finally {
        await scope.disposeAsync();
    }
}
