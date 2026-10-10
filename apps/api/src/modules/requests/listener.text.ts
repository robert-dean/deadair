/**
 * Text a listener typed, made safe to store, to show an operator and to hand a writer.
 *
 * ## One normaliser, on every path
 *
 * A request's name and its dedication arrive from an app (behind a contract) and from a chat (behind
 * nothing), and both end up in front of a writer whose words are spoken on air. They are tidied by the
 * same function, so a character that one path strips cannot reach the air through the other.
 *
 * ## Tidied, then screened
 *
 * {@link tidyListenerText} judges nothing: it only removes what a screen or a log would show
 * differently from what was typed. {@link screenName} is the judgement, and only for a NAME the station
 * is about to say: one that is not a name, or that would have the presenter introduce a listener as
 * the station or one of its own presenters, is refused, and the caller says "a listener" instead. The
 * stored request keeps what was typed, since the operator should see it as it was sent.
 */

/** What a person who gave no name, or a name the station will not say, is called. Their account's email address never is. */
export const UNNAMED_REQUESTER = 'a listener';

/** The longest requester name taken in, as the contract allows. A chat has no contract in front of it, so it is held to this here. */
export const MAX_REQUESTER_NAME = 60;

/** The longest name the station will SAY. Longer is not a name, and is refused rather than cut short into something else. */
export const MAX_SPOKEN_NAME = 40;

/** The most words a name the station will say may have. */
export const MAX_SPOKEN_NAME_WORDS = 4;

/**
 * `value` printable, single-spaced, trimmed and held to `max` characters, or nothing when nothing is left.
 *
 * - NFKC first, so the fullwidth and stylised letters some keyboards and chat clients produce become
 *   the letters they look like before anything else is decided.
 * - Format characters (`\p{Cf}`: zero-width joiners and spaces, the bidi overrides that make a name read
 *   one way on screen and another in a log) are DELETED rather than turned into a space, so a name with
 *   a zero-width space in the middle of it is the name, not two words.
 * - Control characters (`\p{Cc}`, tabs and newlines among them) become a space, since they do separate words.
 * - The clamp counts code points, so it never splits a surrogate pair into half an emoji.
 */
export function tidyListenerText(value: string | undefined, max: number): string | undefined {
    if (value === undefined) return undefined;
    const cleaned = value
        .normalize('NFKC')
        .replace(/\p{Cf}/gu, '')
        .replace(/\p{Cc}/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    if (cleaned === '') return undefined;
    const points = Array.from(cleaned);
    return points.length > max ? points.slice(0, max).join('').trimEnd() : cleaned;
}

/** Each letter of `from` paired with the letter at the same place in `to`. */
const folds = (from: string, to: string): [string, string][] => Array.from(from, (letter, at) => [letter, to.charAt(at)]);

/**
 * Cyrillic and Greek letters that render like a Latin one, folded to it before names are compared.
 *
 * Deliberately small: the capitals and lower-case letters that are indistinguishable from Latin in
 * ordinary fonts, which is what somebody reaching for a look-alike uses. It is not a confusables
 * database, and it does not need to be one: what it guards is a handful of names the station owns,
 * and a near miss costs the listener their name on air, not the station anything.
 */
const LOOK_ALIKES: ReadonlyMap<string, string> = new Map([
    ...folds('АВЕКМНОРСТХУІЈЅ', 'abekmhopctxyijs'), // Cyrillic capitals
    ...folds('аеорсухіјѕһ', 'aeopcyxijsh'), // Cyrillic lower case
    ...folds('ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ', 'abezhikmnoptyx'), // Greek capitals
    ...folds('αορνικ', 'aopvik'), // Greek lower case
]);

/**
 * What a name looks like, for comparing two of them: letters only, unaccented, lower case, with
 * Cyrillic and Greek look-alikes folded to the Latin letter they pass for. Words are kept apart by a
 * single space. Exported for the tests.
 */
export function nameSkeleton(name: string): string {
    return name
        .normalize('NFKC')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/./gu, letter => LOOK_ALIKES.get(letter) ?? letter)
        .toLowerCase()
        .replace(/[^\p{L}]+/gu, ' ')
        .trim();
}

/** Whether `name` contains `reserved` as whole words, or is it with the spaces taken out ("D J Max" for "DJ Max"). */
function claims(name: string, reserved: string): boolean {
    if (reserved === '') return false;
    if (` ${name} `.includes(` ${reserved} `)) return true;
    return name.replace(/ /g, '') === reserved.replace(/ /g, '');
}

/** An address or a handle: something to visit, not somebody to name. */
const LINK_SHAPED = /:\/\/|www\.|@|\p{L}\.\p{L}{2,}/iu;

/**
 * `name` tidied, when the station may say it on air, or nothing when it may not.
 *
 * Refused, rather than cut short or cleaned up, when it:
 * - has no letters at all;
 * - is longer than {@link MAX_SPOKEN_NAME} characters or {@link MAX_SPOKEN_NAME_WORDS} words, which is a
 *   sentence somebody typed into a name box rather than a name;
 * - is shaped like an address or a handle;
 * - contains, as whole words, any of the `reserved` names (the station's own, its presenters'), after
 *   accents, case and look-alike letters are taken out of both sides.
 *
 * A refusal changes only what is said: the request it came with goes ahead exactly as it would have.
 */
export function screenName(name: string | undefined, reserved: readonly string[]): string | undefined {
    const tidied = tidyListenerText(name, MAX_REQUESTER_NAME);
    if (tidied === undefined) return undefined;
    if (!/\p{L}/u.test(tidied)) return undefined;
    if (Array.from(tidied).length > MAX_SPOKEN_NAME) return undefined;
    if (tidied.split(' ').length > MAX_SPOKEN_NAME_WORDS) return undefined;
    if (LINK_SHAPED.test(tidied)) return undefined;

    const skeleton = nameSkeleton(tidied);
    if (reserved.some(owned => claims(skeleton, nameSkeleton(owned)))) return undefined;
    return tidied;
}
