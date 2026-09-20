import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import type { AlmanacEntry } from '@deadair/plugin-sdk';
import { ALMANAC_KIND } from '#modules/almanac/almanac.kind.js';
import type { StationDay } from '#modules/almanac/almanac.day.js';
import { SaidLog } from './almanac.source.js';
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
 * The station saying what happened on today's date.
 *
 * The floor under a break about the date, in the sense `NewsBreakWriter` and `WeatherBreakWriter`
 * are floors: no network, no model, and no way to fail that costs the station a break it could have
 * had. What makes it a different KIND rather than another pool of talk-break phrasings is what it is
 * about — a talk break is about the records either side of it, a bulletin about something that
 * happened today, and this about something that happened on today's date in another year.
 *
 * ## It frames a sentence and never writes one
 *
 * This is the bulletin's safety property in its strictest form. A bulletin may reword a headline
 * into what an anchor would say; this may not touch the entry at all. Everything after the frame is
 * the source's own sentence, verbatim, so the claim and its evidence are the same span — the rule
 * `fact.lead.ts` keeps, which is the only reason a deterministic writer is allowed near a
 * historical claim in the first place.
 *
 * What the frame is allowed to add is the YEAR and the KIND, and nothing else. Both came from the
 * source as data, so "Born on this day in 1966" states no more than the entry does. It may not say
 * what a year was like, what somebody is famous for, or that anything is a milestone: every one of
 * those is a sentence nothing can check against a source, and the model binding in front of this is
 * allowed to be warmer and is checked harder for it.
 *
 * ## An entry is spent when it reaches a script
 *
 * `SaidLog` is marked HERE rather than in the source, so a break that is declined, rewritten or
 * dropped spends nothing — see the note on that class for the seven bulletins that lesson cost.
 *
 * ## No entry means no break
 *
 * `write` answers `undefined` when there is nothing to read out, and that is the important branch
 * rather than an edge case: no plugin, a source that is down, and a day this station has already
 * used up all arrive here the same way. A break that announced a piece of history and then gave none
 * is worse than the slot being passed over. **Which of those it was is said by `AlmanacSource`**,
 * because this writer sees only the absence.
 *
 * ## The phrasings are the operator's, and are their own set
 *
 * `rotation.almanacTemplates`, defaulting to {@link ALMANAC_TEMPLATES}, in the syntax
 * `break.templates.ts` already parses, with `{{almanac.report}}` for the entry itself and
 * `{{almanac.date}}` for the day it is about. Not chained into the persona's `templates`, for
 * `NewsBreakWriter`'s reason: those are written as back-announces, and "That was X, from Y" is not
 * how a piece of history opens.
 */

/** The kind of segment this writes. The same string as `segments.kind`, and what a clock band names. */
export { ALMANAC_KIND };

/** What `segments.writer` records for anything written here. */
export const ALMANAC_WRITER = 'deterministic';

/** The `deadair.settings` key for the phrasings. In `rotation`, beside the station's other words. */
export const ALMANAC_BREAK_KEYS = {
    templates: 'rotation.almanacTemplates',
} as const;

/**
 * The station's own ways of reading the date out.
 *
 * The DEFAULT of `rotation.almanacTemplates`, so an operator who clears the box gets these back
 * rather than a station that announces a piece of history and reads none — the same rule the other
 * pools follow, and the way to stop the station doing this is to take `almanac` off the clock.
 *
 * Every one of them puts `{{almanac.report}}` outside an optional chunk, which is not a style
 * choice: a phrasing that could drop the entry is a phrasing that can produce "A bit of history for
 * you. Next up, The Cure." Everything else is optional, so a station with no name and nothing coming
 * up still has all of them available.
 *
 * Each one also puts the report after a full stop, because {@link reportOf} writes a capitalised
 * sentence — the entry is a sentence rather than a phrase, which is what a station actually says.
 */
