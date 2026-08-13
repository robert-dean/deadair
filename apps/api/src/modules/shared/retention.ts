import type { AppConfig } from '@maroonedsoftware/appconfig';

/**
 * How many days of something to keep, or `0` for all of it.
 *
 * Its own resolver rather than a raw config read, sharing the registry's default
 * so the two cannot disagree — the same arrangement `resolveStreamSettings` and
 * `stationRules` have. Two sweeps wrote it identically, down to the comment.
 *
 * **Every uncertain reading falls the safe way.** Unparseable, negative and
 * fractional all resolve to keeping everything, because this number's only use
 * is deciding what to DELETE. A sweep that never runs costs disk; a sweep that
 * runs when the operator meant to keep everything costs the only record of a
 * night they have forgotten. The repositories check `0` as well, so the safe
 * answer is enforced at both ends.
 *
 * @param config - Read per call rather than captured, so an operator lowering
 *   the window gets tonight's sweep rather than the one after a restart.
 * @param key - The `deadair.settings` key.
 * @param fallback - The registry's declared default for that key.
 */
export function resolveRetentionDays(config: AppConfig, key: string, fallback: number): number {
    const raw = config.get(key, fallback);
    const days = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);

    if (!Number.isFinite(days) || days <= 0) return 0;
    return Math.floor(days);
}
