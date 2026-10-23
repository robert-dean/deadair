import type { StationLineupItem } from './station.lineup.js';

/**
 * A quiet spell: the station keeps its own breaks off the air for the next so many records.
 *
 * ## Counted in records, enforced in the planner's own walk
 *
 * The operator says it in records ("the next ten"), because that is what they are listening to, and
 * the count runs down as each record STARTS (`DirectorService.remember`), so it only moves while
 * somebody can hear it. The planner spaces breaks in AIRTIME, and the two meet here: a count of
 * records is turned into the one boundary in the running order where the quiet ends, and the walk
 * plants nothing before it. Everything after it is planted, written and rendered on the ordinary
 * schedule, so the first break after the quiet is ready when its slot comes round instead of being
 * planted only once the count reaches zero, a write and a render too late.
 *
 * Pure, so the boundary can be tested without a station.
 */

/**
 * The last index the quiet covers: breaks may go in at any boundary AFTER it, and at none before.
 *
 * The `records`-th record still to start, counting from the first item the player has not begun.
 * A slot at index `n` sits in front of `items[n]`, so the first slot allowed is this plus one, which
 * is the gap straight after the last quiet record. Past the end of the order when there are not that
 * many records in it yet, which keeps the whole of it quiet until a refill brings the boundary in.
 *
 * `undefined` when the station is not quiet.
 */
export function quietThrough(items: readonly StationLineupItem[], records: number): number | undefined {
    if (records <= 0) return undefined;

    // The first item nothing has started yet. An item `airing` or behind it is not counted: the
    // count is of records still to START, which is what `remember` takes one off for.
    const from = firstUnstarted(items);
    let remaining = records;
    for (let index = from; index < items.length; index++) {
        const item = items[index]!;
        if (item.kind !== 'track' || !stillToAir(item)) continue;
        remaining -= 1;
        if (remaining === 0) return index;
    }
    return items.length;
}

/** Index of the first item the player has not begun: past every one `airing`, `played` or passed over. */
function firstUnstarted(items: readonly StationLineupItem[]): number {
    for (let index = items.length - 1; index >= 0; index--) {
        const state = items[index]!.state;
        if (state === 'airing' || state === 'played' || state === 'skipped') return index + 1;
    }
    return 0;
}

/** A record that can still be heard: neither cut, nor given up on for want of audio. */
const stillToAir = (item: StationLineupItem): boolean => item.state === 'planned' || item.state === 'handed';
