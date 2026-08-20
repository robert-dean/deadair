import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { firstSentence } from '@deadair/plugin-sdk';
import { BreakWriter, type BreakStory, type BreakWriteRequest, type WriteDetail, type WrittenBreak } from './break.writer.js';
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
 * The station reading the headlines, in its own words around somebody else's.
 *
 * The floor under a bulletin, in the sense `TalkBreakWriter` and `WelcomeWriter` are floors: no
 * network, no model, and no way to fail that costs the station a bulletin it could have had. What
 * makes it a different kind rather than a third pool of talk-break phrasings is what it is ABOUT —
 * a talk break is about the records either side of it and this is about something that happened
 * outside the station entirely.
 *
 * ## It reads and it does not write
 *
 * The stories are read as published, in the order they were published, and the operator's phrasing
 * decides only what is said AROUND them. That is the whole safety property of this writer: a station
 * cannot get a news story wrong by reading the publisher's own words, and every other way of
 * producing a bulletin — summarising, ordering by importance, joining two stories into a sentence —
 * is a way of being wrong about the news in a voice that sounds certain. The model binding in front
 * of this is allowed to be cleverer and is checked harder for it.
 *
 * What it reads is a headline AND the story's opening sentence, which is not a softening of that
 * rule but an application of it: a published first sentence quoted word for word is exactly as
 * checkable as a headline, and a bulletin of titles alone tells a listener nothing. See
 * {@link headlinesOf}.
 *
 * ## No stories means no bulletin
 *
 * `write` answers `undefined` when there is nothing to read, and that is the important branch
 * rather than an edge case: an empty feed, a publisher that is down and a station whose news plugin
 * was uninstalled all arrive here the same way. A bulletin that announced itself and then said
 * nothing is worse than the slot being passed over, and passing over a slot is something the
 * station is built to absorb.
 *
 * ## The phrasings are the operator's, and are their own set
 *
 * `rotation.newsTemplates`, defaulting to {@link NEWS_TEMPLATES}, in the syntax
 * `break.templates.ts` already parses, with `{{news.headlines}}` for the read itself. Deliberately
 * NOT chained into the persona's `templates` the way `TalkBreakWriter` is, for `WelcomeWriter`'s
 * reason: those are written as back-announces, and "That was X, from Y" is not how a bulletin
 * opens. A persona reaches this through `{{dj.name}}` and reaches the words properly through the
 * model binding in front of it.
 */

/** The kind of segment this writes. The same string as `segments.kind`, and what a clock band names. */
export const NEWS_KIND = 'news';

/** What `segments.writer` records for anything written here. */
export const NEWS_WRITER = 'deterministic';

/** The `deadair.settings` key for the phrasings. In `rotation`, beside the station's other words. */
export const NEWS_KEYS = {
    templates: 'rotation.newsTemplates',
} as const;

/**
 * The station's own ways of introducing the news.
 *
 * The DEFAULT of `rotation.newsTemplates`, so an operator who clears the box gets these back rather
 * than a station that announces a bulletin and reads nothing — the same rule the other two pools
 * follow, and the way to stop the station reading the news is to take `news` off the clock.
 *
 * Every one of them puts `{{news.headlines}}` outside an optional chunk, which is not a style
 * choice: a phrasing that could drop the read is a phrasing that can produce "Now the news. Next
 * up, The Cure." Everything else is optional, so a station with no name, no clock and nothing
 * coming up still has all four available.
 */
