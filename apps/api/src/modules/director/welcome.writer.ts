import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak } from './break.writer.js';
import {
    parseTemplates,
    TEMPLATE_KEYS,
    unknownPlaceholders,
    usable,
    wasHeard,
    type RenderedTemplate,
    type TemplateInputs,
} from './break.templates.js';
import { saysTime } from './clock.words.js';
import { spoken } from './talk.break.writer.js';

/**
 * What the station says to somebody who has just tuned in.
 *
 * The floor under the welcome, in the same sense `TalkBreakWriter` is the floor under a talk break:
 * no network, no model, no way to fail that costs the station a greeting it could have had. What is
 * different is what it is ABOUT, and it is worth being precise about that because it is the whole
 * reason this is a second writer rather than a template in the first one.
 *
 * **A greeting looks forward and a talk break looks back.** `usable` refuses any phrasing that says
 * nothing about the record just finished, because a break that ignores what a listener was waiting
 * to hear named throws away the reason anybody wants a DJ. That rule is exactly wrong here: somebody
 * who arrived thirty seconds ago did not hear the last record, so back-announcing it is announcing
 * something they missed. So this builds its inputs with **no `previous` at all**, even when the
 * request carries one — the same withholding the model binding does through its prompt shape, for
 * the same reason.
 *
 * ## The phrasings are the operator's, and are their own set
 *
 * `rotation.welcomeTemplates`, defaulting to {@link WELCOME_TEMPLATES}, in the syntax
 * `break.templates.ts` already parses. Deliberately NOT chained into the persona's `templates` the
 * way `TalkBreakWriter` is: those are written as back-announces ("That was X, from Y") and reading
 * one out to somebody who has just arrived would be worse than plain English. A persona still
 * reaches this through `{{dj.name}}`, and reaches the words properly through the model binding in
 * front of it.
 */

/** The kind of segment this writes. The same string as `segments.kind`. */
export const WELCOME_KIND = 'welcome';

/** What `segments.writer` records for anything written here. */
export const WELCOME_WRITER = 'deterministic';

/** The `deadair.settings` key for the phrasings. In `rotation`, beside the station's other words. */
export const WELCOME_KEYS = {
    templates: 'rotation.welcomeTemplates',
} as const;

/**
 * The station's own greetings.
 *
 * The DEFAULT of `rotation.welcomeTemplates`, so an operator who clears the box gets these back
 * rather than a station that says nothing to a new listener — the same rule `DEFAULT_TEMPLATES`
 * states, and the way to stop the station greeting anybody is `rotation.welcome`.
 *
 * Every one of them puts the greeting in an optional chunk, because {@link dayGreeting} answers with
 * nothing in the small hours and a phrasing that required it would leave the station silent to
 * whoever tunes in at three in the morning. The record coming up is optional for the same reason: a
 * welcome at the very end of a running order has nothing to promise.
 */
export const WELCOME_TEMPLATES: readonly string[] = [
    "[[{{greeting}}, and ]]you're listening to {{station.name}}.[[ Coming up, {{next.artist}} with {{next.title}}.]]",
    '[[{{greeting}}. ]]This is {{station.name}}.[[ Next up, {{next.title}}, from {{next.artist}}.]]',
    "[[{{greeting}}. ]]Thanks for joining us on {{station.name}}.[[ Here's {{next.artist}}, {{next.title}}.]]",
    // The one that names the presenter, for a station that has given itself one.
    'You just caught {{station.name}}[[ with {{dj.name}}]].[[ Coming up, {{next.title}}.]]',
];

/**
 * How many recent greetings a writer avoids repeating.
 *
 * Shorter than a talk break's window and for a different reason: two people tuning in an hour apart
 * hear one greeting each, so the repetition that matters is the station greeting the SAME listener
 * twice in an evening after they reconnected.
 */
const RECENT_WINDOW = 3;

@Injectable()
export class WelcomeWriter extends BreakWriter {
    readonly kind = WELCOME_KIND;
    readonly name = WELCOME_WRITER;

    /** Which phrasing produced the last line, for the record. See {@link detailOfLastWrite}. */
    private lastTemplate?: string;

    constructor(
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {
        super();
    }

    detailOfLastWrite(): WriteDetail | undefined {
        return this.lastTemplate === undefined ? undefined : { source: this.lastTemplate };
    }

    async write(request: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        this.lastTemplate = undefined;

        const dj = (request.persona?.djName ?? this.config.get(TEMPLATE_KEYS.djName, '')).trim();
        // No `previous`, deliberately and even when there is one. See the note on the class: a
        // listener who has just arrived did not hear it, so naming it is announcing something they
        // missed — and `usable`'s back-announce rule would otherwise insist on it.
        const inputs: TemplateInputs = {
            ...(request.next === undefined ? {} : { next: request.next }),
            ...(request.station === undefined ? {} : { station: request.station }),
            ...(dj.length === 0 ? {} : { dj }),
            ...(request.greeting === undefined ? {} : { greeting: request.greeting.words }),
        };

        // Read per greeting rather than held, so an operator editing them hears the change on the
        // next listener rather than after a restart. Falling back to the station's OWN greetings
        // rather than to its talk-break phrasings, which is what the second argument is for.
        const templates = parseTemplates(this.config.get(WELCOME_KEYS.templates, ''), WELCOME_TEMPLATES);
        this.complainAboutTypos(templates);

        const fits = usable(templates, inputs, spoken);
        // No station name, no record coming up and no greeting: there is no true sentence to be made
        // out of that, and inventing one is how a station welcomes somebody to nowhere.
        if (fits.length === 0) return undefined;

        const chosen = choose(fits, (request.recent ?? []).slice(0, RECENT_WINDOW));
        this.lastTemplate = chosen.template;

        return {
            script: chosen.script,
            label: 'Welcome',
            claimsNext: chosen.saysNext,
            // Only when the words really carry the greeting, which is the same answered-rather-than-
            // assumed posture the talk break takes: a phrasing whose greeting chunk was dropped made
            // no claim about the time of day and must not be thrown away for one.
            ...(request.greeting !== undefined && saysTime(chosen.script, request.greeting)
                ? { claimsTime: { from: request.greeting.validFrom, until: request.greeting.validUntil } }
                : {}),
        };
    }

    /** Say once, per broken phrasing, that it names something nothing can fill. */
    private complainAboutTypos(templates: readonly string[]): void {
        for (const template of templates) {
            const unknown = unknownPlaceholders(template);
            if (unknown.length === 0 || complainedAbout.has(template)) continue;

            complainedAbout.add(template);
            this.logger.warn(`director: a welcome phrasing names something the station cannot fill (${unknown.join(', ')}): "${template}"`);
        }
    }
}

/**
 * Phrasings an operator has typo'd, so the log says so once rather than once a greeting.
 *
 * Module-level for `TalkBreakWriter`'s reason: the writer is resolved per job, so a set on the
 * instance would warn every time.
 */
const complainedAbout = new Set<string>();

/** A phrasing that has not just been used, where one is available. `TalkBreakWriter.choose`'s rule. */
function choose(fits: readonly RenderedTemplate[], recent: readonly string[]): RenderedTemplate {
    const unheard = fits.filter(one => !wasHeard(one, recent));
    if (unheard.length > 0) return sample(unheard);

    const last = recent[0];
    const notLast = last === undefined ? fits : fits.filter(one => !wasHeard(one, [last]));
    return sample(notLast.length > 0 ? notLast : fits);
}

const sample = <T>(pool: readonly T[]): T => pool[Math.floor(Math.random() * pool.length)]!;
