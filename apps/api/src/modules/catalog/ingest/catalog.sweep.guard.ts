/**
 * How much of one provider's library a single sync is allowed to retire.
 *
 * ## The failure this exists for
 *
 * `deadair.track_sources.external_id` holds a provider's own id verbatim, and the sweep judges a
 * `sync` binding by whether the walk that just finished saw it. Both halves are right, and together
 * they make one assumption that is not: that an id the provider no longer offers is a fact about the
 * MUSIC. It is a fact about the locator. A library server that renumbers its songs — reported
 * upstream, and the reason this was written before it happened — answers a complete, healthy walk in
 * which not one id matches anything stored. The sweep reads that as the operator having deleted
 * their entire library, and `track_audio.source_id` cascades off the binding, so the cached bytes,
 * the per-copy `advisory` and `isrc` and the analysis rows all go with it.
 *
 * `markMissingTrackSources` already refuses a walk that saw NOTHING, because `<> all('{}')` is true
 * of every row. A renumber is the same catastrophe wearing a full seen-set, so the count of one is
 * the wrong test and a proportion is the right one.
 *
 * ## Why refusing costs nothing
 *
 * `TrackAudioService.bench` writes `missing_at` per binding after repeated failed fetches. So a
 * library that really was emptied is still marked, one record at a time, by the path that actually
 * asked the provider for bytes and was turned down. Declining the bulk sweep only makes the station
 * slower to narrow its own rotation, which is the right way round: this is `AudienceWatch`'s rule
 * reached from another direction, that an answer that failed and an answer of zero are the same
 * number and completely different evidence.
 */

/** The `deadair.settings` key. Dot-keyed, like every other setting. */
export const SWEEP_MAX_PERCENT_KEY = 'catalog.sweepMaxPercent';

/**
 * Half a library in one hour is already far past anything a provider does by itself.
 *
 * Not tuned, and deliberately not close to the failure it catches: a renumber is 100% and a walk
 * truncated at the page cap is whatever fraction fitted, so there is a lot of room between "an
 * operator reorganised some playlists" and either of those. What sets the ceiling is that the guard
 * has to be wrong in the safe direction, and the safe direction is refusing.
 */
export const DEFAULT_SWEEP_MAX_PERCENT = 50;

/**
 * Below this many live `sync` bindings the proportion is noise, so only the empty-walk refusal applies.
 *
 * On four bindings, losing three is 75% and completely ordinary. A guard that fires there would be
 * teaching an operator with a small library that the sweep does not work, which is how a guard gets
 * turned off before it is ever needed. Twenty is where a ratio starts meaning something; it is not
 * measured, because there is nothing to measure — the number exists to keep small libraries out of a
 * test that cannot say anything about them.
 */
export const SWEEP_GUARD_MIN_KNOWN = 20;

/** What the sweep did, or what it declined to do and on what evidence. */
export type SweepOutcome =
    | { kind: 'swept'; swept: number }
    /** The walk reported no ids at all, so there is nothing to judge anything against. */
    | { kind: 'refused'; reason: 'nothing-seen' }
    /** The walk recognised too little of what is already bound to be believed. */
    | { kind: 'refused'; reason: 'too-many'; known: number; unseen: number };

/**
 * Whether a walk that recognised `known - unseen` of this plugin's bindings is worth acting on.
 *
 * `maxPercent` at 100 is the guard off, which is why there is no separate switch beside it: a
 * setting that says "retire whatever the walk did not see" already spells exactly that, and a
 * boolean would only add a second way to express it that could disagree.
 *
 * @param known - Live `sync` bindings this plugin has, i.e. everything the sweep could touch.
 * @param unseen - How many of those the walk did not report.
 */
export function sweepIsSafe(known: number, unseen: number, maxPercent: number): boolean {
    if (known < SWEEP_GUARD_MIN_KNOWN) return true;

    return unseen * 100 <= known * maxPercent;
}

/**
 * The percentage from whatever the setting says.
 *
 * CLAMPS rather than refusing, on `resolveAnalysisConcurrency`'s rule: this is read on the way to a
 * walk, and a setting that will not load stops the walk behind it. A stored row is already there and
 * pulling it back to a legal figure beats declining to sync; `serializeSetting` is where a number
 * somebody is TYPING gets refused instead.
 *
 * Unset and unreadable both take the default, on `settingIsOn`'s rule that a value nobody can parse
 * is a setting nobody set — and note that a set value arrives here as TEXT however numeric it looks,
 * because every layer of `AppConfig` holds strings.
 */
export function resolveSweepMaxPercent(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return DEFAULT_SWEEP_MAX_PERCENT;

    return Math.min(100, Math.max(1, Math.floor(parsed)));
}