export const NEWS_TEMPLATES: readonly string[] = [
    'Now the news. {{news.headlines}}[[ Next up, {{next.artist}} with {{next.title}}.]]',
    "Here's the news[[ on {{station.name}}]]. {{news.headlines}}[[ Now, {{next.title}}.]]",
    '[[{{greeting}}. ]]Time for the headlines. {{news.headlines}}[[ Then, {{next.artist}}.]]',
    "It's {{clock.rough}}, and this is the news[[ on {{station.name}}]]. {{news.headlines}}",
    // The two that say what this bulletin is ABOUT, which is what makes a categorised band sound
    // like one. Both name `{{news.topic}}` OUTSIDE an optional chunk, so `usable` drops them on an
    // ordinary bulletin rather than the station announcing "the news" twice in different words —
    // that is the same rule every phrasing here follows about `{{news.headlines}}`.
    'Now the {{news.topic}} news. {{news.headlines}}[[ Next up, {{next.artist}}.]]',
    "Here's what's happening in {{news.topic}}[[ on {{station.name}}]]. {{news.headlines}}",
];

/**
 * How many recent bulletins a phrasing avoids repeating.
 *
 * Three, and it is doing less work here than it does for a talk break: the headlines change between
 * bulletins even when the frame does not, so the repetition a listener actually notices is the
 * opening sentence rather than the whole script.
 */
const RECENT_WINDOW = 3;

@Injectable()
export class NewsBreakWriter extends BreakWriter {
    readonly kind = NEWS_KIND;
    readonly name = NEWS_WRITER;

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

        const news = headlinesOf(request.stories ?? []);
        // Nothing to report. See the note on the class: this is the branch that keeps the station
        // from announcing a bulletin it does not have.
        if (news === undefined) {
            // Said here rather than left to the registry's "had nothing to say here", because this
            // is the ONE decline an operator has to be able to act on: a station whose clock asks
            // for news and whose feeds are empty, unreachable, or older than the freshness window
            // is silent at every bulletin, and the generic sentence would not tell them which.
            this.logger.info('director: a bulletin had no news to read, so the station passed over the slot');
            return undefined;
        }

        const dj = (request.persona?.djName ?? this.config.get(TEMPLATE_KEYS.djName, '')).trim();
        // No `previous`, deliberately, and `WelcomeWriter`'s reason applies with a twist: `usable`
        // insists a phrasing say something about the record just finished whenever there is one, and
        // a bulletin that back-announces on its way into the headlines is a presenter who has not
        // decided what this break is. Withholding it makes every phrasing here usable mid-order.
        const inputs: TemplateInputs = {
            news,
            // What this bulletin is about, when a band asked for one. Absent leaves the two phrasings
            // that name it unusable, which is what keeps "Now the technology news" out of a bulletin
            // that is not about technology.
            ...(request.subject === undefined ? {} : { subject: request.subject.label }),
            ...(request.next === undefined ? {} : { next: request.next }),
            ...(request.station === undefined ? {} : { station: request.station }),
            ...(dj.length === 0 ? {} : { dj }),
            ...(request.clock === undefined ? {} : { clock: request.clock.words }),
            ...(request.greeting === undefined ? {} : { greeting: request.greeting.words }),
        };

        const templates = parseTemplates(this.config.get(NEWS_KEYS.templates, ''), NEWS_TEMPLATES);
        this.complainAboutTypos(templates);

        const fits = usable(templates, inputs, spoken);
        // An operator whose every phrasing needs something this moment has not got. The headlines
        // exist and there is no frame to read them in, which is a slot passed over rather than a
        // bare list of sentences with no station attached to them.
        if (fits.length === 0) return undefined;

        const chosen = choose(fits, (request.recent ?? []).slice(0, RECENT_WINDOW));
        this.lastTemplate = chosen.template;

        return {
            script: chosen.script,
            // Named for what it covers, so an operator reading the running order or the script
            // history can tell one bulletin from the next without opening either.
            label: request.subject === undefined ? 'News' : `${request.subject.label} news`,
            claimsNext: chosen.saysNext,
            // Only when the phrasing really says what time it is, which is the answered-rather-than-
            // assumed posture every deterministic writer here takes.
            ...(request.clock !== undefined && saysTime(chosen.script, request.clock)
                ? { claimsTime: { from: request.clock.validFrom, until: request.clock.validUntil } }
                : {}),
        };
    }

    /** Say once, per broken phrasing, that it names something nothing can fill. */
    private complainAboutTypos(templates: readonly string[]): void {
        for (const template of templates) {
            const unknown = unknownPlaceholders(template);
            if (unknown.length === 0 || complainedAbout.has(template)) continue;

            complainedAbout.add(template);
            this.logger.warn(`director: a news phrasing names something the station cannot fill (${unknown.join(', ')}): "${template}"`);
        }
    }
}

