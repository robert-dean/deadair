import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { BreakWriter, type BreakTrack, type BreakWriteRequest, type WriteDetail, type WrittenBreak } from './break.writer.js';
import {
    parseTemplates,
    TEMPLATE_KEYS,
    TEMPLATE_VOCABULARY,
    unknownPlaceholders,
    usable,
    wasHeard,
    type RenderedTemplate,
} from './break.templates.js';

/**
 * The station's words for a talk break, written from the two records either side of it.
 *
 * Deterministic in the sense that matters: no network, no model, no clock, and no way to fail that
 * costs the station a break it could have had. It is the FLOOR under the writer seam rather than a
 * stepping stone toward the model. Every generator in the previous station fell back to something
 * shaped like this on any model failure, and that is what kept a rotation clock from stalling on a
 * host that had started answering at two tokens a second.
 *
 * What it is not is clever. It says what was playing and what is playing next, in one of a handful
 * of phrasings, and that is the whole of it. A DJ with an opinion is the model's job.
 *
 * ## The phrasings are the OPERATOR'S
 *
 * They ship as the station's own five and are edited in `rotation.breakTemplates`, which is what
 * makes a station sound like itself with no model anywhere near it. The words being a setting
 * changes nothing else here: the repetition rule, the reading of a title and the refusal to invent
 * are all where they were. See `break.templates.ts` for the syntax and the two rules that decide
 * which phrasings fit a given break.

/** The kind of segment this writes. The same string as `segments.kind`. */
export const TALK_BREAK_KIND = 'talkbreak';

/** What `segments.writer` records for anything written here. */
export const DETERMINISTIC_WRITER = 'deterministic';

interface PhrasingInputs {
    previous?: BreakTrack;
    next?: BreakTrack;
    station?: string;
}

/**
 * Templates an operator has typo'd, so the log says so once rather than once a break.
 *
 * Module-level on purpose, and bounded by the number of distinct broken lines somebody has typed.
 * The writer is scoped per job, so a set on the instance would warn on every break the station
 * takes — which is how a log stops being read, and this is a line worth reading.
 */
const complainedAbout = new Set<string>();

@Injectable()
export class TalkBreakWriter extends BreakWriter {
    readonly kind = TALK_BREAK_KIND;
    readonly name = DETERMINISTIC_WRITER;

    /** Which template produced the last line, for the record. See {@link detailOfLastWrite}. */
    private lastTemplate?: string;

