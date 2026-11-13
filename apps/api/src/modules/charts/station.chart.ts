/**
 * The station's own chart: what it aired, what listeners asked for, what got skipped, and what it
 * likes, ranked once a week.
 *
 * Every other chart on the menu is somebody else's published document, read through a plugin. This
 * one is worked out here from the station's own records, and it is offered on the same menu under
 * the `station` qualifier (`station.chart.source.ts`), so everything that already airs a chart (a
 * schedule slot, the Desk, a refill's chart share, the model's chart tool) airs this one with no
 * path of its own.
 *
 * Pure, for `chart.picks.ts`'s reason: the interesting behaviour is a ranking, and a ranking is
 * worth table-testing without a database in the way. `StationChartRepository` reads the counts and
 * this decides what they add up to.
 *
 * ## The points
 *
 * One for every time a record AIRED in the week, three for every listener request made for it, and
 * one off for every skip. A record the station likes (at track, release or artist level, the same
 * opinion the draw reads) then gets half as much again. Three things about that are deliberate:
 *
 * - **A request outweighs a play** because a play is the station's own choice and a request is
 *   somebody asking. Plays alone would make the chart a report on the rotation rules.
 * - **A like is a lift and not a count.** It is one flag per record with no date on it, so "likes
 *   this week" is not a fact the station holds, and a liked record that nobody heard this week
 *   should not chart on the strength of an opinion. Multiplying leaves it at nothing.
 * - **A dislike or a suspension keeps a record off entirely**, here rather than downstream. The
 *   resolver would drop it anyway, and dropping a placed record leaves a countdown with a number
 *   missing, which a presenter counting down then reads out.
 *
 * A record needs {@link MIN_POINTS} to chart at all, so one play in a quiet week is not a placing.
 *
 * ## Ties
 *
 * A countdown needs every position to be a different number, so a tie is always broken: more
 * requests first (the listeners' word over the station's), then whichever aired most recently, then
 * the song key, so the same week ranks the same way twice.
 *
 * ## Movement is derived, never stored
 *
 * Last week's position, the peak and the weeks on the chart come from ranking each earlier week by
 * the same rules, out of the same history. Nothing records an edition when it airs, because a stored
 * edition would be a second account of what the station played beside `play_history`, and the two
 * would drift the first time a rule here changed. The one cost is that an earlier week is judged by
 * today's likes and dislikes, since a rating carries no date.
 */

/** How many records an edition of the weekly chart holds, and so what "on the chart" means for peaks and weeks on. */
export const STATION_CHART_SIZE = 40;

/** How many weeks of history are ranked to work out a record's peak and weeks on, and how far back the favourites look. */
export const HISTORY_WEEKS = 52;

/** What each kind of event is worth. See the file comment. */
export const CHART_POINTS = { play: 1, request: 3, skip: -1 } as const;

/** How much a record the station likes is lifted by: half as much again. */
export const LIKED_LIFT = 1.5;

/** The fewest points that place a record on the weekly chart. */
export const MIN_POINTS = 2;

/** What one record did in one chart week. */
export interface WeekTally {
    /** The week, as the date it starts on in the station's zone: `YYYY-MM-DD`, always a Monday. */
    week: string;
    songKey: string;
    title: string;
    /** The lead artist, never a credit line: `ChartEntry.artist`'s rule. */
    artist: string;
    plays: number;
    requests: number;
    skips: number;
    /** When it last aired that week, ISO-8601. Absent when it only has requests or skips. */
    lastAiredAt?: string;
}

/** What the station holds against a record, by song key. */
export interface SongStanding {
    liked: boolean;
    /** Disliked or suspended: kept off the chart. */
    barred: boolean;
}

/** One record's place on an edition of the station's chart. */
export interface StationChartEntry {
    rank: number;
    songKey: string;
    title: string;
    artist: string;
    /** The edition's week only. */
    plays: number;
    requests: number;
    liked: boolean;
    /** Best position in the weeks ranked, this one included. */
    peak?: number;
    /** How many of the weeks ranked it was on the chart, this one included. */
    weeksOn?: number;
    /** Its position the week before, when it was on the chart then. */
    lastWeek?: number;
}

/** Points for a tally, lifted when the station likes the record. */
export const pointsFor = (tally: Pick<WeekTally, 'plays' | 'requests' | 'skips'>, liked: boolean): number => {
    const points = tally.plays * CHART_POINTS.play + tally.requests * CHART_POINTS.request + tally.skips * CHART_POINTS.skip;
    return points > 0 && liked ? points * LIKED_LIFT : points;
};

interface Scored {
    tally: WeekTally;
    points: number;
    liked: boolean;
}

/** Most points first, then the tie-breaks in the file comment. */
const byPlacing = (left: Scored, right: Scored): number =>
    right.points - left.points ||
    right.tally.requests - left.tally.requests ||
    (right.tally.lastAiredAt ?? '').localeCompare(left.tally.lastAiredAt ?? '') ||
    left.tally.songKey.localeCompare(right.tally.songKey);

/**
 * One week's tallies, ranked: the barred left out, the rest scored, and at most `size` kept.
 *
 * `minPoints` is the bar a record must reach; the favourites pass zero so any liked record heard at
 * all can place.
 */