/**
 * The stories as one read, or `undefined` when there is nothing to read.
 *
 * Each headline followed by the story's own opening sentence, in the order they arrived. **The
 * safety property is untouched by that second half**, which is the whole reason it is allowed here:
 * a publisher's opening sentence read WORD FOR WORD cannot be wrong about the news any more than
 * their headline can, and it is the same argument `fact.lead.ts` makes about an article's lead
 * standing on its own. What this writer still will not do is summarise, reorder or join, because
 * those are the operations that produce a false sentence in a confident voice.
 *
 * Already speakable when they get here — full stops on, publisher furniture off — because
 * `BulletinSource` did that once for both writers. See {@link BreakStory.headline}.
 */
export function headlinesOf(stories: readonly BreakStory[]): string | undefined {
    const read = stories
        .map(story => [story.headline.trim(), openingSentence(story)].filter(part => part.length > 0).join(' '))
        .filter(part => part.length > 0)
        .join(' ');

    return read.length === 0 ? undefined : read;
}

/**
 * How long an opening sentence may be before it is left out.
 *
 * A bulletin is three of these plus its frame, and a publisher's first sentence is occasionally a
 * whole paragraph with three subordinate clauses in it. Past this it is something to read on a page
 * rather than something to hear, and the headline alone is the better read.
 */
const MAX_SENTENCE_CHARS = 220;

/**
 * How much of a sentence's own words the headline may already carry before it is dropped.
 *
 * The case this exists for is the ordinary one rather than the edge: measured against the station's
 * own feed, an entry's teaser is frequently the article's own first line, which is frequently the
 * headline written out in full. Reading both is a presenter saying the same thing twice, which
 * sounds worse than either alone.
 */
const MAX_HEADLINE_OVERLAP = 0.7;

/**
 * The story's first sentence, as published, or `''` when there is not one worth reading.
 *
 * The article where there is one and the teaser otherwise, for `describeStory`'s reason: they are
 * usually the same words, and the article's version is the one that carries on into a second
 * sentence somebody could have written.
 */
function openingSentence(story: BreakStory): string {
    const prose = (story.body ?? story.summary ?? '').trim();
    if (prose.length === 0) return '';

    // `firstSentence` rather than a split on the first full stop, and the difference is one this
    // read out loud before it was fixed: "Saturday, Aug. 15, 2026" is not two sentences, and a
    // bulletin that stops at "Saturday, Aug." has said something a listener has to unpick.
    const sentence = firstSentence(prose);

    if (sentence.length === 0 || sentence.length > MAX_SENTENCE_CHARS) return '';
    if (restates(story.headline, sentence)) return '';

    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** Whether a sentence says what the headline already said. */
function restates(headline: string, sentence: string): boolean {
    const words = (text: string): string[] =>
        text
            .toLowerCase()
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter(word => word.length > 0);

    const said = new Set(words(headline));
    const repeating = words(sentence);
    if (repeating.length === 0 || said.size === 0) return true;

    // Judged against the SENTENCE's length rather than the headline's: what is being asked is
    // whether the sentence adds anything, and a long sentence that happens to contain a short
    // headline does.
    const shared = repeating.filter(word => said.has(word)).length;
    return shared / repeating.length >= MAX_HEADLINE_OVERLAP;
}

/**
 * Phrasings an operator has typo'd, so the log says so once rather than once a bulletin.
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
