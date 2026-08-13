/**
 * The phrasings the station says, as something an operator owns.
 *
 * These were five entries in a TypeScript array until the operator wanted their own. They still
 * are five entries — {@link DEFAULT_TEMPLATES} is the same five, word for word — but they are now
 * the DEFAULT of a setting rather than the whole of what the station can say. Nothing about the
 * writer changed with them: same repetition rule, same reading of a title, same refusal to invent.
 *
 * ## The syntax is two things
 *
 * `{{next.title}}` is a value. The vocabulary is an explicit map below rather than a walk into
 * whatever object is handy, which is what makes `{{next.album}}` one row to add when enrichment
 * lands instead of a parser change, and what makes a typo a template that is not used rather than a
 * sentence with a hole in it.
 *
 * `[[ ... ]]` is an optional chunk, dropped when what is inside it cannot be filled. That is what
 * carries the "This is {station}" phrasing, which is one sentence plus an optional back-announce
 * plus an optional intro, and it is what saves this needing conditionals — an operator writing a
 * line for their own station should not be writing an if.
 *
 * ## What is not here
 *
 * No loops, no expressions, no nesting. A template is a sentence with holes in it. Everything that
 * wants to be cleverer than that is what the model binding is for, and the two are meant to sit at
 * different ends of the same seam rather than meet in the middle.
 */

import type { BreakTrack } from './break.writer.js';

/**
 * The `deadair.settings` keys.
 *
 * The templates sit in the `rotation` group beside how often the station talks, because that is
 * what an operator is thinking about when they change either. The DJ's name sits in `station`
 * beside the station's own, for the same reason — and it is deliberately not a rotation rule: a
 * per-broadcast override of who the presenter is would be a persona, which is a bigger idea than
 * a name and belongs with the model.
 */
export const TEMPLATE_KEYS = {
    templates: 'rotation.breakTemplates',
    djName: 'station.djName',
} as const;

/** Everything a template can be filled from. */
export interface TemplateInputs {
    previous?: BreakTrack;
    next?: BreakTrack;
    /** What the station calls itself, from `stream.title`. */
    station?: string;
    /** What the station calls its presenter, from `station.djName`. */
    dj?: string;
    /**
     * The time, as words, for a break a rule on the station clock placed.
     *
     * Absent for an ordinary break, which is most of them, and a phrasing naming it is then simply
     * not used — no branch needed, because a placeholder that cannot be filled already means a
     * template that does not apply.
     */
    clock?: string;
}

/** One template, rendered. */
export interface RenderedTemplate {
    /** The template this came from, kept so the history can say which line produced which script. */
    template: string;
    /** The words. */
    script: string;
    /**
     * The literal the script begins with, which is how a past script is recognised as having used
     * this template.
     *
     * Matching on the opening rather than storing a template id is the cheap answer that happens to
     * be the right one: the opening is the part a listener actually hears repeating, so two
     * templates differing only in their middle are correctly treated as the same one, and nothing
     * has to be written down anywhere to make it work. Empty for a template that begins with a
     * placeholder, which {@link wasHeard} then falls back to matching whole.
     */
    opening: string;
    /** Whether the rendered words say anything about the record that just finished. */
    saysPrevious: boolean;
    /** Whether they name the record coming up. What a forward claim is stamped from. */
    saysNext: boolean;
}

/**
 * The station's own five, as templates.
 *
 * The DEFAULT of `rotation.breakTemplates`, which means an operator who clears the box gets these
 * back rather than a silent DJ. The way to stop the station talking is `rotation.breaks`, which
 * already means exactly that; a floor that can be deleted by accident is not a floor.
 */
