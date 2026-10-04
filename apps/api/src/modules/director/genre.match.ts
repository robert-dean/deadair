import { normalizeKey } from '#modules/catalog/catalog.keys.js';

/**
 * Whether a tag names a genre a rule was written for, in the one direction that is safe.
 *
 * A tag may REFINE the target and may never broaden it, and it must contain the target on word
 * boundaries. `Punk Rock` is a kind of `Punk`, so a rule against punk catches it; `Pop` is not a kind
 * of `Pop Punk`, so a rule against pop punk leaves plain pop alone; and `Trap` is not `Rap` at all,
 * however the letters line up. [never-play-rules](https://github.com/robert-dean/deadair/discussions/22)
 * gives the table this is held to, and why a wrong answer here is a silent over-block rather than a
 * visible one.
 *
 * Compared as WORDS rather than characters, which is what carries the boundary through
 * normalisation: both sides are folded by the catalog's own `normalizeKey` (case, accents and
 * punctuation) and split on its spaces, and the target's words must appear in the tag as one
 * contiguous run. `&` is read as `and` on both sides first, so `Drum & Bass` and `drum and bass` are
 * one genre and `R&B` is still two words that have to stay together.
 */
export function refinesGenre(tag: string, target: string): boolean {
    const wanted = words(target);
    if (wanted.length === 0) return false;

    const have = words(tag);
    for (let start = 0; start + wanted.length <= have.length; start += 1) {
        if (wanted.every((word, offset) => have[start + offset] === word)) return true;
    }
    return false;
}

/** Whether a tag is exactly the target, once folded: the free-text namespace, where containment catches too much. */
export function sameTag(tag: string, target: string): boolean {
    const key = fold(target);
    return key !== '' && fold(tag) === key;
}

/** A genre or tag as the words it is compared by. */
export function words(value: string): string[] {
    const folded = fold(value);
    return folded === '' ? [] : folded.split(' ');
}

const fold = (value: string): string => normalizeKey(value.replace(/&/g, ' and '));
