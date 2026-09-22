import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { AlmanacEntry } from '@deadair/plugin-sdk';
import { ALMANAC_KIND } from '#modules/almanac/almanac.kind.js';
import { AlmanacService, type StationAlmanac } from '#modules/almanac/almanac.service.js';
import { errorText } from '#modules/shared/error.text.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { TALK_BREAK_KIND } from './talk.break.writer.js';

/**
 * The day a break about the date is written from, fetched once and handed to whichever writer takes
 * it.
 *
 * `BulletinSource` and `WeatherSource`'s third sibling, and it exists for their reason: everything
 * decided ONCE — which day, which entries, and which of them this station has already said — is
 * decided here, so the model binding and the floor underneath it see exactly the same substrate. A
 * writer that fetched its own would make the floor do network I/O, which is the one thing a floor
 * must not do.
 *
 * ## Two kinds ask, on opposite terms, and one of them has to be switched on
 *
 * `entriesFor` answers `undefined` for every kind but those two, which keeps `WriteBreakJob` free of
 * a branch about history. `WeatherSource`'s arrangement exactly, and for its reasons.
 *
 * The break ABOUT the date always asks: the entry is the break, and a slot with no entry is a slot
 * the station passes over. The TALK break asks only when `rotation.dateInTalk` is on, and the
 * entries are then offered as colour on a break about a record — `BreakPromptShape.almanac` is where
 * those terms are set out, and most breaks should decline them.
 *
 * It is a SETTING rather than always-on for the weather's reason and one of its own. The talk break
 * is the kind this station makes most of, so this decides whether a source is asked on every link —
 * cheap, since the plugin holds a day for half a day, and not free. And the offer SPENDS: an entry a
 * link mentions is one the band at twenty past can no longer use, so a station that wants both is
 * choosing how to divide one day's material.
 *
 * ## What it is about is the DAY, and there is nothing to resolve
 *
 * The weather resolves a band's location and the bulletin resolves a category. This resolves
 * nothing, because a date is not a choice an operator makes — which is why there is no topic kind
 * for it and why a band on the format clock names the kind and no subject. What the operator DOES
 * choose is which entries the station reaches for first, and that is a setting read inside
 * `AlmanacService` so that both writers see one answer.
 *
 * ## Three ways of having nothing, told apart here and nowhere else
 *
 * No plugin, a service that is down, and a day whose entries this station has already used up: one
 * silence to the writer, three different things for an operator to do. A station whose clock asks
 * for the date every afternoon and is silent every time needs to be told which, so this names the
 * fix in the log and the writer only declines.
 *
 * Those three drop to `debug` on the talk break, `WeatherSource.say`'s rule: nobody asked for the
 * date there, nothing was passed over, and the station makes hundreds of those breaks a day.
 *
 * ## The freshness question is answered by the DAY, not by an age
 *
 * A weather reading expires because the sky moves. An entry cannot: 1966 will be 1966 tomorrow. What
 * expires is the word "today" in front of it, which is exactly `segments.claims_time_from`/`until`,
 * and `StationDay` carries that window from the moment the day was resolved. So there is no maximum
 * age setting here and no fourth way of having nothing — a break written for a day it will not air
 * in is dropped by `break.claims.ts` like any other expired phrasing.
 */

/** What a break about the date was given to read. */
export interface AlmanacReport {
    /**
     * The day and its entries, in the order this station reaches for them.
     *
     * One field rather than the weather's two, and the difference is real: there a reading and its
     * expiry are a measurement and a policy computed from it, while a day and its entries are one
     * answer from one source. Absent when there is nothing to say.
     */
    almanac?: StationAlmanac;
}