export const DEFAULT_TEMPLATES: readonly string[] = [
    "That was {{previous.title}}, from {{previous.artist}}.[[ Now, here's {{next.artist}} with {{next.title}}.]]",
    'You just heard {{previous.artist}}, with {{previous.title}}.[[ Up next, {{next.title}} by {{next.artist}}.]]',
    // The one that says the station's name, which is the reason a listener knows what they are
    // listening to. Both halves optional, so it fits a break at either end of an order.
    'This is {{station.name}}.[[ {{previous.title}} there, from {{previous.artist}}.]][[ Coming up, {{next.artist}}, {{next.title}}.]]',
    // The two intro-only ones. Neither says anything about the record just finished, so both are
    // offered only where there is none — see `saysPrevious` and the rule in `usable`.
    'Coming up next, {{next.title}}, from {{next.artist}}.',
    "Here's {{next.artist}} with {{next.title}}.",
    // The one that knows what time it is, and the only one that names {{clock.rough}} — so it is
    // offered only to a break a rule on the station clock placed, and is simply not rendered for
    // any other. Both halves optional, as with the station-name phrasing above.
    "It's {{clock.rough}}, and this is {{station.name}}.[[ {{previous.title}} there, from {{previous.artist}}.]][[ Coming up, {{next.artist}}, {{next.title}}.]]",
];

/**
 * What a placeholder may name, and what it resolves to.
 *
 * Explicit, and one place. `.name` is accepted for a title and `.artist.name` for a credit, so a
 * template reads the way somebody naturally writes one:
 *
 *     Hi, this is {{dj.name}}. We're getting ready to rock out to {{next.name}} by {{next.artist.name}}!
 *
 * `spoken` says whether the value is read ALOUD as a title or a credit, and so wants its catalogue
 * furniture stripped. A station's own name does not: an operator who called the station "Deadair
 * (Deluxe Edition)" meant it.
 */
type Resolver = (inputs: TemplateInputs) => string | undefined;

const trackFields = (which: 'previous' | 'next'): Record<string, Resolver> => ({
    [`${which}.title`]: inputs => inputs[which]?.title,
    [`${which}.name`]: inputs => inputs[which]?.title,
    [`${which}.artist`]: inputs => inputs[which]?.artist,
    [`${which}.artist.name`]: inputs => inputs[which]?.artist,
});

const VALUES: Record<string, Resolver> = {
    ...trackFields('previous'),
    ...trackFields('next'),
    'station.name': inputs => inputs.station,
    'dj.name': inputs => inputs.dj,
    // Deliberately not in SPOKEN_VALUES below: "just after nine" is not a title and has no
    // catalogue furniture to strip. The filter there excludes it already, by naming the two
    // prefixes that ARE read as titles, so this needs nothing.
    'clock.rough': inputs => inputs.clock,
};

/** Which placeholders are read out loud, and so go through {@link spoken}. */
const SPOKEN_VALUES = new Set(Object.keys(VALUES).filter(key => key.startsWith('previous.') || key.startsWith('next.')));

/** Every placeholder a template may use, for an operator's benefit when one is wrong. */
export const TEMPLATE_VOCABULARY: readonly string[] = Object.keys(VALUES);

/** A template line that is a comment, which is how one is turned off without being lost. */
const isComment = (line: string): boolean => line.trimStart().startsWith('#');

/**
 * The templates an operator has set, or the station's own.
 *
 * Empty means the defaults, exactly as every other setting resolves. A line beginning `#` is a
 * comment; blank lines are ignored, because a person spacing their list out is not asking for a
 * break that says nothing.
 */