export const ALMANAC_TEMPLATES: readonly string[] = [
    'A bit of history[[ on {{station.name}}]]. {{almanac.report}}[[ Now, {{next.title}}.]]',
    '[[{{greeting}}. ]]This day in history. {{almanac.report}}[[ Then, {{next.artist}}.]]',
    'Something for the date. {{almanac.report}}[[ Coming up, {{next.artist}} with {{next.title}}.]]',
    // The one that says WHICH day, which is what makes the rest of it land. `{{almanac.date}}` is
    // outside an optional chunk, so `usable` drops this phrasing rather than the station saying
    // "It's  today" — the same rule every phrasing here follows about the entry itself.
    "It's {{almanac.date}}[[ on {{station.name}}]]. {{almanac.report}}",
    '{{almanac.report}}[[ And now, {{next.title}}.]]',
];

/**
 * How many recent breaks a phrasing avoids repeating.
 *
 * Three, as for the weather, and it is doing less work here than it looks: the entry itself changes
 * every break, because `SaidLog` spends each one. What this stops is the frame around them reading
 * identically twice in an afternoon.
 */
const RECENT_WINDOW = 3;

@Injectable()
export class AlmanacBreakWriter extends BreakWriter {
    readonly kind = ALMANAC_KIND;
    readonly name = ALMANAC_WRITER;

    /** Which phrasing produced the last line, for the record. See {@link detailOfLastWrite}. */
    private lastTemplate?: string;

    constructor(
        private readonly config: AppConfig,
        private readonly said: SaidLog,
        private readonly logger: Logger,
    ) {
        super();
    }

    detailOfLastWrite(): WriteDetail | undefined {
        return this.lastTemplate === undefined ? undefined : { source: this.lastTemplate };
    }

    async write(request: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        this.lastTemplate = undefined;

        // The first entry, which is the one this station leans toward: the source has already put
        // them in order and taken out everything said today. Choosing differently here would be the
        // floor disagreeing with the lean an operator set.
        const entry = request.almanac?.entries[0];
        const day = request.almanac?.day;
        // Nothing to read out. See the note on the class: this is the branch that keeps the station
        // from announcing a piece of history it has not got.
        if (entry === undefined || day === undefined) return undefined;

        const dj = (request.persona?.djName ?? this.config.get(TEMPLATE_KEYS.djName, '')).trim();

        // No `previous`, deliberately, and for `NewsBreakWriter`'s reason: `usable` insists a
        // phrasing say something about the record just finished whenever there is one, and a piece
        // of history that back-announces on its way into it is a presenter who has not decided what
        // this break is.
        const inputs: TemplateInputs = {
            almanac: reportOf(entry),
            almanacDate: saidAs(day),
            ...(request.next === undefined ? {} : { next: request.next }),
            ...(request.station === undefined ? {} : { station: request.station }),
            ...(dj.length === 0 ? {} : { dj }),
            ...(request.clock === undefined ? {} : { clock: request.clock.words }),
            ...(request.greeting === undefined ? {} : { greeting: request.greeting.words }),
        };

        const templates = parseTemplates(this.config.get(ALMANAC_BREAK_KEYS.templates, ''), ALMANAC_TEMPLATES);
        this.complainAboutTypos(templates);

        const fits = usable(templates, inputs, spoken);
        // An operator whose every phrasing needs something this moment has not got. The entry exists
        // and there is no frame to read it in, which is a slot passed over rather than a bare
        // sentence with no station attached to it.
        if (fits.length === 0) return undefined;

        const chosen = choose(fits, (request.recent ?? []).slice(0, RECENT_WINDOW));
        this.lastTemplate = chosen.template;

        // Spent here, where the entry has actually reached a script. See `SaidLog`.
        this.said.keep(entry, day.date);

        return {
            script: chosen.script,
            // Named for the day it is about, so an operator reading the running order or the script
            // history can tell one of these from the next without opening either.
            label: `This day: ${day.date}`,
            // The same fact for a listener, and it is deliberately not the date: what somebody sees
            // on a player is what the break IS, and every one of these is the same thing.
            listenerLabel: 'This day in history',
            claimsNext: chosen.saysNext,
            // UNCONDITIONAL, and this is the claim that makes the whole kind safe. Every phrasing
            // here carries `{{almanac.report}}` outside its optional parts, so a break that got this
            // far has said "on this day" about a particular date — and the one thing that can make
            // it false is the date changing underneath it. The window is the station's own day, from
            // `almanac.day.ts`, and `break.claims.ts` drops a break that reaches its slot outside it
            // exactly as it drops an expired clock phrasing.
            //
            // It replaces rather than accompanies a clock claim: a phrasing here can also say what
            // time it is, and the narrower of the two windows is always this one's — a rough time is
            // minutes wide and a day is a day. Nothing needs to choose, because `claimsTime` holds
            // one window and the day is the one every phrasing here earns.
            claimsTime: { from: day.from, until: day.until },
        };
    }

