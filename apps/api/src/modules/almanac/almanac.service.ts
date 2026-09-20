import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import type { AlmanacDay, AlmanacEntry, AlmanacEntryKind } from '@deadair/plugin-sdk';
import { stationZone } from '#modules/director/clock.words.js';
import { asAlmanacPlugin, type AlmanacPlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { errorText } from '#modules/shared/error.text.js';
import { stationDay, type StationDay } from './almanac.day.js';
import { ALMANAC_KEYS, parseLean } from './almanac.keys.js';
import { leaned, type AlmanacLean } from './almanac.lean.js';

/**
 * What happened on the station's own date, out of whatever almanac plugins are
 * installed.
 *
 * ## One answer, not a merge and not a menu
 *
 * `WeatherService`'s rule, reached from a different direction. Two weather
 * services asked about one place disagree; two almanacs asked about one date
 * OVERLAP — the same handful of famous anniversaries, written twice — and a
 * station that merged them would read the day out with its best lines
 * duplicated. So the first plugin that answers wins and the rest are not asked.
 *
 * ## The date is the station's, and it is the date the words will be HEARD
 *
 * Every caller passes the instant, and `almanac.day.ts` turns it into a day in
 * the operator's own zone. Nothing here ever asks what day it is now: a break
 * written at ten to midnight is about tomorrow, and that is the one mistake this
 * feature cannot recover from, because every entry it hands over would be true
 * of a different day.
 *
 * ## The lean happens here, once
 *
 * A music station reaches for the guitarist before the general, and which
 * entries those are is decided in `almanac.lean.ts` and applied here — so the
 * tool the presenter calls and the break the floor writes cannot lean
 * differently. The plugin is asked for the day UNCAPPED for the same reason: a
 * limit applied upstream cuts the material away before the lean ever sees it,
 * and a day's two hundred birthdays are where its four musicians live.
 *
 * ## A plugin that cannot answer contributes nothing
 *
 * Every call into a plugin is caught and logged rather than thrown, the rule
 * `NewsService`, `SearchService` and `WeatherService` all apply. As with the
 * weather there is usually only one plugin, so a caught failure IS the whole
 * answer, which is why it is logged at `info` with the date on it.
 */

/** What the station has to talk about on one of its own days. */
export interface StationAlmanac {
    /** The day this is about, and how long it stays that day. */
    day: StationDay;
    /**
     * The entries, in the order this station should reach for them.
     *
     * Never empty: a day that came back with nothing is `undefined` from
     * {@link AlmanacService.read}, because "there is nothing to say" and "here
     * is a day with no entries in it" are the same thing to every caller and
     * only one of them is worth a branch.
     */
    entries: AlmanacEntry[];
}

/** What a caller wants out of the day. */
export interface AlmanacReadOptions {
    /** The sorts of entry to consider, or absent for all of them. */
    kinds?: AlmanacEntryKind[];
    /** At most this many entries after the lean, or absent for everything the day had. */
    limit?: number;
}

@Injectable()
export class AlmanacService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** Whether anything can answer at all, for a caller deciding whether to offer the feature. */
    hasAlmanac(): boolean {
        return this.plugins().length > 0;
    }

    /** How this station leans when it reads a day out. A STRING in the table, compared as one. */
    lean(): AlmanacLean {
        return parseLean(this.config.get(ALMANAC_KEYS.lean, ''));
    }

    /** The day an instant falls in, in the station's own zone. */
    dayFor(at: number): StationDay {
        return stationDay(at, stationZone(this.config));
    }

    /**
     * What happened on the day that instant falls in, leaned this station's way.
     *
     * `undefined` covers every way of having nothing — nothing installed, a
     * service that is down, a date with no entries, a lean that kept none of
     * them — because they are one outcome to every caller and the log line is
     * where the difference lives. The one caller that has to tell them apart is
     * the break source, and it asks {@link hasAlmanac} separately for exactly
     * that reason.
     *
     * @param at - When the words will be heard. A writer passes `segments.airs_at`.
     */
    async read(at: number, options: AlmanacReadOptions = {}): Promise<StationAlmanac | undefined> {
        const day = this.dayFor(at);

        const answered = await this.day(day, options.kinds);
        if (answered === undefined) return undefined;

        const ordered = leaned(answered.entries, this.lean());
        const entries = options.limit === undefined || options.limit < 1 ? ordered : ordered.slice(0, options.limit);

        return entries.length === 0 ? undefined : { day, entries };
    }

    /**
     * {@link read} without the lean and without the cap, for a caller that wants
     * the day as the source published it.
     *
     * Separate rather than folded in, for `WeatherService.reading`'s reason: the
     * unleaned day is what a consumer with its own judgement wants, and a caller
     * that had to undo the station's ordering could not.
     */
    async day(day: StationDay, kinds?: AlmanacEntryKind[]): Promise<AlmanacDay | undefined> {
        for (const plugin of this.plugins()) {
            const answered = await this.ask(plugin, day, kinds);
            // The FIRST that answers, and then stop. See the note on this class:
            // a second account of one date is not more history about it.
            if (answered !== undefined) return answered;
        }

        return undefined;
    }

    /**
     * One plugin's answer, defended.
     *
     * A day that came back about a DIFFERENT date is dropped, which is the one
     * check here that is not about a plugin failing: `AlmanacDay.date` exists so
     * a caller can tell an answer from a plugin that quietly read its own clock,
     * and a station reading yesterday's anniversaries as today's would sound
     * exactly right.
     */
    private async ask(plugin: AlmanacPlugin, day: StationDay, kinds?: AlmanacEntryKind[]): Promise<AlmanacDay | undefined> {
        try {
            const answered = await this.pluginInvoker.invoke(plugin.record.id, 'almanac.getDay', async () =>
                plugin.instance.getDay({ month: day.month, day: day.day, ...(kinds === undefined || kinds.length === 0 ? {} : { kinds }) }),
            );

            if (answered === undefined) return undefined;

            if (answered.date !== day.date) {
                this.logger.info(`almanac: a source answered about another day (${plugin.record.id}: asked ${day.date}, got ${answered.date})`);
                return undefined;
            }

            const entries = (answered.entries ?? []).filter(entry => entry?.text?.trim());
            return entries.length === 0 ? undefined : { ...answered, entries };
        } catch (error) {
            this.logger.info(`almanac: a source could not be asked (${plugin.record.id}: ${day.date}: ${errorText(error)})`);
            return undefined;
        }
    }

    /** Every plugin that can answer right now, in a stable order. */
    private plugins(): AlmanacPlugin[] {
        return pluginsWith(this.pluginRegistry.list(), asAlmanacPlugin).sort(byPluginId);
    }
}