export function parseTemplates(raw: string | undefined): readonly string[] {
    const lines = (raw ?? '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !isComment(line));

    return lines.length > 0 ? lines : DEFAULT_TEMPLATES;
}

/**
 * Every placeholder a template names that nothing can fill.
 *
 * A typo rather than an absence: `{{next.titel}}` is a template that will never be used, and it
 * looks from the console exactly like a phrasing the station has simply never picked.
 */
export function unknownPlaceholders(template: string): string[] {
    const named = [...template.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map(match => match[1] ?? '');
    return [...new Set(named.filter(name => !(name in VALUES)))];
}

/**
 * Fill one template, or answer `undefined` when it does not fit this break.
 *
 * It does not fit when a placeholder OUTSIDE an optional chunk cannot be filled. Never filled with
 * a blank: "rock out to  by !" is worse than a phrasing that fits, and there is always another
 * phrasing or, failing that, no break at all — which the station is built to absorb.
 */
export function renderTemplate(template: string, inputs: TemplateInputs, spoken: (text: string) => string): RenderedTemplate | undefined {
    if (unknownPlaceholders(template).length > 0) return undefined;

    let saysPrevious = false;
    let saysNext = false;
    let missingRequired = false;

    const fill = (text: string, optional: boolean): string | undefined => {
        let unfilled = false;

        const filled = text.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (_, name: string) => {
            const value = VALUES[name]?.(inputs);
            if (value === undefined || value.trim().length === 0) {
                unfilled = true;
                return '';
            }

            if (name.startsWith('previous.')) saysPrevious = true;
            if (name.startsWith('next.')) saysNext = true;
            return SPOKEN_VALUES.has(name) ? spoken(value) : value;
        });

        if (!unfilled) return filled;
        if (optional) return undefined;

        missingRequired = true;
        return undefined;
    };

    // Optional chunks first, so what survives them is what the required pass has to fill. A chunk
    // that could not be filled leaves nothing at all, including its own spacing.
    const withChunks = template.replace(/\[\[(.*?)\]\]/gs, (_, inner: string) => {
        // A chunk mentioning a record the break does not have is the whole reason chunks exist, so
        // its placeholders going unfilled is not a failure of the template.
        const before = { saysPrevious, saysNext };
        const filled = fill(inner, true);
        if (filled !== undefined) return filled;

        // Nothing in a dropped chunk was said, so it cannot count toward what the script mentions.
        saysPrevious = before.saysPrevious;
        saysNext = before.saysNext;
        return '';
    });

    const script = (fill(withChunks, false) ?? '').replace(/\s{2,}/g, ' ').trim();
    if (missingRequired || script.length === 0) return undefined;

    return { template, script, opening: openingOf(template), saysPrevious, saysNext };
}

/**
 * The literal a template begins with, before its first placeholder or optional chunk.
 *
 * Empty for a template that opens with one of those, which is legitimate — `{{station.name}}.` is
 * the station's own third phrasing — and which {@link wasHeard} handles by matching the whole script
 * instead.
 */
function openingOf(template: string): string {
    const at = template.search(/\{\{|\[\[/);
    return (at < 0 ? template : template.slice(0, at)).trim();
}

/**
 * Whether one of the last few things the station said used this template.
 *
 * By its opening where it has one, because that is the part a listener hears repeating. By the whole
 * script where it does not, which is stricter and rarer and the best that can be done without
 * writing a template id down somewhere.
 */
export function wasHeard(rendered: RenderedTemplate, recent: readonly string[]): boolean {
    const said = (script: string): string => script.trim().toLowerCase();

    if (rendered.opening.length === 0) return recent.some(script => said(script) === said(rendered.script));
    return recent.some(script => said(script).startsWith(rendered.opening.toLowerCase()));
}

/**
 * The templates that fit this break, rendered.
 *
 * Two rules decide it, and the second is the one an operator never has to know about:
 *
 * - every placeholder outside an optional chunk has to be fillable;
 * - a script that says NOTHING about the record just finished is only offered when there is none.
 *
 * The second is why the station has intro-only phrasings and never uses them mid-order. A break
 * that leads into the next record while ignoring the one that has just ended throws away the half
 * a listener was actually waiting for, and knowing what that was is the whole reason anybody wants
 * a DJ over a shuffle. Judged on what the script SAYS rather than on what the template contains, so
 * a phrasing whose back-announce is an optional chunk counts as saying it whenever the chunk
 * survives.
 */
export function usable(templates: readonly string[], inputs: TemplateInputs, spoken: (text: string) => string): RenderedTemplate[] {
    const rendered = templates.flatMap(template => {
        const filled = renderTemplate(template, inputs, spoken);
        return filled === undefined ? [] : [filled];
    });

    if (inputs.previous === undefined) return rendered;
    return rendered.filter(one => one.saysPrevious);
}
