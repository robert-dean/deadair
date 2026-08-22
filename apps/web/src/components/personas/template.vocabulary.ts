/**
 * What a phrasing may name, and the two ways one can be written so the station never picks it.
 *
 * ## Why this is a copy
 *
 * The station's own vocabulary lives in `apps/api/src/modules/director/break.templates.ts`, which
 * the console cannot import: the API is a Node server and this is a browser bundle, and the one
 * thing they share is the generated SDK, which carries shapes rather than behaviour. The three
 * options were an endpoint serving fourteen static strings, a package holding two three-line
 * functions, or a copy with a test standing over it — and this repo already answered that question
 * for the voice slots, which are held together by `voice.slots.test.ts` without any of the three
 * files importing the others. `template.vocabulary.test.ts` in the API suite is the equivalent here,
 * and it fails if either side moves.
 *
 * ## Why the console checks at all
 *
 * A phrasing naming something that cannot be filled is never USED — `usable()` answers nothing and
 * the writer logs a line once — so from this end it looks exactly like a phrasing the station simply
 * never happens to choose. An operator can watch a character for an evening and never learn that one
 * of its six lines has a typo in it. The generator already reports this for what a MODEL writes; all
 * this does is give an operator writing their own the same courtesy.
 *
 * Nothing here refuses a save. The API accepts any text and the check is advisory by design: a
 * console that blocked on its own copy of a vocabulary would be a console that stops working the day
 * the station learns a new placeholder.
 */

/**
 * Every placeholder the station can fill in, in the order `break.templates.ts` declares them.
 *
 * `previous.name` and `next.name` are aliases of `.title`, and `.artist.name` of `.artist` — kept
 * because they exist, not because anything should prefer them.
 */
export const TEMPLATE_VOCABULARY: readonly string[] = [
    'previous.title',
    'previous.name',
    'previous.artist',
    'previous.artist.name',
    'next.title',
    'next.name',
    'next.artist',
    'next.artist.name',
    'station.name',
    'dj.name',
    'clock.rough',
    'news.headlines',
    'news.topic',
    'greeting',
];

const KNOWN = new Set(TEMPLATE_VOCABULARY);

/** One blob of phrasings as lines: trimmed, comments dropped, blanks dropped. */
export function templateLines(raw: string): string[] {
    return raw
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
}

/**
 * Every placeholder a phrasing names that nothing can fill.
 *
 * A typo rather than an absence: `{{next.titel}}` is a phrasing that will never be used, and it
 * looks from here exactly like one the station has never picked.
 */
export function unknownPlaceholders(template: string): string[] {
    const named = [...template.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map(match => match[1] ?? '');
    return [...new Set(named.filter(name => !KNOWN.has(name)))];
}

/**
 * Whether a phrasing carries a bracket that is not part of an optional chunk.
 *
 * `[[…]]` is syntax and a lone `[` is TEXT: it survives to the script and gets read out, which is
 * what this exists to name. Invisible to {@link unknownPlaceholders}, which only ever inspects
 * `{{…}}`.
 */
export function hasStrayBracket(template: string): boolean {
    return /[[\]]/.test(template.replace(/\[\[.*?\]\]/gs, ''));
}

/**
 * What is wrong with one phrasing, or nothing.
 *
 * The three checks the generator makes about a line a model wrote, in one place so a line an
 * operator typed is held to the same standard. A phrasing with NO placeholder at all is included,
 * because a fixed sentence said on every break is the one failure here a listener notices.
 */
export function faultInTemplate(template: string): string | undefined {
    const unknown = unknownPlaceholders(template);
    if (unknown.length > 0) {
        return `names ${unknown.map(name => `{{${name}}}`).join(', ')}, which the station cannot fill in`;
    }

    if (hasStrayBracket(template)) return 'has a single bracket, which is read out rather than treated as an optional part';
    if (!template.includes('{{')) return 'names no record, so it would say the same thing after every one';

    return undefined;
}
