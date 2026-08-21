import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak } from './break.writer.js';
import { parseTemplates, unknownPlaceholders, usable, wasHeard, type RenderedTemplate, type TemplateInputs } from './break.templates.js';
import { spoken } from './talk.break.writer.js';

/**
 * What the station says to somebody who tuned in before it had any music.
 *
 * A record is not committed until its bytes are on this machine, which is what keeps Liquidsoap's
 * resolve off the provider. The cost of that rule is a stretch at the very start of a running order
 * where the station has a full hour planned and cannot play a second of it: a fresh install, an
 * imported playlist, a replan, a briefed refill whose every record was discovered at a provider.
 * Every one of those is minutes long on a first download, and until this existed a listener who
 * arrived into it heard nothing at all and had no way to tell that from a station that was broken.
 *
 * ## The floor under the floor
 *
 * There is deliberately no model binding for this kind and there should not be one. A holding
 * message is wanted at exactly the moment the station is least able to produce anything — it is
 * already waiting on a network it cannot reach quickly — and a writer that could be slow is a writer
 * that arrives after the records it was covering for. So this is the only writer of `warmup`, it
 * touches nothing but its own phrasings, and it cannot fail.
 *
 * ## It says nothing about the music
 *
 * No `{{next.*}}`, and that is a correctness rule rather than a stylistic one. The records this is
 * covering for are precisely the ones the station has NOT got hold of, and `DirectorService.thin`
 * may take any of them out of the order before their slots arrive. A holding message that promised
 * one would be a forward claim about the least trustworthy item in the running order — the exact
 * thing `segments.claims_item_id` exists to police. So it talks about the station and the wait, and
 * the first thing a listener hears named is a record that is actually going to play.
 */

/** The kind of segment this writes. The same string as `segments.kind`. */
export const WARMUP_KIND = 'warmup';

/** What `segments.writer` records for anything written here. */
export const WARMUP_WRITER = 'deterministic';

/** The `deadair.settings` key for the phrasings. In `rotation`, beside the station's other words. */
export const WARMUP_KEYS = {
    templates: 'rotation.warmupTemplates',
} as const;

/**
 * The station's own holding messages.
 *
 * The DEFAULT of `rotation.warmupTemplates`, so an operator who clears the box gets these back
 * rather than a station that goes quiet at the one moment it most needs to speak. That is
 * `DEFAULT_TEMPLATES`' rule, and the way to stop this happening at all is to have the records here
 * before anybody arrives.
 *
 * Every one of them works with nothing filled in but the station's name, and the name itself sits in
 * an optional chunk, because an operator who has not set `stream.title` still has a listener waiting.
 * Nothing here names a record; see the note on the class.
 */
export const WARMUP_TEMPLATES: readonly string[] = [
    "You're early[[ — this is {{station.name}}]]. Give us a moment while the music loads.",
    '[[{{station.name}}. ]]Just getting the records out. Stay with us.',
    'Nearly there[[ on {{station.name}}]]. The first track is on its way.',
    "[[{{greeting}}. ]]We're warming up[[ here on {{station.name}}]]. Music in a moment.",
];

/**
 * How many recent holding messages a writer avoids repeating.
 *
 * Larger than the welcome's window relative to the pool, because these are heard BACK TO BACK by one
 * listener rather than one each by several. The whole pool minus one is the most that can be asked
 * for without leaving nothing to choose from.
 */
const RECENT_WINDOW = 3;

@Injectable()
export class WarmUpWriter extends BreakWriter {
    readonly kind = WARMUP_KIND;
    readonly name = WARMUP_WRITER;

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

        // Neither `previous` nor `next`, whatever the request carries. There is no previous by
        // definition — nothing has played — and naming the next record would promise the one item in
        // the order least likely to survive to its slot. See the note on the class.
        const inputs: TemplateInputs = {
            ...(request.station === undefined ? {} : { station: request.station }),
            ...(request.greeting === undefined ? {} : { greeting: request.greeting.words }),
        };

        const templates = parseTemplates(this.config.get(WARMUP_KEYS.templates, ''), WARMUP_TEMPLATES);
        this.complainAboutTypos(templates);

        const fits = usable(templates, inputs, spoken);
        // Only reachable if an operator has replaced every phrasing with one that needs something
        // this cannot fill. The station stays quiet, which is where it was before any of this.
        if (fits.length === 0) return undefined;

        const chosen = choose(fits, (request.recent ?? []).slice(0, RECENT_WINDOW));
        this.lastTemplate = chosen.template;

        // No `claimsNext` and no `claimsTime`: it promises no record, and "in a moment" is not a
        // claim about the clock that `timeClaimIn` could narrow or a boundary could falsify.
        return { script: chosen.script, label: 'Warming up' };
    }

    /** Say once, per broken phrasing, that it names something nothing can fill. */
    private complainAboutTypos(templates: readonly string[]): void {
        for (const template of templates) {
            const unknown = unknownPlaceholders(template);
            if (unknown.length === 0 || complainedAbout.has(template)) continue;

            complainedAbout.add(template);
            this.logger.warn(`director: a warm-up phrasing names something the station cannot fill (${unknown.join(', ')}): "${template}"`);
        }
    }
}

/**
 * Phrasings an operator has typo'd, so the log says so once rather than once a break.
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
