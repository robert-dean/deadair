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
 * ## Deep cuts
 *
 * The second thing a long memory does is play the album track. A record on an album the operator
 * liked (the album itself, or another record on it), that is not liked for itself, has a known place
 * on that album, and has not aired in the whole of the history the station keeps, is a deep cut: the
 * draw leans toward it, and it carries the fact to the break writer so the presenter can say so. A
 * record with no track number is never called one, because without its place on the album there is
 * nothing to say it is not the single.
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
    deepCuts: 'rotation.deepCuts',
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

/** On by default, for the artist-return lean's reason. */
export const DEFAULT_DEEP_CUTS = true;

/** The multiplier a deep cut is drawn at. Unfitted, and the same half again {@link RETURN_LEAN} is. */
export const DEEP_CUT_LEAN = 1.5;

/** The deep-cut lean as the operator has it set. */
export const resolveDeepCuts = (config: AppConfig): boolean => settingIsOn(config, REDISCOVER_KEYS.deepCuts, DEFAULT_DEEP_CUTS);

/**
 * How many days of history the draw has to read for both of the leans that read it.
 *
 * Smart shuffle needs its horizon; a deep cut needs the whole retention, since "never aired here" is
 * a claim about all of it. One read serves both: an airing older than the horizon weighs exactly like
 * one absent from the map (`freshnessOf` caps at `1`), so reading further back changes no freshness.
 */
export const historyDaysForLeans = (smartShuffleDays: number, deepCuts: boolean): number =>
    Math.max(smartShuffleDays, deepCuts ? PLAY_HISTORY_RETENTION_DAYS : 0);

/** What a sampled record has to carry to be judged a deep cut. */
export interface DeepCutCandidate {
    albumId?: string;
    trackNumber?: number;
    trackLiked?: true;
}

/** Whether the albums this record sits on are worth asking about at all: it could only be a deep cut if so. */
export const mayBeDeepCut = (track: DeepCutCandidate): track is DeepCutCandidate & { albumId: string; trackNumber: number } =>
    track.albumId !== undefined && track.trackNumber !== undefined && track.trackLiked !== true;

/**
 * A record on an album the operator likes, with a known place on it, not liked for itself, and never
 * aired in the history the station keeps.
 *
 * @param likedAlbums - From `CandidatesRepository.albumsWithLikes`.
 * @param aired - Whether its song key aired inside the retention.
 */
export const isDeepCut = (track: DeepCutCandidate, likedAlbums: ReadonlySet<string>, aired: boolean): boolean =>
    mayBeDeepCut(track) && likedAlbums.has(track.albumId) && !aired;
