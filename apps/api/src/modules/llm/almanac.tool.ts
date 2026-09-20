import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { AlmanacEntryKind } from '@deadair/plugin-sdk';
import { AlmanacService } from '#modules/almanac/almanac.service.js';
import type { StationTool, ToolSource } from './llm.tools.js';

/**
 * "What happened on this day?", as something a model can ask.
 *
 * ## What comes back is sentences, and the weather's is numbers
 *
 * `WeatherTool`'s answer is a set of measurements the model has to turn into a
 * line. This is the other kind: every entry is already a sentence somebody
 * published, carrying the year it happened and the address it was read at. So
 * the model's job here is to CHOOSE one and say it in its own voice, not to
 * compose a claim — which is the one thing the declaration below spends its
 * words on, because a model handed a list of historical facts will otherwise
 * add the one it happens to remember.
 *
 * ## The bare call is the normal one
 *
 * `get_this_day()` answers about the day the station is having, leaned the way
 * the operator set. There is no date parameter at all, and that is deliberate
 * rather than an omission: which day it is, is a question about the station's
 * own zone and about the moment a break AIRS, and a model that could name a
 * date would sooner or later name the server's one. A presenter wanting last
 * Tuesday is not a thing this station does.
 *
 * ## Nothing here airs
 *
 * An entry is somebody else's sentence. Whether any of it is spoken is a break
 * writer's decision on a station that is on air; this hands over material and
 * has no way to put one on the mount.
 */

/** The sorts of entry a model may ask for, in its own words. */
const KINDS: Record<string, AlmanacEntryKind> = {
    events: 'event',
    births: 'birth',
    deaths: 'death',
    observances: 'observance',
};

/**
 * How many entries the model is shown.
 *
 * Six rather than the day's whole list, which on a busy date is four hundred.
 * The lean has already put the ones this station cares about at the front, so
 * what a longer answer buys is context spent on birthdays the presenter was
 * never going to mention — `MAX_RESULT_CHARS` would cut it anyway, and cutting
 * it here means the cut lands between entries rather than mid-sentence.
 */
const SHOWN = 6;

@Injectable()
export class AlmanacTool implements ToolSource {
    constructor(
        private readonly almanac: AlmanacService,
        private readonly logger: Logger,
    ) {}

    async tools(): Promise<StationTool[]> {
        // Nothing to offer when no almanac plugin is installed, which is the
        // default: a declaration whose every call answers "there is no almanac"
        // spends context teaching the model about a tool that cannot help it.
        // `NewsTool`'s rule, `WeatherTool`'s and `ChartsTool`'s.
        if (!this.almanac.hasAlmanac()) return [];

        return [
            {
                // A date does not move. What the entries say was as true
                // yesterday as it will be tomorrow, and the only thing that can
                // expire is the word "today" in front of them — which is
                // `claims-time`'s own question, stamped by the break writer from
                // the same day window this reads. A talk break that called this
                // and wrote "on this day" down has that stamp only if its writer
                // asks for one, so `claims-time` is the honest answer for the
                // tool and the writers are where it is made true.
                freshness: 'claims-time',
                declaration: {
                    name: 'get_this_day',
                    // Written for the model, and it says three things
                    // deliberately: that calling it bare is the normal way, that
                    // what comes back is somebody else's sentence rather than
                    // the station's, and that the years are not to be
                    // embroidered — which is what stops a model turning "1966"
                    // into a decade it half-remembers.
                    description:
                        "What happened on today's date in other years, from an encyclopaedia, with the anniversaries this station cares about " +
                        'first. Call it with no arguments. Every entry comes back as it was published, with the year it happened: you can say ' +
                        'these on air, and you should not add a fact, a year or a name they do not carry.',
                    parameters: {
                        type: 'object',
                        properties: {
                            kinds: {
                                type: 'array',
                                items: { type: 'string', enum: Object.keys(KINDS) },
                                description:
                                    'Which sorts to ask for: "events" for things that happened, "births" and "deaths" for who was born or died, ' +
                                    '"observances" for a day that comes round every year. Leave it out for whatever the day has.',
                            },
                        },
                        required: [],
                        additionalProperties: false,
                    },
                },
                run: async args => await this.read(args),
            },
        ];
    }

    /**
     * The day, already leaned this station's way.
     *
     * Asked about NOW rather than about a slot, which is the one place this
     * differs from the break source and is right for what it is: a tool runs
     * inside a conversation somebody is having, and the almanac's own day window
     * comes back with the answer so a writer that puts an entry in a script has
     * something to stamp.
     */
    private async read(args: Record<string, unknown>): Promise<unknown> {
        const kinds = readKinds(args.kinds);
        const almanac = await this.almanac.read(Date.now(), { ...(kinds.length === 0 ? {} : { kinds }), limit: SHOWN });

        // The line every tool here carries: "what did the model actually have to
        // work with" has to be answerable from the log alone when a break turns
        // out to have mentioned nothing.
        this.logger.debug('llm: read the day', { kinds: kinds.length === 0 ? 'any' : kinds.join(','), found: almanac?.entries.length ?? 0 });

        if (almanac === undefined) {
            // Said rather than left to be inferred from an empty list, and it is
            // the honest answer: the model cannot otherwise tell "the source is
            // down" from "this station cannot do this", and neither is worth
            // trying again in the same break.
            return { note: 'Nothing is available about the date at the moment. Talk about something else.' };
        }

        return {
            date: almanac.day.date,
            // Named as well as dated, because `09-20` is not something anybody
            // says and a model asked to read a date out of a field will read it
            // out exactly as it found it.
            saidAs: saidAs(almanac.day.month, almanac.day.day),
            entries: almanac.entries.map(entry => ({
                kind: entry.kind,
                ...(entry.year === undefined ? {} : { year: entry.year }),
                text: entry.text,
            })),
        };
    }
}

/** The kinds the model named, in this station's vocabulary. Anything unrecognised is dropped rather than refused. */
function readKinds(value: unknown): AlmanacEntryKind[] {
    const said = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];

    return [
        ...new Set(
            said.flatMap(entry => {
                const kind = typeof entry === 'string' ? KINDS[entry.trim().toLowerCase()] : undefined;
                return kind === undefined ? [] : [kind];
            }),
        ),
    ];
}

/** `20 September`, which is what a presenter would say. The station's own language is not a setting anywhere yet. */
const saidAs = (month: number, day: number): string => `${day} ${MONTHS[month - 1] ?? ''}`.trim();

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
