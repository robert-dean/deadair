import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { StationLineupMode, StationLineupRules } from './station.lineup.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';

/**
 * The rules that shape a generated set: what not to play again yet, and how not
 * to play too much of one artist at once.
 *
 * Pure, and deliberately separate from both the SQL that gathers candidates and
 * the generator that picks between them. Each rule is a small decision that is
 * easy to get subtly wrong and impossible to hear going wrong — a repeat window
 * that never matches sounds exactly like a station with a small library — so
 * they are table-tested rather than trusted.
 *
 * Everything here is advisory about WHAT to play. The one thing that is not is
 * the dislike filter, which is an instruction; see {@link rejectDisliked}.
 */

/** The rules as the director actually applies them, with nothing left to default. */
export interface ResolvedRules {
    /** Days a song is suppressed after airing. `0` disables the window. */
    repeatWindowDays: number;
    /** Minutes an artist is suppressed after airing. `0` disables the cooldown. */
    artistCooldownMinutes: number;
    /** Most tracks by one artist in a generated batch. `0` disables the cap. */
    maxPerArtist: number;
    /** Whether the director may generate more when the lineup runs short. */
    autoExtend: boolean;
    /** Whether the station may put its own segments into this lineup. */
    breaks: boolean;
    /**
     * Whether the station greets somebody who tunes in to an empty room.
     *
     * Under {@link breaks} rather than beside it: a station that has been told not to interrupt
     * itself has been told that about every kind of break there is, and a greeting is one.
     */
    welcome: boolean;
    /**
     * Minutes of airtime between one break and the next OF THE SAME KIND. `0` is `breaks: false`.
     *
     * Minutes rather than records, which is what this counted until it was measured. Four records
     * was always a stand-in for a quarter of an hour and was never a good one: at this catalog's
     * average it is closer to eighteen minutes, and on a station of long album cuts it would be
     * half an hour. The help text has claimed "about a quarter of an hour" the whole time, so the
     * unit was already the one an operator was thinking in.
     *
     * Per KIND, which is the other half. A news bulletin at nine says nothing about when the DJ
     * should next name the station, so each rule counts only its own breaks and treats every other
     * one as ordinary airtime.
     */
    breakEveryMinutes: number;
    /**
     * Whether one record may be blended into the next.
     *
     * The odd one out here, and worth knowing why it lives in this bag anyway.
     * Every other field shapes what the generator PICKS; this one shapes how the
     * transport hands two chosen records over. What they have in common is the
     * thing that decides them: it is a property of the broadcast rather than of
     * the station or of a record, and this is the one place a broadcast's
     * properties are resolved.
     *
     * It is also the field {@link breaks} is the precedent for. An album played
     * in full is a record whose segues are the point, so the same baseline that
     * keeps the station from talking over one keeps it from blending over one.
     */
    crossfade: boolean;
}

/**
 * What a station is programmed like before anybody has said otherwise.
 *
 * Three days is long enough that a listener over an afternoon never hears a
 * repeat and short enough that a modest library does not starve. Forty minutes
 * of artist cooldown is roughly the length of a listening session, which is the
 * span over which hearing the same act twice is noticeable.
 *
 * These are now the fallback rather than the answer: an operator sets their own
 * in `rotation.*` (see the settings registry), and {@link resolveRules} takes
 * those as its baseline. This is what a station with none of them stored gets,
 * and what every table test here is written against.
 */
export const DEFAULT_RULES: ResolvedRules = {
    repeatWindowDays: 3,
    artistCooldownMinutes: 40,
    maxPerArtist: 2,
    autoExtend: true,
    breaks: true,
    // ON. A station that never says hello to somebody who has just arrived is one they have to wait
    // a quarter of an hour to learn the name of.
    welcome: true,
    // A quarter of an hour, which is about as long as a station can go without identifying itself
    // before it stops sounding like a station and starts sounding like a playlist. Erring long: a
    // break every few minutes is a novelty that wears out in an afternoon. This is the number the
    // setting's help has always claimed; it is only now the number the code actually uses.
    breakEveryMinutes: 15,
    // ON. It was held off on the belief that a blend puts `on_air_elapsed` -- which every DJ break
    // is timed against -- ahead of the audience. Measured, it does not: the counter is a wall clock
    // zeroed at the instant the record becomes audible, and a cross moves the source pointer rather
    // than that clock. See the note on `on_air_elapsed` in radio.liq and stream/voicecue.check.liq.
    //
    // A rotation only. A setlist and a feature start from everything off and stay cold, which is
    // the point of them; see `resolveRules`.
    crossfade: true,
};

