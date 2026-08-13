/**
 * What the transport needs from the station's running order.
 *
 * Declared HERE, in playout, and implemented by the director's `StationLineup`, so
 * the dependency runs playout <- director like every other edge between them: the
 * playout module is registered first and its `Rundown` is a singleton the director
 * reaches into, never the other way round.
 *
 * It is deliberately narrow. The director owns the ORDER — what is in the list and
 * in what sequence — and the transport owns each item's TRANSPORT STATE, which is
 * the only thing it can honestly speak to: it is the half of the system that
 * actually hands items over and reads the player back. Nothing here reorders,
 * appends or removes.
 */

/**
 * Where one item has got to. The same states `station_lineup.items` stores.
 *
 * `removed` is here for completeness of the union rather than because the transport has any
 * business producing one: it is an operator's cut, and nothing out here may edit the order.
 * What the transport does with it is what it does with any item that is not `planned` —
 * nothing.
 */
export type LiveItemState = 'planned' | 'handed' | 'airing' | 'played' | 'skipped' | 'removed';

/** One item, as the transport sees it: an id and where it has got to. */
export interface LiveItem {
    id: string;
    state: LiveItemState;
}

/**
 * What one item going on air did to everything ahead of it.
 *
 * `passedOver` is the number of items that had been committed and never aired: the player moved
 * past them, which is the same observation whether the cause was a failed decode, an operator's
 * skip or a push that never landed. Zero on an ordinary boundary, which is nearly every one.
 *
 * Declared here rather than beside the implementation for the reason {@link LiveOrder} is: the
 * edge runs playout <- director, and this is part of what the transport asks for.
 */
export interface AiringResult {
    passedOver: number;
}

export interface LiveOrder {
    /** Every item, in the order it will air. */
    all(): readonly LiveItem[];
    /** Whether this order holds the item at all, which is how an id from elsewhere is told apart. */
    has(itemId: string): boolean;

    /** Given to the player. A promise, not a fact. */
    markHanded(itemId: string): boolean;
    /**
     * The player says a listener is hearing it. Everything committed before it was passed over.
     *
     * Answers HOW MANY were passed over rather than just whether the order holds the item, because
     * the catch-up is the one transition that can write off a dozen items at once and nothing else
     * in the transport can see it happen. `undefined` for an id this order does not hold.
     */
    markAiring(itemId: string): AiringResult | undefined;
    /** Behind us. */
    markPlayed(itemId: string): boolean;
    /** The station will not be airing it: nothing could resolve it, or it has no audio. */
    markSkipped(itemId: string): boolean;

    /**
     * Take back items handed over and then retracted, so they are offered again.
     *
     * The one operation here that undoes a promise. An item that was promised and
     * never heard has to come back or it is programming nobody hears, which is the
     * bug the whole decision exists to remove.
     */
    reclaim(itemIds: readonly string[]): number;
    reclaimAll(): number;
}