export function rankTallies(
    tallies: readonly WeekTally[],
    standings: ReadonlyMap<string, SongStanding>,
    size: number,
    minPoints: number = MIN_POINTS,
): Scored[] {
    return tallies
        .filter(tally => standings.get(tally.songKey)?.barred !== true)
        .map(tally => {
            const liked = standings.get(tally.songKey)?.liked === true;
            return { tally, liked, points: pointsFor(tally, liked) };
        })
        .filter(scored => scored.points >= minPoints && scored.points > 0)
        .sort(byPlacing)
        .slice(0, Math.max(0, size));
}

/** The Monday a week before `week`. Both are `YYYY-MM-DD`; the arithmetic is on the calendar date, so no zone is involved. */
export const weekBefore = (week: string): string => {
    const date = new Date(`${week}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 7);
    return date.toISOString().slice(0, 10);
};

/**
 * The weekly chart for `edition`, with each record's movement worked out from the weeks before it.
 *
 * `tallies` may hold any number of weeks; only `edition` and the weeks before it are read, so an
 * edition never knows about a week that came after it.
 */
export function weeklyEdition(
    tallies: readonly WeekTally[],
    standings: ReadonlyMap<string, SongStanding>,
    edition: string,
    size: number = STATION_CHART_SIZE,
): StationChartEntry[] {
    const byWeek = new Map<string, WeekTally[]>();
    for (const tally of tallies) {
        if (tally.week > edition) continue;
        const week = byWeek.get(tally.week) ?? [];
        week.push(tally);
        byWeek.set(tally.week, week);
    }

    // The chart each week would have had, as song key to position.
    const ranks = new Map<string, Map<string, number>>();
    for (const [week, weekTallies] of byWeek) {
        ranks.set(week, new Map(rankTallies(weekTallies, standings, STATION_CHART_SIZE).map((scored, index) => [scored.tally.songKey, index + 1])));
    }

    const previous = ranks.get(weekBefore(edition));
    return rankTallies(byWeek.get(edition) ?? [], standings, size).map((scored, index) => {
        let peak: number | undefined;
        let weeksOn = 0;
        for (const week of ranks.values()) {
            const rank = week.get(scored.tally.songKey);
            if (rank === undefined) continue;
            weeksOn += 1;
            peak = peak === undefined ? rank : Math.min(peak, rank);
        }
        const lastWeek = previous?.get(scored.tally.songKey);
        return {
            ...entryOf(scored, index + 1),
            ...(peak === undefined ? {} : { peak }),
            ...(weeksOn > 0 ? { weeksOn } : {}),
            ...(lastWeek === undefined ? {} : { lastWeek }),
        };
    });
}

/**
 * The station's favourites: the records it likes, ranked by what they did over every week given.
 *
 * No movement, because it is not a weekly document: a favourite's place changes slowly, and "up two
 * on the favourites" is not something a listener is counting.
 */
export function favouritesEdition(tallies: readonly WeekTally[], standings: ReadonlyMap<string, SongStanding>, size: number): StationChartEntry[] {
    const totals = new Map<string, WeekTally>();
    // Newest week last, so the name a record is credited under is the one it most recently aired as.
    for (const tally of [...tallies].sort((left, right) => left.week.localeCompare(right.week))) {
        if (standings.get(tally.songKey)?.liked !== true) continue;
        const total = totals.get(tally.songKey);
        totals.set(tally.songKey, {
            week: tally.week,
            songKey: tally.songKey,
            title: tally.title,
            artist: tally.artist,
            plays: (total?.plays ?? 0) + tally.plays,
            requests: (total?.requests ?? 0) + tally.requests,
            skips: (total?.skips ?? 0) + tally.skips,
            ...latest(total?.lastAiredAt, tally.lastAiredAt),
        });
    }

    return rankTallies([...totals.values()], standings, size, 0).map((scored, index) => entryOf(scored, index + 1));
}

const latest = (left: string | undefined, right: string | undefined): { lastAiredAt?: string } => {
    const later = left === undefined ? right : right === undefined ? left : left > right ? left : right;
    return later === undefined ? {} : { lastAiredAt: later };
};

const entryOf = (scored: Scored, rank: number): StationChartEntry => ({
    rank,
    songKey: scored.tally.songKey,
    title: scored.tally.title,
    artist: scored.tally.artist,
    plays: scored.tally.plays,
    requests: scored.tally.requests,
    liked: scored.liked,
});

/** One week's raw counts for a record, as the repository reads each source. */
export interface SongCount {
    week: string;
    songKey: string;
    title: string;
    artist: string;
    count: number;
    /** Plays only: when it last aired that week. */
    lastAiredAt?: string;
}

/**
 * Plays, requests and skips folded into one tally per record per week.
 *
 * The title and artist come from the plays where there are any, since that is how the record was
 * last heard; a record with only requests is named as the catalog has it.
 */
export function combineCounts(plays: readonly SongCount[], requests: readonly SongCount[], skips: readonly SongCount[]): WeekTally[] {
    const tallies = new Map<string, WeekTally>();
    const at = (count: SongCount): WeekTally => {
        const key = `${count.week}|${count.songKey}`;
        let tally = tallies.get(key);
        if (!tally) {
            tally = { week: count.week, songKey: count.songKey, title: count.title, artist: count.artist, plays: 0, requests: 0, skips: 0 };
            tallies.set(key, tally);
        }
        return tally;
    };

    for (const play of plays) {
        const tally = at(play);
        tally.plays += play.count;
        tally.title = play.title;
        tally.artist = play.artist;
        Object.assign(tally, latest(tally.lastAiredAt, play.lastAiredAt));
    }
    for (const request of requests) at(request).requests += request.count;
    for (const skip of skips) at(skip).skips += skip.count;

    return [...tallies.values()];
}
