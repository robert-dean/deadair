import type { StationClock } from './clock.bands.js';
import { refinesGenre, sameTag, words } from './genre.match.js';
import type { StationMode } from './types/director.types.js';

/**
 * Never-play rules: a KIND of record the station must not play, beside a dislike, which forbids one
 * THING. [never-play-rules](https://github.com/robert-dean/deadair/discussions/22) is the design, and
 * two of its rules shape everything here.
 *
 * **A rule is absolute, like a dislike.** No relaxing when the station runs short, and no exception
 * for a listener request: a rule that bends under pressure is one nobody can reproduce.
 *
 * **Exclude only.** There is no "only these genres": a positive rule can leave the station nothing it
 * may play, which fights the floor that cannot fail. Leaning the station TOWARD a genre is a steer,
 * which is a different mechanism and lives in the draw (`genre.steer.ts`), never here.
 *
 * Everything in this file is pure. The context a rule is judged in is built once per judging pass
 * ({@link ruleContext}) and the active rules narrowed once ({@link activeRules}), never per candidate.
 */

/** What a rule reads. `genre` matches a refinement of the target (`genre.match.ts`); `tag` is exact. */
export type RuleField = 'genre' | 'tag';

/** One rule as it is stored. Every scope is optional, and an absent scope means "always". */
export interface BlockRule {
    id: string;
    field: RuleField;
    /** The genre or tag, as the operator wrote it. */
    value: string;
    /** First day of a season, as `MM-DD`. With {@link seasonTo}; a pair where `from > to` wraps the year end. */
    seasonFrom?: string;
    seasonTo?: string;
    /** The hours of the day it holds for, `fromHour <= hour < untilHour` on the station's clock, wrapping midnight when `fromHour > untilHour`. */
    fromHour?: number;
    untilHour?: number;
    /** Only while the station is in one of these modes. Absent or empty means every mode. */
    modes?: readonly StationMode[];
    /** Only during these schedule slots. Absent or empty means whatever is on. */
    slotIds?: readonly string[];
    /** When it stops holding, as an ISO instant. Absent means until somebody removes it. */
    endsAt?: string;
}

/** A rule ready to judge with: its target folded once, at compile time rather than per candidate. */
export interface CompiledRule extends BlockRule {
    readonly target: string;
}

/** What a rule is judged against, read once per judging pass. */
export interface RuleContext {
    /** The station's own clock, from `readClock`. */
    clock: StationClock;
    /** Epoch millis, for {@link BlockRule.endsAt}. */
    now: number;
    mode?: StationMode;
    slotId?: string;
}

/** Rules ready to judge with. A rule whose value folds to nothing names no genre and is dropped rather than matching everything. */
export function compileRules(rules: readonly BlockRule[]): CompiledRule[] {
    return rules.flatMap(rule => (words(rule.value).length === 0 ? [] : [{ ...rule, target: rule.value.trim() }]));
}

/**
 * Whether the station's date falls inside a season of `MM-DD` days.
 *
 * `from <= to` is a closed interval inside one year (`06-01` to `08-31`); `from > to` wraps the year
 * end (`12-01` to `01-06`). A season with only one end, or an unreadable one, holds all year: a
 * half-written season is not evidence the operator meant "never".
 */
export function inSeason(clock: StationClock, from: string | undefined, to: string | undefined): boolean {
    const start = dayKey(from);
    const end = dayKey(to);
    if (start === undefined || end === undefined) return true;

    const today = clock.month * 100 + clock.day;
    return start <= end ? today >= start && today <= end : today >= start || today <= end;
}

/** Whether a rule holds at this moment, on this station, in this mode and slot. */
export function ruleActive(rule: BlockRule, context: RuleContext): boolean {
    if (rule.endsAt !== undefined) {
        const ends = Date.parse(rule.endsAt);
        if (Number.isFinite(ends) && context.now >= ends) return false;
    }
    if (!inSeason(context.clock, rule.seasonFrom, rule.seasonTo)) return false;
    if (!inHours(context.clock.hour, rule.fromHour, rule.untilHour)) return false;
    if (rule.modes !== undefined && rule.modes.length > 0 && (context.mode === undefined || !rule.modes.includes(context.mode))) return false;
    if (rule.slotIds !== undefined && rule.slotIds.length > 0 && (context.slotId === undefined || !rule.slotIds.includes(context.slotId)))
        return false;
    return true;
}

/** The rules that hold right now, narrowed once so a judging pass does not ask per candidate. */
export function activeRules(rules: readonly CompiledRule[], context: RuleContext): CompiledRule[] {
    return rules.filter(rule => ruleActive(rule, context));
}

/** Whether one record's tags fall under a rule. */
export function ruleMatches(rule: CompiledRule, tags: readonly string[]): boolean {
    return rule.field === 'genre' ? tags.some(tag => refinesGenre(tag, rule.target)) : tags.some(tag => sameTag(tag, rule.target));
}

/**
 * The first active rule a record falls under, named so a refusal can say which, or `undefined`.
 *
 * Takes rules already narrowed by {@link activeRules}. A record with no tags falls under nothing:
 * a record nobody described is not evidence it is the genre a rule was written for.
 */
export function blockedBy(rules: readonly CompiledRule[], tags: readonly string[]): CompiledRule | undefined {
    if (tags.length === 0) return undefined;
    return rules.find(rule => ruleMatches(rule, tags));
}

/** `MM-DD` as `month * 100 + day`, or `undefined` for anything that is not a real calendar day. */
function dayKey(value: string | undefined): number | undefined {
    const match = /^(\d{2})-(\d{2})$/.exec(value ?? '');
    if (match === null) return undefined;

    const month = Number(match[1]);
    const day = Number(match[2]);
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? month * 100 + day : undefined;
}

/** Whether an hour falls in a window, wrapping midnight. A window with only one end holds all day. */
function inHours(hour: number, from: number | undefined, until: number | undefined): boolean {
    if (from === undefined || until === undefined || from === until) return true;
    return from < until ? hour >= from && hour < until : hour >= from || hour < until;
}
