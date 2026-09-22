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
 * What the station says when the timetable changes the programme.
 *
 * The floor under the changeover, in the sense `WelcomeWriter` is the floor under a greeting: no
 * network, no model, no way to fail that costs the station a line it could have had.
 *
 * ## Where it airs, and why that is after the boundary
 *
 * It is asked for through `requestBreak` once a scheduled `putOnAir` has replaced the running order,
 * and placed the way a welcome is: rendered first, then put in front of the first record at or after
 * the head. That record is the new programme's first, so the break airs between the record that was
 * on when the clock changed over and the one that opens the next show — which is where a presenter
 * would say it. The alternative, a sign-off planted in the outgoing order ahead of its last record,
 * would need the order to know where its block ends, and it deliberately does not: the schedule says
 * what should be on air and never when the changeover happens.
 *
 * Being in the NEW broadcast is also what lets it through every sweep a changeover runs. It is
 * written under whoever is presenting now, so a recast never reads it as out of character; its
 * request carries the new broadcast's id, so it is not expired as belonging to the old one; and it
 * is not among the outgoing items a changeover retires.
 *
 * ## Looking neither back nor forward
 *
 * It is built with no `previous` and no `next`, even when the request carries them. The record that
 * just finished belonged to the other show, and the one coming up is a promise nothing polices on a
 * piece whose job is the shows rather than the records. `JingleWriter` withholds both for the second
 * reason.
 *
 * ## Which phrasing, when several fit
 *
 * The most specific one that can be said. A different host is thanked by name when a phrasing can do
 * it; failing that, the incoming show is named; failing that, the show that ended; and only then is
 * anything that fits eligible. So an operator writes one list covering all three moments (a new host,
 * the same host into another show, a block ending into the sustaining source) and the substrate
 * decides which of their lines apply, with no second syntax.
 */

/** The kind of segment this writes. The same string as `segments.kind`. */
export const CHANGEOVER_KIND = 'changeover';

/** What `segments.writer` records for anything written here. */
export const CHANGEOVER_WRITER = 'deterministic';

/** The `deadair.settings` key for the phrasings. In `rotation`, beside the station's other words. */
export const CHANGEOVER_KEYS = {
    templates: 'rotation.changeoverTemplates',
} as const;

/**
 * The station's own words for a change of programme.
 *
 * The DEFAULT of `rotation.changeoverTemplates`, so clearing the box restores these rather than
 * silencing the change, and the way to stop the station marking one is `rotation.changeovers`.
 *
 * Every greeting sits in an optional chunk, as the welcome's do, because `dayGreeting` answers with
 * nothing in the small hours and a phrasing that required one would leave a change of programme at
 * three in the morning unmarked.
 */
export const CHANGEOVER_TEMPLATES: readonly string[] = [
    // A different host, thanked by name. Picked first whenever the outgoing host has a name to say.
    'Thanks to {{outgoing.name}}[[ for {{outgoing.show}}]]. This is {{station.name}}[[, and this is {{show.name}}]][[ with {{dj.name}}]].',
    '[[{{greeting}}. ]]{{outgoing.name}} has handed over to {{dj.name}}[[ for {{show.name}}]], here on {{station.name}}.',
    // A show starting, whoever is presenting it. What a host carrying on into their own next show says.
    'That takes us into {{show.name}}, here on {{station.name}}[[ with {{dj.name}}]].',
    '[[{{greeting}}. ]]This is {{show.name}}, on {{station.name}}.',
    // A block ending into the sustaining source: the show that ended is the only one there is to name.
    "That's the end of {{outgoing.show}}. You're still listening to {{station.name}}.",
    // Anything at all, for a station that named neither show. The last resort, never the first pick.
    '[[{{greeting}}. ]]This is {{station.name}}[[, with {{dj.name}}]].',
];

/**
 * How many recent changeovers a writer avoids repeating.
 *
 * Small because the station makes few of them: a timetable of four blocks makes four a day, so the
 * repetition a listener could notice is two days running at the same hour.
 */
const RECENT_WINDOW = 3;

@Injectable()
export class ChangeoverWriter extends BreakWriter {
    readonly kind = CHANGEOVER_KIND;
    readonly name = CHANGEOVER_WRITER;

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

        const change = request.changeover;
        const dj = (request.persona?.djName ?? this.config.get(TEMPLATE_KEYS.djName, '')).trim();
        const outgoing = change?.outgoing?.djName?.trim();

        // No `previous` and no `next`, deliberately and even when there are some. See the note on the
        // class: the record behind belonged to the other show, and the one ahead is not this piece's
        // business.
        const inputs: TemplateInputs = {
            ...(request.station === undefined ? {} : { station: request.station }),
            ...(dj.length === 0 ? {} : { dj }),
            ...(request.greeting === undefined ? {} : { greeting: request.greeting.words }),
            ...(outgoing === undefined || outgoing.length === 0 ? {} : { outgoing }),
            ...(change?.outgoingShow === undefined ? {} : { outgoingShow: change.outgoingShow }),
            ...(change?.incomingShow === undefined ? {} : { show: change.incomingShow }),
        };

        // Read per changeover rather than held, so an operator editing them hears it at the next one.
        const templates = parseTemplates(this.config.get(CHANGEOVER_KEYS.templates, ''), CHANGEOVER_TEMPLATES);
        this.complainAboutTypos(templates);

        const fits = mostSpecific(usable(templates, inputs, spoken), [inputs.outgoing, inputs.show, inputs.outgoingShow]);
        // No station name and no show on either side: there is no true sentence to be made of that.
        if (fits.length === 0) return undefined;

        const chosen = choose(fits, (request.recent ?? []).slice(0, RECENT_WINDOW));
        this.lastTemplate = chosen.template;

        return {
            script: chosen.script,
            label: 'Changeover',
            // What a player shows while it airs: the show it opens, which is what a listener glancing
            // at the screen wants to know, or the station's own name when the station opened none.
            listenerLabel: change?.incomingShow ?? request.station ?? 'Changeover',
            // Only when the words really carry the greeting, as the welcome does: a phrasing whose
            // greeting chunk was dropped made no claim about the time of day.
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
            this.logger.warn(`director: a changeover phrasing names something the station cannot fill (${unknown.join(', ')}): "${template}"`);
        }
    }
}

/**
 * The phrasings that say the first of these words they can, or every phrasing when none says any.
 *
 * Ranked rather than pooled, which is the whole of how one list covers three moments. Checked on the
 * rendered SCRIPT rather than on the template, because a word in an optional chunk that was filled is
 * as said as one outside it, and one in a chunk that was dropped is not said at all.
 */
export function mostSpecific(fits: readonly RenderedTemplate[], words: readonly (string | undefined)[]): readonly RenderedTemplate[] {
    for (const word of words) {
        if (word === undefined || word.length === 0) continue;

        const saying = fits.filter(one => one.script.includes(word));
        if (saying.length > 0) return saying;
    }

    return fits;
}

/**
 * Phrasings an operator has typo'd, so the log says so once rather than once a changeover.
 *
 * Module-level for `TalkBreakWriter`'s reason: the writer is resolved per job.
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
