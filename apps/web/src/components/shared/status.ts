/**
 * The console's one vocabulary for the state of a thing.
 *
 * There were two, both well argued in isolation and mutually unreadable together: plugins drew a
 * lamp and a word, the station drew a badge, and each named its own Mantine colours inline. What
 * they actually disagreed about was nothing — "running" and "on air" are the same claim about
 * different subjects — so the TONE is what got extracted, and the two surfaces keep their own
 * shapes on top of it.
 *
 * A tone is deliberately not a colour. Nothing outside this file should name `red` or `yellow`
 * for a status again, because the whole failure mode being closed off here is a surface deciding
 * for itself that "misconfigured" is a bit red.
 */

/**
 * The five states worth telling apart, and the reason each is its own.
 *
 * `live` and `fault` are both urgent and must never be drawn alike: one is the station working
 * and the other is the station broken. `standby` and `off` are the pair the console had no way to
 * distinguish before — waiting for a listener is not the same as being stood down, and drawing
 * either as a fault is what made a working station look broken.
 */
export type StatusTone = 'live' | 'ok' | 'standby' | 'fault' | 'off';

/**
 * Tone to Mantine palette name.
 *
 * Red for live is the one convention every studio already shares. The palettes themselves are
 * retuned in `theme.ts`, so these names are stable while the hues are not.
 */
export const toneColor: Record<StatusTone, string> = {
    live: 'red',
    ok: 'teal',
    standby: 'blue',
    fault: 'yellow',
    off: 'gray',
};