/**
 * What the station has already read out about today's date.
 *
 * `ReadLog`'s sibling, and it answers the same question for the same reason: a station with four
 * bands on the clock reading the same anniversary four times is the closest this feature comes to
 * sounding like a loop, and nothing else can tell — every one of those breaks is true.
 *
 * ## In memory, and that is a decision rather than a shortcut
 *
 * What was said is already durable in `script_history`, one row per break. This holds only "may I
 * say it again today", a question with a lifetime of hours, so a restart costs one repeated
 * anniversary instead of a migration and a sweep. `ReadLog`'s argument exactly.
 *
 * ## Forgotten by the DATE rather than by a window
 *
 * A bulletin's log ages out against the freshness window, because a story stops being offerable
 * gradually. An entry stops being spent at midnight, all at once, and the entries for tomorrow are
 * a different set — so the whole log is dropped the first time a break is written for a new day.
 * That also bounds it without a sweep: it never holds more than one day of one station.
 *
 * ## A SINGLETON, injected into a scoped source
 *
 * `ReadLog`'s hardest-won line, restated because the same mistake is free to make again: the job
 * runner opens a scope per execution, so state on the source would be built empty, written once and
 * dropped. A fact of the form "the station already said this" has to outlive the scope that
 * discovered it.
 *
 * ## Marked by the WRITER that used one, not by the source that fetched them
 *
 * The other half of that lesson, and the reason this is injected into the writers rather than
 * reached through the source. `ReadLog.keep` spends its headlines at SELECTION, which cost seven
 * bulletins in two hours when rewrites emptied the window — a rewrite is destructive when selecting
 * is what spends the material. Here the source hands over six entries and only the one that reached
 * a script is spent, so a break that is rewritten, declined or dropped spends nothing.
 */
@Injectable()
export class SaidLog {
    private readonly said = new Set<string>();
    private date?: string;

    /** Whether this entry has already been read out today. */
    has(entry: AlmanacEntry): boolean {
        return this.said.has(key(entry));
    }

    /** Mark an entry a writer actually put in a script. */
    keep(entry: AlmanacEntry, date: string): void {
        this.forget(date);
        this.date = date;
        this.said.add(key(entry));
    }

    /**
     * Drop everything when the station's date has turned over.
     *
     * Called on the way IN as well as when something is kept, which is `ReadLog.forget`'s rule: a
     * station whose every break declines must still be able to start a new day, and pruning only
     * where entries are spent would leave exactly that station's log never aging out.
     */
    forget(date: string): void {
        if (this.date === date) return;

        this.said.clear();
        this.date = date;
    }
}

/**
 * An entry as the thing a listener would hear, so two spellings of one anniversary are one.
 *
 * The year is part of it because the sentences are not always distinguishable without one: two
 * sources' "The Beatles played their last concert." differ by a decade and by nothing else. Keyed on
 * the words rather than on an id for `ReadLog`'s reason — an id is per-source and this is about what
 * the station SAID.
 */
const key = (entry: AlmanacEntry): string =>
    `${entry.year ?? ''}|${entry.text
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()}`;

/**
 * How many entries a writer is handed.
 *
 * Six, which is `AlmanacTool`'s number for its reason: the lean has already put the ones this
 * station cares about at the front, so a longer list is prompt spent on birthdays nobody was going
 * to mention. The floor takes the first entry it has not already said and the model chooses among
 * the same six, which is what keeps "the station said the same thing twice" one question rather
 * than two.
 */
const SHOWN = 6;

/** The `deadair.settings` key for the offer. In the `bulletins` group, beside the weather's own. */
export const ALMANAC_SOURCE_KEYS = {
    inTalk: 'rotation.dateInTalk',
} as const;

/**
 * OFF, so nothing changes for a station that upgrades into this.
 *
 * `DEFAULT_WEATHER_IN_TALK`'s argument, and one more that is this feature's own: the offer spends
 * the day's entries, so switching it on by default would quietly take the material away from a band
 * an operator had already put on the clock.
 *
 * Exported so `settings.registry.ts` declares the same value this reads, which is the arrangement
 * every other setting has.
 */
