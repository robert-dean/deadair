import { Injectable } from 'injectkit';
import type { TopicKind } from './topic.js';

/**
 * Which sorts of break have subjects at all, and how each one's settings are edited.
 *
 * An explicit list built in `TopicsModule`, exactly as `ToolRegistry`'s sources are built in
 * `LlmModule`: the registry knows its entries and the entries know nothing about the registry, so a
 * second kind is one file plus one line rather than a change here. That the module registering it
 * sits after the modules owning the kinds is the same edge `ToolRegistry` already has.
 *
 * **An empty registry is an ordinary state.** A station whose kinds all happen to be unconfigured
 * still has a working console page: it says there is nothing to name yet, which is true, rather than
 * failing to draw.
 */
@Injectable()
export class TopicKindRegistry {
    constructor(private readonly kinds: readonly TopicKind[]) {}

    /** Every kind that has subjects, in the order the module declared them. */
    all(): readonly TopicKind[] {
        return this.kinds;
    }

    /** One kind, or nothing for a kind that does not take subjects. */
    find(kind: string): TopicKind | undefined {
        return this.kinds.find(candidate => candidate.kind === kind.trim());
    }

    /**
     * Whether this kind takes subjects at all.
     *
     * What a writer asks before reading a topic off a break: a kind nobody declared cannot have one,
     * and a row that names one anyway is inert rather than an error. See `topic.ts`.
     */
    knows(kind: string): boolean {
        return this.find(kind) !== undefined;
    }
}
