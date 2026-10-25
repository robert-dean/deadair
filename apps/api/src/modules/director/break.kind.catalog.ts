import { Container, Injectable } from 'injectkit';
import { inScope } from '#modules/shared/scoped.work.js';
import { BreakKindRepository } from './break.kind.repository.js';
import type { AuthoredKind } from './break.kind.js';

/**
 * The kinds of break an operator has written and switched on, held in memory.
 *
 * In memory because the registry has to answer `canWrite` synchronously, on every pass the planner
 * makes, and cannot wait on a read for it (`BreakKindClaimant.kindsNow`). So this is read once at
 * boot and again after every write that commits, which is `PluginGrantsService`'s shape for the same
 * reason: what the station asks on every pass is a map, and the table is only what the map is built
 * from.
 *
 * A singleton that reads a SCOPED repository, so it opens a scope per read rather than holding one,
 * which is the captive dependency the container refuses at `build()`.
 *
 * Empty until the first refresh, and left as it was when a refresh fails: a station that cannot read
 * the table airs the kinds it could read last, or none, and never stops airing its own.
 */
@Injectable()
export class BreakKindCatalog {
    private byKey = new Map<string, AuthoredKind>();

    constructor(private readonly container: Container) {}

    /** Read the switched-on kinds again. Call after a write has committed, never inside its transaction. */
    async refresh(): Promise<void> {
        const kinds = await inScope(this.container, scope => scope.get(BreakKindRepository).list());

        this.byKey = new Map(kinds.filter(kind => kind.enabled).map(kind => [kind.key, kind]));
    }

    /** The keys of every switched-on kind, in the operator's order. */
    keys(): string[] {
        return [...this.byKey.keys()];
    }

    /** One switched-on kind, or `undefined` for a key that is off or was never written. */
    kind(key: string): AuthoredKind | undefined {
        return this.byKey.get(key);
    }
}