/**
 * The `deadair.settings` keys holding the station's own rules.
 *
 * Dot-keyed like every other setting, and named for what they are rather than
 * for the module that reads them: an operator changing how often the station
 * says its own name is not thinking about the director.
 */
export const ROTATION_KEYS = {
    repeatWindowDays: 'rotation.repeatWindowDays',
    artistCooldownMinutes: 'rotation.artistCooldownMinutes',
    maxPerArtist: 'rotation.maxPerArtist',
    autoExtend: 'rotation.autoExtend',
    breaks: 'rotation.breaks',
    welcome: 'rotation.welcome',
    breakEveryMinutes: 'rotation.breakEveryMinutes',
    crossfade: 'rotation.crossfade',
} as const;

/**
 * The station's rules as the operator has them set, falling back per field.
 *
 * Per field rather than all-or-nothing: an operator who has only ever changed
 * `breakEveryMinutes` keeps the reasoning behind every other default rather than
 * getting zeroes for the ones they never touched.
 *
 * A stored value that is not a number is ignored rather than propagated. These
 * reach SQL as a window and a cooldown, and a `NaN` there quietly matches
 * nothing — which sounds exactly like a station whose library is too small.
 */
export function stationRules(config: AppConfig): ResolvedRules {
    const number = (key: string, fallback: number): number => {
        if (!config.has(key)) return fallback;
        const parsed = Number(config.get(key, ''));
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
    // Through the shared reader rather than the `!== 'false'` this was: that spelling was right
    // about the bug and wrong about everything else it let through, since a row holding anything
    // unparseable read as ON — and these four are the switches that decide whether the station talks
    // at all. `settingIsOn` handles the absent key too, so the `config.has` guard goes with it.
    const boolean = (key: string, fallback: boolean): boolean => settingIsOn(config, key, fallback);

    return {
        repeatWindowDays: number(ROTATION_KEYS.repeatWindowDays, DEFAULT_RULES.repeatWindowDays),
        artistCooldownMinutes: number(ROTATION_KEYS.artistCooldownMinutes, DEFAULT_RULES.artistCooldownMinutes),
        maxPerArtist: number(ROTATION_KEYS.maxPerArtist, DEFAULT_RULES.maxPerArtist),
        autoExtend: boolean(ROTATION_KEYS.autoExtend, DEFAULT_RULES.autoExtend),
        breaks: boolean(ROTATION_KEYS.breaks, DEFAULT_RULES.breaks),
        welcome: boolean(ROTATION_KEYS.welcome, DEFAULT_RULES.welcome),
        breakEveryMinutes: number(ROTATION_KEYS.breakEveryMinutes, DEFAULT_RULES.breakEveryMinutes),
        crossfade: boolean(ROTATION_KEYS.crossfade, DEFAULT_RULES.crossfade),
    };
}

/** Every rule off. What a lineup that is not a rotation resolves to. */
const NO_RULES: ResolvedRules = {
    repeatWindowDays: 0,
    artistCooldownMinutes: 0,
    maxPerArtist: 0,
    autoExtend: false,
    breaks: false,
    welcome: false,
    breakEveryMinutes: 0,
    crossfade: false,
};

/**
 * What rules apply to one lineup: its mode decides the baseline, its own
 * overrides adjust it field by field.
 *
 * A `setlist` and a `feature` start from everything OFF, and that is the whole
 * mechanism behind them. A Christmas setlist is played across a month precisely
 * because it repeats; running it under a repeat window would suppress the very
 * tracks it exists to play, and an artist cooldown would refuse to air two
 * Bing Crosby records in an evening. A feature is one artist by definition.
 *
 * Breaks are off for both, and the 0007 migration says why for a feature in so
 * many words: an album played in full is a record whose segues are the point, and
 * "nothing talks over them". A setlist is the same argument one step weaker —
 * somebody sequenced it, and dropping an ident into the middle of their sequence
 * is undoing the work.
 *
 * Crossfade rides the same argument the whole way. "Whose segues are the point"
 * is an argument about the boundaries themselves, so it applies more directly to
 * blending one record into the next than it does to talking between them: an
 * album's gap between two tracks is a decision somebody made, and overlapping
 * them is overruling it.
 *
 * The overrides still apply on top, so an operator who wants a cooldown inside a
 * long setlist can have one. That is why this is a baseline rather than a
 * hard-coded branch in the reactor.
 *
 * `station` is what the operator has set for the station as a whole, and it
 * arrives as an argument rather than being read here so that this stays pure and
 * stays table-tested. It applies to a `rotation` only: a setlist and a feature
 * start from everything off by definition, and a station-wide cooldown leaking
 * into them would undo the very thing those modes exist for.
 *
 * Precedence, tightest last: station defaults, then the lineup's own overrides.
 */
export const resolveRules = (mode: StationLineupMode, overrides?: StationLineupRules, station: ResolvedRules = DEFAULT_RULES): ResolvedRules => {
    const base = mode === 'rotation' ? station : NO_RULES;
    return {
        repeatWindowDays: overrides?.repeatWindowDays ?? base.repeatWindowDays,
        artistCooldownMinutes: overrides?.artistCooldownMinutes ?? base.artistCooldownMinutes,
        maxPerArtist: overrides?.maxPerArtist ?? base.maxPerArtist,
        autoExtend: overrides?.autoExtend ?? base.autoExtend,
        breaks: overrides?.breaks ?? base.breaks,
        welcome: overrides?.welcome ?? base.welcome,
        breakEveryMinutes: overrides?.breakEveryMinutes ?? base.breakEveryMinutes,
        crossfade: overrides?.crossfade ?? base.crossfade,
    };
};

/** The minimum a candidate has to carry to be judged. */
export interface RotationCandidate {
    songKey: string;
    artistKey: string;
    /**
     * How the station feels about this work across all three levels: `-1`
     * disliked, `0` unrated, `1` liked. Absent for anything the catalog has no
     * opinion on.
     *
     * A dislike at any level wins outright and a like at any level otherwise
     * carries; `CandidatesRepository.effectiveRating` is where that is decided,
     * and it is the only place it should be.
     */
    rating?: number;
}

/** What the station has aired lately, as the rules read it. */
export interface RecentlyAired {
    /** Songs inside the repeat window. Empty when the window is off. */
    songKeys: ReadonlySet<string>;
    /** Artists inside the cooldown. Empty when the cooldown is off. */
    artistKeys: ReadonlySet<string>;
}

/**
 * Drop anything the station has played too recently.
 *
 * Both sets are already scoped to their window by the caller, so an empty set
 * means "nothing is suppressed" — which is also exactly what a disabled rule
 * produces, and is why a rule of `0` costs no query rather than needing a branch
 * here.
 */
export const filterByHistory = <T extends RotationCandidate>(candidates: readonly T[], recent: RecentlyAired): T[] =>
    candidates.filter(candidate => !recent.songKeys.has(candidate.songKey) && !recent.artistKeys.has(candidate.artistKey));

/**
 * Drop anything the operator has disliked.
 *
 * **Not a rotation rule, and not disable-able by a lineup.** A dislike is an
 * instruction about what the station may play, not a preference about how often;
 * a setlist that turned the rules off must still not air a record its owner
 * marked `-1`. The rating it reads takes a dislike at ANY of the three levels as
 * a dislike of the work, so disliking an artist stops the station playing them
 * rather than stopping it playing one of their songs.
 */
export const rejectDisliked = <T extends RotationCandidate>(candidates: readonly T[]): T[] => candidates.filter(candidate => candidate.rating !== -1);

/**
 * How much a candidate should be favoured when sampling.
 *
 * A liked track is twice as likely to be drawn, and no more: `1` is a weight and
 * not a promise. A station that always played its liked tracks would have a
 * library of a few dozen songs and would still be obeying the repeat window
 * while it did it.
 *
 * Liked at ANY level counts, which is the whole reason the rating reaching this
 * is not a `least()` across the three. It used to be, and the effect was that
 * this doubled nothing an operator could produce from the console without rating
 * a song, its record and its artist identically.
 */
export const weightOf = (candidate: RotationCandidate): number => (candidate.rating === 1 ? 2 : 1);

/**
 * Keep at most `max` tracks by any one artist, in the order they were offered.
 *
 * The cap the repeat window cannot express: nothing here has aired yet, so the
 * cooldown has nothing to say about a batch that happens to be six tracks by the
 * same act. `0` disables it.
 */
export const capPerArtist = <T extends RotationCandidate>(candidates: readonly T[], max: number): T[] => {
    if (max <= 0) return [...candidates];

    const counts = new Map<string, number>();
    const kept: T[] = [];
    for (const candidate of candidates) {
        const seen = counts.get(candidate.artistKey) ?? 0;
        if (seen >= max) continue;
        counts.set(candidate.artistKey, seen + 1);
        kept.push(candidate);
    }
    return kept;
};

/**
 * Every rule that decides WHETHER a candidate may air, in the order they are cheapest.
 *
 * The four functions above are each usable alone and two callers now want all of them, so the
 * ORDER is written down once here rather than being copied. It is the order
 * {@link CatalogSetGenerator} arrived at: dislikes first because they are absolute and cost nothing,
 * history next because it is the largest reduction and everything after it is cheaper on a smaller
 * set, then the cap.
 *
 * {@link spaceArtists} is deliberately NOT in here. Everything above answers "may this air"; spacing
 * answers "in what order", and it has to run after a caller has finished dropping things — a batch
 * spaced before two of its tracks turn out to be unplayable comes back with the gap closed up and
 * two by one artist adjacent again. So the two halves are separate on purpose and a caller applies
 * this one, drops what it must, and spaces last.
 */
export const applyRules = <T extends RotationCandidate>(candidates: readonly T[], rules: ResolvedRules, recent: RecentlyAired): T[] =>
    capPerArtist(filterByHistory(rejectDisliked(candidates), recent), rules.maxPerArtist);

/**
 * Reorder so the same artist is never back to back.
 *
 * Cosmetic in a way the other rules are not: it changes nothing about WHICH
 * tracks air, only the order they air in. But two tracks by one act in a row is
 * the single most audible sign of a shuffle that is not being programmed, and
 * the cap alone cannot prevent it — two is under any sensible cap and still
 * sounds wrong when they are adjacent.
 *
 * At each step it takes the candidate whose artist has the MOST tracks still
 * waiting, among those that differ from the one just placed. Taking simply the
 * first different artist is the obvious version and it is wrong: it strands the
 * commonest artist at the end, so a batch of `[Two, Three, One, One]` comes back
 * with the two One tracks adjacent even though an arrangement exists. Spending
 * the crowded artist while there are still others to separate them with is what
 * makes this succeed whenever success is possible at all.
 *
 * Ties keep the earlier candidate, so the ordering is stable rather than
 * wandering between runs of the same input. When everything remaining is by the
 * artist just placed — a batch that is entirely one act — it takes the head:
 * nothing can be done about it, and stalling would be worse.
 */
export const spaceArtists = <T extends RotationCandidate>(candidates: readonly T[]): T[] => {
    const pending = [...candidates];
    const remaining = new Map<string, number>();
    for (const candidate of pending) remaining.set(candidate.artistKey, (remaining.get(candidate.artistKey) ?? 0) + 1);

    const spaced: T[] = [];
    let previous: string | undefined;

    while (pending.length > 0) {
        let index = -1;
        let best = 0;
        pending.forEach((candidate, position) => {
            if (candidate.artistKey === previous) return;
            const count = remaining.get(candidate.artistKey) ?? 0;
            if (count > best) {
                best = count;
                index = position;
            }
        });
        // Everything left is by the artist just placed.
        if (index < 0) index = 0;

        const [next] = pending.splice(index, 1);
        spaced.push(next!);
        remaining.set(next!.artistKey, (remaining.get(next!.artistKey) ?? 1) - 1);
        previous = next!.artistKey;
    }
    return spaced;
};
