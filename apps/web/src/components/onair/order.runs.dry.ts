import type { PlayoutNowPlaying, StationOnEnd, StationOrderItem } from '@deadair/sdk';
import { formatClock } from '../../i18n/format.locale';
import { i18n } from '../../i18n/i18n.setup';

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

    return formatClock(new Date(now.getTime() + left));
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
    if (onEnd === 'repeat') return i18n.t('onair:runsDry.repeat');
    if (onEnd === 'stop') return i18n.t('onair:runsDry.stop');
    return i18n.t('onair:runsDry.extend');
}

/** When one row of the order is projected to be heard. */
export interface AirTime {
    /** Unix epoch millis. */
    atMs: number;
    /**
     * Something in front of this row has no length, so the time is the EARLIEST it can air rather
     * than when it will. Counted as zero rather than guessed at, which keeps the figure a true
     * lower bound, and flagged so the rail can say so rather than drawing a confident time.
     */
    atLeast: boolean;
}

/** Every row's projected air time, and the point the order runs out at. */
export interface AirTimes {
    /** By item id. Rows the station is done with have none: they are history, not projection. */
    byId: ReadonlyMap<string, AirTime>;
    /** When the order runs dry, on the same terms. Absent when nothing is ahead or nothing is going out. */
    dry?: AirTime;
}

const NO_TIMES: AirTimes = { byId: new Map() };

/**
 * When each row of the running order will be heard, projected from now.
 *
 * The same sum {@link msUntilDry} makes, item by item: the item on air's remainder, then each item
 * still ahead in turn. So the rail's last point and the "runs dry" sentence cannot disagree.
 *
 * - The item on air is placed at the moment the player reported starting it.
 * - A talk-over adds nothing to the sum. It is placed where it is heard instead: `overAtMs` into
 *   the record after it, or into the record before it when it is `overEndOf`.
 * - A missing length is not guessed. It counts as nothing and every row after it is flagged
 *   {@link AirTime.atLeast}, as is everything when the decoder cannot say how much is left.
 *
 * Nothing at all while nothing is going out: off air the order is not running down, and a time
 * projected from a broadcast that is not happening would be a confident lie.
 *
 * `now` is a parameter so this stays a pure function of its inputs.
 */
export function airTimesOf(items: StationOrderItem[], nowPlaying: PlayoutNowPlaying | undefined, now: number = Date.now()): AirTimes {
    if (nowPlaying === undefined) return NO_TIMES;

    const byId = new Map<string, AirTime>();
    let cursor = now + (nowPlaying.remainingMs ?? 0);
    let atLeast = nowPlaying.remainingMs === undefined;

    // The sum, over everything heard in its own right.
    for (const item of items) {
        if (item.overAtMs !== undefined) continue;
        if (item.state === 'airing') {
            byId.set(item.id, { atMs: nowPlaying.startedAt, atLeast: false });
            continue;
        }
        if (!ahead(item)) continue;
        byId.set(item.id, { atMs: cursor, atLeast });
        if (item.durationMs === undefined) atLeast = true;
        else cursor += item.durationMs;
    }

    // Then the talk-overs, each hung off the record it is heard over.
    items.forEach((item, index) => {
        if (item.overAtMs === undefined || !(ahead(item) || item.state === 'airing')) return;
        const step = item.overEndOf ? -1 : 1;
        let hostAt = index + step;
        while (hostAt >= 0 && hostAt < items.length && items[hostAt]!.overAtMs !== undefined) hostAt += step;
        const host = items[hostAt] === undefined ? undefined : byId.get(items[hostAt]!.id);
        if (host === undefined) return;
        byId.set(item.id, { atMs: host.atMs + item.overAtMs, atLeast: host.atLeast });
    });

    // Ahead by the same test `msUntilDry` makes, so the two answer for exactly the same orders.
    return items.some(ahead) ? { byId, dry: { atMs: cursor, atLeast } } : { byId };
}
