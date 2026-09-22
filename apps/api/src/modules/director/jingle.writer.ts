import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { padCue } from '#modules/render/pad.cues.js';
import { padsAreOn } from '#modules/render/pad.settings.js';
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
import { spoken } from './talk.break.writer.js';

/**
 * The station's own jingle: a few seconds between two records that says whose station this is.
 *
 * What a station with nobody recording its imaging says instead. An operator who drops files in
 * `media/segments/inbox/jingle/` never hears these, because a recording is drawn first (see
 * {@link yieldsToRecordings}); this is what makes jingles work on a fresh install, where the
 * CC0-or-nothing rule means the image ships no audio of its own.
 *
 * ## No model, and there should not be one
 *
 * A jingle is a fixed line, said often. Everything a model adds to that is variety, and variety is
 * the opposite of what imaging is for: the point is that a listener recognises it. It would also put
 * a write at the one model slot every few records for a sentence the station already knows, queued
 * behind the breaks that actually need one. So this is the only writer of `jingle` and it cannot
 * fail.
 *
 * ## It says nothing about the music, and nothing about the time
 *
 * No `{{previous.*}}`, no `{{next.*}}` and no `{{greeting}}`, whatever the request carries. A jingle is
 * planted by a spacing rule that knows nothing about what it sits between, it is placed an hour ahead
 * and it is not re-checked against a claim at hand-over, so it must make none: a jingle that named
 * the next record would be a forward claim nothing polices, and one that said good morning could air
 * at noon. That is also what keeps `usable`'s back-announce rule out of the way, since with no
 * `previous` there is nothing it can insist on.
 *
 * ## A jingle IS the sting
 *
 * Where the presenter has a soundboard, every jingle ends on a hit from it. The talk-break floor
 * spaces its hits out ({@link BreakWriteRequest.pads} says why: an air horn on a schedule is a fault
 * in a presenter), and that reasoning is about somebody TALKING. Imaging is the one place a station
 * makes the same noise on purpose.
 */

/** The kind of segment this writes. The same string as `segments.kind`. */
export const JINGLE_KIND = 'jingle';

/** What `segments.writer` records for anything written here. */
export const JINGLE_WRITER = 'deterministic';

/**
 * The `deadair.settings` key for the phrasings. In the `phrasings` group, drawn on the Voice page's
 * Phrasings tab; the `rotation.` prefix is from when they sat under Rotation, kept so a stored row
 * still answers.
 */
export const JINGLE_KEYS = {
    templates: 'rotation.jingleTemplates',
} as const;

/**
 * The station's own jingles.
 *
 * The DEFAULT of `rotation.jingleTemplates`, so an operator who clears the box gets these back
 * rather than a station that plants jingles and then skips every one of them for want of words.
 *
 * Short on purpose: a jingle is heard between two records, and a line that runs past a few seconds
 * is a talk break wearing the wrong label. The presenter's name is always optional, because most
 * stations have not given themselves one.
 */
export const JINGLE_TEMPLATES: readonly string[] = [
    "You're listening to {{station.name}}.",
    '{{station.name}}.[[ With {{dj.name}}.]] More music, right now.',
    'This is {{station.name}}.',
    '{{station.name}}: all the records, none of the dead air.',
    'Stay right there. {{station.name}}.',
    "[[{{dj.name}} on ]]{{station.name}}. Here's another one.",
];

/**
 * How many recent jingles a writer avoids repeating.
 *
 * The whole pool minus one, `WarmUpWriter`'s choice and its reason: these are heard back to back by
 * the same listener, several an hour, so the window is as long as the pool allows while still
 * leaving something to choose.
 */
const RECENT_WINDOW = JINGLE_TEMPLATES.length - 1;

@Injectable()
export class JingleWriter extends BreakWriter {
    readonly kind = JINGLE_KIND;
    readonly name = JINGLE_WRITER;
    /**
     * A recording of this kind is drawn before anything is written. An operator who recorded
     * jingles wants to hear those, and these words are for a station that has none.
     */
    override readonly yieldsToRecordings = true;

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
        // The station and the presenter and nothing else, even when the request carries more. See
        // the note on the class for why a jingle names no record and no time of day.
        const inputs: TemplateInputs = {
            ...(request.station === undefined ? {} : { station: request.station }),
            ...(dj.length === 0 ? {} : { dj }),
        };

        const templates = parseTemplates(this.config.get(JINGLE_KEYS.templates, ''), JINGLE_TEMPLATES);
        this.complainAboutTypos(templates);

        const fits = usable(templates, inputs, spoken);
        // Only reachable with no station name and every phrasing needing one. The slot is skipped,
        // which is what a station with nothing to say between two records already does.
        if (fits.length === 0) return undefined;

        const chosen = choose(fits, (request.recent ?? []).slice(0, RECENT_WINDOW));
        this.lastTemplate = chosen.template;

        // No `listenerLabel`: the mount carries the station's name while this airs, which is what a
        // jingle is saying anyway. No claims, for the reason on the class.
        return { script: this.withSting(chosen.script, request.pads), label: 'Jingle' };
    }

    /**
     * The words, ending on the least recently hit pad where the presenter has a rack.
     *
     * `request.pads` arrives least recently hit first, which is `PadRepository.onSet`'s order, so the
     * first is the one to take. `WriteBreakJob` resolves the cue onto the row and rests the pad, and
     * a render that cannot join it speaks the words alone.
     */
    private withSting(script: string, pads: readonly string[] | undefined): string {
        const pad = pads?.[0];
        if (pad === undefined || !padsAreOn(this.config)) return script;

        return `${script} ${padCue(pad)}`;
    }

    /** Say once, per broken phrasing, that it names something nothing can fill. */
    private complainAboutTypos(templates: readonly string[]): void {
        for (const template of templates) {
            const unknown = unknownPlaceholders(template);
            if (unknown.length === 0 || complainedAbout.has(template)) continue;

            complainedAbout.add(template);
            this.logger.warn(`director: a jingle phrasing names something the station cannot fill (${unknown.join(', ')}): "${template}"`);
        }
    }
}

/**
 * Phrasings an operator has typo'd, so the log says so once rather than once a jingle.
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
