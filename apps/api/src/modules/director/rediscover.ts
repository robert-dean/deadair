/**
 * Rediscovery: leans that bring back what the station has let go quiet.
 *
 * ## What smart shuffle cannot see
 *
 * Smart shuffle (`smart.shuffle.ts`) is keyed on the SONG, so it can say a record has rested and
 * nothing about the act behind it. An artist the operator liked can go a month without airing while
 * every one of their records reads as merely fresh, drawn at the same weight as a record by an act
 * nobody has an opinion about. A station with a long memory brings a favourite back after a while
 * away, and this is that: a liked artist the station has not aired in weeks leans the draw toward
 * their records.
 *
 * ## A lean, never a filter
 *
 * The same standing smart shuffle and the mood lean have. It multiplies in through `weightOf` in
 * `rotation.rules.ts`, it changes how often a record is drawn and never whether it may be, and it
 * stacks with the like it is built on: a liked artist's record is already drawn at twice the weight,
 * and coming back after weeks away makes it three times.
 *
 * ## Likes, never play counts
 *
 * "An artist the station favours" is read from the operator's rating of the ARTIST and from nothing
 * the station did itself. Ranking anything by what aired is the feedback loop #37 warns about: what
 * aired is what is offered, so what is offered is what airs.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { numberFrom } from '#modules/shared/setting.numbers.js';
import { PLAY_HISTORY_RETENTION_DAYS } from './play.history.repository.js';

/** The `deadair.settings` keys, in the `rotation` group beside smart shuffle. */
export const REDISCOVER_KEYS = {
    artistReturn: 'rotation.artistReturn',
    artistReturnDays: 'rotation.artistReturnDays',
} as const;

/** On by default, as smart shuffle is: off restores the draw exactly, so nobody loses anything by it. */
export const DEFAULT_ARTIST_RETURN = true;

/**
 * How long a liked artist has to have been off air before the lean applies: three weeks.
 *
 * Longer than smart shuffle's fortnight, so the two say different things: a record resting, and an
 * act the station has not touched in a while.
 */
export const DEFAULT_ARTIST_RETURN_DAYS = 21;

/**
 * The range the resolver clamps a stored figure to and the registry declares. A week at the least,
 * because shorter than that is the artist cooldown's job, and the history's retention at the most,
 * because an artist off air for longer than rows are kept is indistinguishable from one never aired.
 */
export const ARTIST_RETURN_DAYS_RANGE = { min: 7, max: PLAY_HISTORY_RETENTION_DAYS } as const;

/**
 * The multiplier a returning artist's record is drawn at, on top of the like it already has.
 *
 * An unfitted half again: enough to be heard over a few hours, small enough that one favourite
 * coming back does not take the hour over. Nothing here has measured a better figure.
 */
export const RETURN_LEAN = 1.5;

/** What the artist-return lean is set to, read once per decision rather than held. */
export interface ArtistReturn {
    enabled: boolean;
    /** Whole days, inside {@link ARTIST_RETURN_DAYS_RANGE}. Meaningful only when enabled. */
    days: number;
}

/** A stored figure as the draw will use it: whole days, clamped rather than refused, on the settings rule. */
export function clampArtistReturnDays(value: unknown): number {
    const parsed = Math.floor(numberFrom(value, DEFAULT_ARTIST_RETURN_DAYS));
    return Math.min(ARTIST_RETURN_DAYS_RANGE.max, Math.max(ARTIST_RETURN_DAYS_RANGE.min, parsed));
}

/** The lean as the operator has it set. Through `settingIsOn`, because a setting is a string. */
export function resolveArtistReturn(config: AppConfig): ArtistReturn {
    return {
        enabled: settingIsOn(config, REDISCOVER_KEYS.artistReturn, DEFAULT_ARTIST_RETURN),
        days: clampArtistReturnDays(config.get(REDISCOVER_KEYS.artistReturnDays, DEFAULT_ARTIST_RETURN_DAYS)),
    };
}

/**
 * How many minutes of history to ask which artists aired in: the window when on, `0` when off.
 *
 * In minutes because the read it shares is the artist cooldown's, `PlayHistoryRepository.artistKeysSince`.
 * `0` answers empty without a query, which is why the caller must ALSO check `enabled` before reading
 * an empty answer as "nobody aired": off, every liked artist would otherwise count as returning.
 */
export const quietMinutesFor = (lean: ArtistReturn): number => (lean.enabled ? lean.days * 24 * 60 : 0);
