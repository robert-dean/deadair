import type { StationOnEnd, StationOrderItem } from '@deadair/sdk';

/**
 * When the running order runs out, and what happens when it does.
 *
 * The console has always said how MUCH is to come — "21 still to come" — and never how LONG, which
 * is the form the question actually takes at 2am: an operator is not counting records, they are
 * deciding whether they can go to bed. Twenty-one items is forty minutes of a talk-heavy hour or
 * two hours of long ones, and the count alone does not say which.
 *
 * ## It is projected here rather than asked for
 *
 * The API answers with items and their lengths and does not carry a running-out time, and it should
 * not: the figure is only ever true to the minute — a skip, a drop or a refill moves it — so a
 * server-side answer would be a stale precision rather than a better one.
 */

/** What is still to be heard: the player is holding it, or nothing has touched it yet. */
function ahead(item: StationOrderItem): boolean {
    return item.state === 'planned' || item.state === 'handed';
}

/**
 * How long the order has left to run, from now, in milliseconds.
 *
 * `remainingMs` is the airing item's own remainder as the API last reported it — the decoder's
 * countdown, taken when the reading was. It is read raw rather than through `usePlayhead`: this
 * whole figure is stated to the minute and hedged with "about", so a reading two seconds behind is
 * invisible in it, and a second ticking hook beside the one the transport panel already runs would
 * be a cost with no reader.
 *
 * A talk-over contributes nothing. It is heard OVER the record that follows rather than in the gap
 * before it, so counting its length would push the answer out by the length of every break in the
 * hour — on a station that talks over every boundary, by several minutes.
 *
 * `undefined` when there is nothing ahead at all, which is not a time and is the empty state's
 * question rather than this one's.
 */
export function msUntilDry(items: StationOrderItem[], remainingMs: number | undefined): number | undefined {
    const rest = items.filter(ahead);
    if (rest.length === 0) return undefined;

    return rest.reduce((total, item) => total + (item.overAtMs === undefined ? (item.durationMs ?? 0) : 0), remainingMs ?? 0);
}

/**
 * The clock time the order runs out at.
 *
 * `now` is a parameter so this stays a pure function of its inputs. The browser's clock rather than
 * the station's, and 24-hour, because it is read against `StationClock` in the corner of the same
 * screen and two clocks in the same eyeline disagreeing about the format is worse than either.
 */
export function runsDryAt(items: StationOrderItem[], remainingMs: number | undefined, now: Date = new Date()): string | undefined {
    const left = msUntilDry(items, remainingMs);
    if (left === undefined) return undefined;

    return new Date(now.getTime() + left).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * What the station does when it gets there, in its own words.
 *
 * Read off `onEnd` rather than assumed. The obvious sentence is "it tops itself up", which is true
 * of exactly one of the three settings — a station set to `stop` goes off air at that time, and
 * telling its operator it will refill would be the console being reassuring about the one fact
 * worth waking up for.
 */
export function whatHappensThen(onEnd: StationOnEnd): string {
    if (onEnd === 'repeat') return 'It starts again from the top rather than running out.';
    if (onEnd === 'stop') return 'The station goes off air then.';
    return 'It tops itself up before then, while there is something to play.';
}
