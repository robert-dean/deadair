import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { FactRepository } from '#modules/enrichment/fact.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import { stationLanguage } from '#modules/stream/stream.settings.js';
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
import { timeClaimIn } from './clock.words.js';
import { spoken } from './talk.break.writer.js';
import { TRIVIA_KIND } from './trivia.kind.js';
import type { TriviaFact } from './trivia.source.js';

/**
 * The station passing on a piece of trivia about its own music.
 *
 * The floor under a trivia break, in the sense `AlmanacBreakWriter` is the floor under a break about
 * the date: no network, no model, and no way to fail that costs the station a break it could have
 * had. What makes it a KIND rather than a talk break with a fact in it is what it is about: a talk
 * break is about the records either side of it, and this is about anything the station has played.
 *
 * ## It reads the claim and never writes one
 *
 * The almanac's safety property, held for the same reason: every claim in the store came out of an
 * article with the span that supports it (`fact.lead.ts`), so the claim and its evidence are one
 * sentence, and the only thing a deterministic writer may do with it is read it out. What a phrasing
 * may add around it is the subject's NAME, from the catalog, and the station's own furniture. It may
 * not say that something is famous, surprising or a classic: none of that is in the store.
 *
 * ## A claim is spent when it reaches a script
 *
 * `last_used_at` is stamped HERE rather than in the source, so a break that is declined, rewritten
 * or dropped spends nothing. See `TriviaSource`.
 *
 * ## No claim means no break
 *
 * `write` answers `undefined` when there is nothing to say. A break that announced a piece of trivia
 * and then gave none is worse than the slot being passed over. Why there was nothing is said by
 * `TriviaSource`, which is the only thing that can tell.
 *
 * ## The phrasings are the operator's, and are their own set
 *
 * `rotation.triviaTemplates`, defaulting to {@link TRIVIA_TEMPLATES}, with `{{trivia.report}}` for
 * the claim and `{{trivia.about}}` for what it is about. Not the persona's `templates`, for the
 * almanac's reason: those are written as back-announces.
 */

export { TRIVIA_KIND };

/** What `segments.writer` records for anything written here. */
export const TRIVIA_WRITER = 'deterministic';

/** The `deadair.settings` key for the phrasings, beside the almanac's in the `phrasings` group. */
export const TRIVIA_BREAK_KEYS = {
    templates: 'rotation.triviaTemplates',
} as const;

/**
 * The station's own ways of passing a piece of trivia on.
 *
 * The DEFAULT of `rotation.triviaTemplates`, so an operator who clears the box gets these back. Every
 * one puts `{{trivia.report}}` outside an optional chunk and after a full stop, the almanac's two
 * rules for its report and for the same reasons: a phrasing that could drop the claim is one that can
 * produce "Here's a bit of trivia. Next up, The Cure.", and the claim is a capitalised sentence.
 *
 * Two of them name the subject first. Most claims name it themselves, since the store's floor is an
 * article's opening sentence, but one a model extracted can begin "It was recorded…", and a listener
 * handed that with no subject has nothing.
 */
export const TRIVIA_TEMPLATES: readonly string[] = [
    'A bit of trivia[[ on {{station.name}}]]. {{trivia.report}}[[ Now, {{next.title}}.]]',
    "Here's one about {{trivia.about}}. {{trivia.report}}[[ Coming up, {{next.artist}}.]]",
    'Something you might not know. {{trivia.report}}[[ Here is {{next.artist}} with {{next.title}}.]]',
    '[[{{greeting}}. ]]A quick one about {{trivia.about}}. {{trivia.report}}',
    'Did you know? {{trivia.report}}[[ And now, {{next.title}}.]]',
];

/** How many recent breaks a phrasing avoids repeating. The almanac's three, for its reason. */
const RECENT_WINDOW = 3;

@Injectable()
export class TriviaBreakWriter extends BreakWriter {
    readonly kind = TRIVIA_KIND;
    readonly name = TRIVIA_WRITER;

