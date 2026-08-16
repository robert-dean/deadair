import { Container, Injectable } from 'injectkit';
import { inScope } from '#modules/shared/scoped.work.js';
import { capabilityOf, type GrantDecision } from './plugin.grants.js';
import { PluginGrantsRepository } from './plugin.grants.repository.js';

/**
 * What each plugin has been allowed to do, as the host asks it.
 *
 * The store is `deadair.plugin_grants` and this is the live view of it. **Denied is the default and
 * needs no row**: a capability is refused until somebody allows it, so a plugin nobody has answered
 * for and one that was refused are one state, deliberately — a console able to tell them apart
 * would have to flag both, and a permission surface that nags about decisions already made is one
 * nobody reads.
 *
 * A refusal is still written as a row where somebody actually made one, because the row records WHO
 * decided and when. Nothing reads that difference; an auditor does.
 *
 * ## Held in memory, because of who asks
 *
 * `PluginHostFactory.assertAllowed` consults this on every outbound fetch, from a singleton with no
 * request scope. A query there is not a policy check, it is a bill: a bulletin reading four articles
 * would pay four round trips to re-learn something that changes when an operator clicks a control.
 * So the decisions are loaded once at `ready()` and rewritten on every write, and the map IS the
 * answer between those two moments.
 *
 * A failed load leaves the map EMPTY rather than stale-or-guessed, which refuses everything. That is
 * the opposite of how `DirectorService.withLocalAudio` fails open, and deliberately: a gate that
 * cannot read its own answer should not be granting capabilities, and the cost here is a plugin
 * falling back to what it can do without one rather than a station going off air.
 *
 * ## It answers about a capability, never about a plugin
 *
 * {@link holds} takes both, and a decision stored for a capability this host no longer publishes is
 * ignored — `capabilityOf` is asked first. A retired capability leaves rows behind, and none of them
 * should be able to enable anything by outliving the code that meant something by them.
 */
@Injectable()
export class PluginGrantsService {
    /** `pluginId` → `capability` → what was decided. Absent at either level means denied. */
    private decisions = new Map<string, Map<string, GrantDecision>>();

    constructor(private readonly container: Container) {}

    /**
     * Reads every decision into memory. Called at boot and after each write.
     *
     * Rebuilt wholesale rather than patched, because the table is small and a map assembled from
     * deltas is a map that can disagree with the rows it came from.
     */
    async refresh(): Promise<void> {
        const rows = await inScope(this.container, scope => scope.get(PluginGrantsRepository).list());

        const next = new Map<string, Map<string, GrantDecision>>();
        for (const row of rows) {
            const forPlugin = next.get(row.pluginId) ?? new Map<string, GrantDecision>();
            forPlugin.set(row.capability, row.decision);
            next.set(row.pluginId, forPlugin);
        }

        this.decisions = next;
    }

    /**
     * Whether this plugin may do this, right now.
     *
     * The one question the enforcement points ask. Everything else here is about presenting the
     * answer to a person.
     */
    holds(pluginId: string, capability: string): boolean {
        if (capabilityOf(capability) === undefined) return false;
        return this.decisions.get(pluginId)?.get(capability) === 'allowed';
    }

    /**
     * What this plugin may do, as an answer rather than as a lookup.
     *
     * `denied` for a capability with no row, which is the same thing {@link holds} says: the absence
     * of an allowance IS a refusal, and a caller that had to spell that out per site is a caller
     * that will eventually forget to.
     */
    decisionFor(pluginId: string, capability: string): GrantDecision {
        return this.decisions.get(pluginId)?.get(capability) ?? 'denied';
    }

    /**
     * Records an answer and applies it at once.
     *
     * The refresh is inside the write rather than left to the caller, because the gap between the
     * two is a window where the operator has clicked Allow and the host still says no — short, but
     * long enough to be the thing somebody reports.
     */
    async decide(pluginId: string, capability: string, decision: GrantDecision, decidedBy?: string): Promise<void> {
        await inScope(this.container, scope => scope.get(PluginGrantsRepository).decide(pluginId, capability, decision, decidedBy));
        await this.refresh();
    }
}