    /** Say once, per broken phrasing, that it names something nothing can fill. */
    private complainAboutTypos(templates: readonly string[]): void {
        for (const template of templates) {
            const unknown = unknownPlaceholders(template);
            if (unknown.length === 0 || complainedAbout.has(template)) continue;

            complainedAbout.add(template);
            this.logger.warn(`director: a phrasing for the date names something the station cannot fill (${unknown.join(', ')}): "${template}"`);
        }
    }
}

/**
 * One entry as a sentence the station can say, frame and all.
 *
 * `reportOf`'s opposite number in the weather writer, and the rule is the same one read from a third
 * side: that one STATES figures a service measured, and this one QUOTES a sentence somebody
 * published. Everything after the frame is the entry's own text, untouched — see the note on the
 * class for why a deterministic writer is allowed to handle a historical claim only on those terms.
 *
 * The frame says what sort of entry it is and what year it was, which are the two things the source
 * sent as data. An entry with no year is framed as today rather than as a year, which is what an
 * observance is.
 *
 * A capitalised sentence rather than a phrase, because that is what a station says and because it
 * lets every phrasing put it after a full stop rather than each one guessing at a join.
 */
export function reportOf(entry: AlmanacEntry): string {
    const text = entry.text.trim().replace(/[.\s]+$/, '');
    const year = yearOf(entry.year);

    // The source's own capitalisation, untouched: lowering the first letter reads as a correction
    // and gets "christian feast day" and "independence Day" wrong in opposite directions.
    if (entry.kind === 'observance') return `Today is ${text}.`;
    if (year === undefined) return `${text}.`;

    if (entry.kind === 'birth') return `Born on this day in ${year}: ${text}.`;
    // Plain rather than gentle, and deliberately so: "we lost" is the station having a feeling about
    // somebody, which is exactly the sort of sentence nothing can check against a source. The model
    // binding in front of this is where warmth belongs.
    if (entry.kind === 'death') return `Died on this day in ${year}: ${text}.`;

    return `On this day in ${year}: ${text}.`;
}

/**
 * The year as the station says it, or `undefined` for an entry that carries none.
 *
 * `44 BC` for a negative year, which is the arithmetic every source already does. A station is
 * unlikely to say it, and answering something wrong would be worse than answering something rare.
 */
function yearOf(year: number | undefined): string | undefined {
    if (year === undefined || !Number.isFinite(year) || year === 0) return undefined;
    return year < 0 ? `${Math.abs(year)} BC` : String(year);
}

/**
 * The date as somebody would say it: `20 September`.
 *
 * Built here rather than taken from `StationDay.date`, which is `09-20` — a key, and a thing no
 * presenter has ever said out loud. English month names and day-before-month, which is what the rest
 * of this station's own phrasings assume; a station broadcasting in another language rewrites the
 * phrasings and loses only this placeholder.
 */
export const saidAs = (day: StationDay): string => `${day.day} ${MONTHS[day.month - 1] ?? ''}`.trim();

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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
