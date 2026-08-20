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

/**
 * How badly something went, which is a different question from what state a thing is in.
 *
 * The console needs both and they cannot be one vocabulary, because they disagree about red. A
 * lamp's red means ON AIR and its amber means broken, which is the studio convention `StatusTone`
 * exists to keep — draw a fault in red on a desk and somebody reads it as the transmitter. A
 * failure's red means the hard failure, exactly as `theme.ts` describes the tally palette, because
 * nothing about an error alert or a feed line could be mistaken for the station being live.
 *
 * So: `failure` is the load that did not happen, the render that threw, the line an operator has to
 * do something about. `warning` is the thing that failed while everything around it kept working.
 * `notice` is the third and is not a failure at all — a thing nobody has set up yet, like a catalog
 * with no records in it on the first hour of an install. It is here rather than left to the two
 * because a list that draws "you have not done this yet" in the same colour as "this broke" is one
 * an operator learns to skim, which is the same argument `StatusTone` makes for `standby`.
 *
 * All three live here rather than at their call sites for the reason at the top of this file — the
 * failure being closed off is a surface deciding for itself that its problem is a bit red.
 */
export type Severity = 'failure' | 'warning' | 'notice';

export const severityColor: Record<Severity, string> = {
    failure: 'red',
    warning: 'yellow',
    notice: 'blue',
};