    /** Which phrasing produced the last line, for the record. See {@link detailOfLastWrite}. */
    private lastTemplate?: string;

    constructor(
        private readonly config: AppConfig,
        private readonly facts: FactRepository,
        private readonly logger: Logger,
    ) {
        super();
    }

    detailOfLastWrite(): WriteDetail | undefined {
        return this.lastTemplate === undefined ? undefined : { source: this.lastTemplate };
    }

    async write(request: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        this.lastTemplate = undefined;

        // The first claim, which the store's order has already made the best one: anything but an
        // article's summary sentence, coldest first.
        const fact = request.trivia?.[0];
        if (fact === undefined) return undefined;

        const dj = (request.persona?.djName ?? this.config.get(TEMPLATE_KEYS.djName, '')).trim();

        // No `previous`, for the almanac's reason: `usable` insists a phrasing say something about the
        // record just finished whenever there is one, and trivia that back-announces on its way in is
        // a presenter who has not decided what this break is.
        const inputs: TemplateInputs = {
            trivia: reportOf(fact),
            triviaAbout: fact.about,
            ...(request.next === undefined ? {} : { next: request.next }),
            ...(request.station === undefined ? {} : { station: request.station }),
            ...(dj.length === 0 ? {} : { dj }),
            ...(request.clock === undefined ? {} : { clock: request.clock.words }),
            ...(request.greeting === undefined ? {} : { greeting: request.greeting.words }),
            ...(request.dayPart === undefined ? {} : { dayPart: request.dayPart.words }),
            ...(request.weekday === undefined ? {} : { weekday: request.weekday.words }),
            ...(request.occasion === undefined ? {} : { occasion: request.occasion.words }),
        };

        const language = stationLanguage(this.config);
        const templates = parseTemplates(this.config.get(TRIVIA_BREAK_KEYS.templates, ''), TRIVIA_TEMPLATES, language);
        this.complainAboutTypos(templates);

        const fits = usable(templates, inputs, spoken, language);
        // A claim and no frame to read it in is a slot passed over rather than a bare sentence.
        if (fits.length === 0) return undefined;

        const chosen = choose(fits, (request.recent ?? []).slice(0, RECENT_WINDOW));
        this.lastTemplate = chosen.template;

        // Spent here, where the claim has actually reached a script. Best-effort, as every stamp on
        // the store is: a failed stamp costs a claim its rest and never the break.
        await this.facts.markUsed([fact.factId]).catch(error => this.logger.warn(`director: could not rest a trivia claim (${errorText(error)})`));

        const claimsTime = timeClaimIn(chosen.script, request.clock, request.greeting, request.dayPart, request.weekday, request.occasion);

        return {
            script: chosen.script,
            label: `Trivia: ${fact.about}`,
            listenerLabel: 'Trivia',
            claimsNext: chosen.saysNext,
            // Nothing about the claim goes stale, so the only window is whatever else the words said
            // about the time: a greeting, the hour, the part of the day.
            ...(claimsTime === undefined ? {} : { claimsTime }),
        };
    }

    /** Say once, per broken phrasing, that it names something nothing can fill. */
    private complainAboutTypos(templates: readonly string[]): void {
        for (const template of templates) {
            const unknown = unknownPlaceholders(template);
            if (unknown.length === 0 || complainedAbout.has(template)) continue;

            complainedAbout.add(template);
            this.logger.warn(`director: a phrasing for trivia names something the station cannot fill (${unknown.join(', ')}): "${template}"`);
        }
    }
}

/**
 * The claim as a sentence the station can say: exactly as stored, with a full stop if it had none.
 *
 * Nothing else is touched, for the almanac's reason: the store's claim is a span of a published
 * article, and lowering a letter or trimming a clause is the station editing its evidence.
 */
export function reportOf(fact: TriviaFact): string {
    const claim = fact.claim.trim();
    return /[.!?…"'”’)]$/u.test(claim) ? claim : `${claim}.`;
}

/** Phrasings an operator has typo'd. Module-level for `AlmanacBreakWriter`'s reason. */
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