    constructor(
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {
        super();
    }

    /**
     * Which phrasing this was, so a set of them can be tuned rather than guessed at.
     *
     * The one thing about a deterministic line that is not obvious from the line: with several
     * templates that fit, which one was picked is the difference between "that phrasing reads badly"
     * and "the station is repeating itself".
     */
    detailOfLastWrite(): WriteDetail | undefined {
        return this.lastTemplate === undefined ? undefined : { source: this.lastTemplate };
    }

    async write(request: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        this.lastTemplate = undefined;
        const dj = this.config.get(TEMPLATE_KEYS.djName, '').trim();
        const inputs: PhrasingInputs = {
            ...(request.previous === undefined ? {} : { previous: request.previous }),
            ...(request.next === undefined ? {} : { next: request.next }),
            ...(request.station === undefined ? {} : { station: request.station }),
            ...(dj.length === 0 ? {} : { dj }),
        };

        // Read per break rather than held: `deadair.settings` is a layer of the config, so an
        // operator editing their phrasings hears the change on the next break rather than after a
        // restart, which is the whole point of them being a setting.
        const templates = parseTemplates(this.config.get(TEMPLATE_KEYS.templates, ''));
        this.complainAboutTypos(templates);

        const fits = usable(templates, inputs, spoken);
        // Nothing either side and no station name, or an operator whose every template needs
        // something this break has not got: there is no true sentence to be made out of that, and
        // inventing one is how a station ends up announcing a record it did not play.
        if (fits.length === 0) return undefined;

        const chosen = choose(fits, request.recent ?? []);
        this.lastTemplate = chosen.template;
        // `saysNext` rather than "there was a next record": a phrasing whose intro was an optional
        // chunk that got dropped promised nothing, and a break that promised nothing must not be
        // dropped later for a promise it never made.
        return { script: chosen.script, label: labelFor(inputs), claimsNext: chosen.saysNext };
    }

    /**
     * Say once, per broken template, that it names something nothing can fill.
     *
     * A typo silently drops a phrasing out of rotation, and from the console that looks exactly like
     * a phrasing the station has simply never happened to pick. It is the one failure here an
     * operator cannot see for themselves.
     */
    private complainAboutTypos(templates: readonly string[]): void {
        for (const template of templates) {
            const unknown = unknownPlaceholders(template);
            if (unknown.length === 0 || complainedAbout.has(template)) continue;

            complainedAbout.add(template);
            this.logger.warn(
                `director: a break template names something the station cannot fill (${unknown.join(', ')}), so it will never be used: "${template}". ` +
                    `What it can fill: ${TEMPLATE_VOCABULARY.join(', ')}`,
            );
        }
    }
}

/**
 * A phrasing that has not just been used, where one is available.
 *
 * Two rounds rather than one. The first drops everything heard in the whole recent window, which is
 * what stops a station of five phrasings cycling them in a way a listener can predict. When that
 * leaves nothing — a window longer than the number of phrasings that fit the request, which is the
 * ordinary case for a break with only a `next` — it falls back to avoiding just the last thing said,
 * because saying the same sentence TWICE RUNNING is the one repetition anybody actually notices.
 */
function choose(fits: readonly RenderedTemplate[], recent: readonly string[]): RenderedTemplate {
    const unheard = fits.filter(one => !wasHeard(one, recent));
    if (unheard.length > 0) return sample(unheard);

    const last = recent[0];
    const notLast = last === undefined ? fits : fits.filter(one => !wasHeard(one, [last]));
    return sample(notLast.length > 0 ? notLast : fits);
}

/**
 * Random rather than round-robin, for the reason `BreakPlanner.choose` is: the order a list happens
 * to be written in is not a running order, and a station whose phrasings cycle in a fixed sequence
 * sounds like a tape loop even when no single one of them repeats.
 */
const sample = <T>(pool: readonly T[]): T => pool[Math.floor(Math.random() * pool.length)]!;

/**
 * What the console and the mount call this break. Never the script.
 *
 * Exported because every writer wants it, including a model one: a label is for a console and a
 * player's display, so asking a model to generate one is paying for something no listener hears.
 */
export function labelFor({ previous, next }: PhrasingInputs): string {
    if (previous !== undefined && next !== undefined) return `Talk break: ${previous.title} into ${next.title}`;
    if (previous !== undefined) return `Back-announce: ${previous.title}`;
    if (next !== undefined) return `Intro: ${next.title}`;
    return 'Talk break';
}

/**
 * A title or a credit as it should be READ rather than as it is filed.
 *
 * Catalog metadata carries a lot that exists for shelving and nothing for speaking: a remaster year,
 * a deluxe-edition marker, the word "Mono". Read out loud by a DJ every fourth record it is the
 * single most obvious sign that nobody is actually talking, and it is the sort of thing the model
 * binding would also want done before it ever sees the words.
 *
 * Conservative on purpose. Only the suffixes that are unambiguously catalogue furniture are cut, and
 * only when something is left afterwards. A parenthetical that is part of the song stays: "(Don't
 * Fear) The Reaper" and anything featuring a second artist are both things a listener would notice
 * going missing.
 */
export function spoken(text: string): string {
    const furniture =
        /\b(remaster(ed)?|re-?master|deluxe|expanded|anniversary|mono|stereo|single version|album version|radio edit|bonus track|\d{4} mix)\b/i;

    let cleaned = text
        // "Title (2011 Remaster)" and "Title [Deluxe Edition]".
        .replace(/[([][^()[\]]*[)\]]/g, match => (furniture.test(match) ? '' : match))
        // "Title - 2011 Remaster", where the marker is hung off a dash instead.
        .replace(/\s[-–—]\s[^-–—]*$/, match => (furniture.test(match) ? '' : match))
        .replace(/\s{2,}/g, ' ')
        .trim();

    // Everything was furniture, which means the reading of it was wrong rather than the title.
    if (cleaned.length === 0) cleaned = text.trim();
    return cleaned;
}