export const DEFAULT_DATE_IN_TALK = false;

@Injectable()
export class AlmanacSource {
    constructor(
        private readonly almanac: AlmanacService,
        private readonly said: SaidLog,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * What this break has to read out, or `undefined` when it is not that sort of break.
     *
     * @param kind - The segment's kind. Anything but `almanac` answers `undefined`.
     * @param airsAt - When these words will be SPOKEN, which decides which day they are about. A
     *   parameter rather than a clock read for `storiesFor`'s and `readingFor`'s reasons, and it
     *   matters more here than for either: a break written at ten to midnight is about tomorrow's
     *   date, and every entry fetched for the wrong day reads exactly as right as one fetched for
     *   the right one.
     */
    async entriesFor(kind: string, airsAt: number = Date.now()): Promise<AlmanacReport | undefined> {
        // The talk break is behind a setting and the break about the date is not, which is the whole
        // of the difference between a break the entry IS and a break it decorates. Read per break
        // rather than held, as every other switch here is, so an operator turning it on hears it on
        // the next link rather than on the next restart.
        const offered = kind === TALK_BREAK_KIND && settingIsOn(this.config, ALMANAC_SOURCE_KEYS.inTalk, DEFAULT_DATE_IN_TALK);
        if (kind !== ALMANAC_KIND && !offered) return undefined;

        // Asked before anything else, so a station with no almanac plugin costs nothing and says
        // nothing: `BreakPlanner` would not have planted this break if nothing could write the kind,
        // but a plugin can be uninstalled between planting and writing.
        if (!this.almanac.hasAlmanac()) {
            this.say(
                offered,
                'director: a break about the date had no source to ask, so the station passed over the slot. Enable a plugin that can say what ' +
                    'happened on a date — the bundled Wikipedia one does, once it has a contact address.',
            );
            return {};
        }

        try {
            const day = this.almanac.dayFor(airsAt);
            this.said.forget(day.date);

            const almanac = await this.almanac.read(airsAt);
            if (almanac === undefined) {
                // At info rather than debug, and it is worth an operator's attention: a station
                // whose clock asks for the date every afternoon and whose source is refusing is
                // silent every afternoon, and this is what says so.
                this.say(offered, 'director: a break about the date got nothing back, so the station passed over the slot', { date: day.date });
                return {};
            }

            const unsaid = almanac.entries.filter(entry => !this.said.has(entry)).slice(0, SHOWN);
            if (unsaid.length === 0) {
                // The third way, and the only one that is the station working correctly: every entry
                // this day had has already been on air. It names the two settings that widen it,
                // because an operator hearing silence at the same hour every day cannot tell this
                // from a source that has stopped answering.
                this.say(
                    offered,
                    'director: everything the date had has already been read out today, so the station passed over the slot. Fewer bands on the ' +
                        'clock, or "What the station picks out of the day" set wider, would give it more to say.',
                    { date: day.date },
                );
                return {};
            }

            return { almanac: { day: almanac.day, entries: unsaid } };
        } catch (error) {
            // `AlmanacService` already swallows a plugin's failures, so reaching here means
            // something else went wrong — an unknown timezone is the realistic one. Absorbed for the
            // reason everything else here is: a slot the station passes over is something it is
            // built to do, and a throw would take the job with it.
            this.logger.warn(`director: a break about the date could not be prepared (${errorText(error)})`);
            return {};
        }
    }

    /**
     * A decline said at the volume the KIND deserves. `WeatherSource.say`'s rule, restated because
     * the same asymmetry holds: a band on the format clock asking for the date and hearing silence
     * every afternoon is a thing an operator has to be told about, and a link that was simply not
     * offered anything is not.
     */
    private say(offered: boolean, message: string, detail?: Record<string, unknown>): void {
        if (offered) this.logger.debug(message, detail);
        else this.logger.info(message, detail);
    }
}
