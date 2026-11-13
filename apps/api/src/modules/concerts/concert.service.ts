import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import type { Concert, FestivalListing } from '@deadair/plugin-sdk';
import { asConcertsPlugin, type ConcertsPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { byPluginId } from '#modules/plugins/plugin.selection.js';
import { errorText } from '#modules/shared/error.text.js';
import { stationLocation } from '#modules/shared/station.home.js';
import { WEATHER_KEYS } from '#modules/weather/weather.keys.js';

/**
 * When an artist is next playing near the station, out of whatever concert plugins are installed.
 *
 * Nothing here throws: no plugin, no location and a service that is down all answer with no date,
 * which a break treats as the ordinary case of an artist who is not coming. It holds no cache, for
 * `WeatherModule`'s reason, and nothing is stored, because a date goes stale in a way a record's
 * facts do not.
 */
@Injectable()
export class ConcertService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * The soonest show by `artist` near the station inside the two dates, or `undefined`.
     *
     * @param from - The first date that counts, `YYYY-MM-DD`, on the station's calendar.
     * @param until - The last date that counts, the same way.
     */
    async nextDate(artist: string, from: string, until: string): Promise<Concert | undefined> {
        const place = stationLocation(this.config.get(WEATHER_KEYS.location, ''));
        if (place === undefined || artist.trim().length === 0) return undefined;

        for (const plugin of this.plugins()) {
            const concerts = await this.ask(plugin, artist.trim(), place, from);
            // The first plugin with a date, and then stop: two ticket services hold the same shows.
            const soonest = concerts.filter(concert => usable(concert) && concert.startsOn >= from && concert.startsOn <= until)[0];
            if (soonest !== undefined) return soonest;
        }

        return undefined;
    }

    /**
     * Festivals by name from every concert plugin that can list them, for an operator about to add one.
     * Every plugin is asked, since this is a person looking rather than a break writing, and the answers
     * are kept apart by who gave them. A plugin that throws is named in `unanswered` rather than failing
     * the lookup, so an empty answer is never read as nothing being on.
     */
    async findFestivals(name: string, from: string): Promise<{ listings: (FestivalListing & { pluginId: string })[]; unanswered: string[] }> {
        const listings: (FestivalListing & { pluginId: string })[] = [];
        const unanswered: string[] = [];
        for (const plugin of this.plugins()) {
            const find = plugin.instance.findFestivals?.bind(plugin.instance);
            if (find === undefined) continue;
            try {
                const found: unknown = await this.pluginInvoker.invoke(plugin.record.id, 'concerts.findFestivals', async () => find({ name, from }));
                // A third-party plugin's answer is checked here rather than trusted, so one malformed
                // listing costs that listing and never the lookup.
                const usable = Array.isArray(found) ? found.flatMap(listing => usableListing(listing)) : [];
                listings.push(...usable.map(listing => ({ ...listing, pluginId: plugin.record.id })));
            } catch (error) {
                this.logger.info(`concerts: a service could not look up a festival (${plugin.record.id}: ${errorText(error)})`);
                unanswered.push(plugin.manifest.name);
            }
        }
        return { listings: listings.sort((left, right) => left.startsOn.localeCompare(right.startsOn)), unanswered };
    }

    private async ask(plugin: ConcertsPlugin, artist: string, place: string, from: string): Promise<Concert[]> {
        try {
            const concerts = await this.pluginInvoker.invoke(plugin.record.id, 'concerts.getConcerts', async () =>
                plugin.instance.getConcerts({ artist, place, from }),
            );
            return [...concerts].sort((left, right) => left.startsOn.localeCompare(right.startsOn));
        } catch (error) {
            this.logger.info(`concerts: a service could not be asked (${plugin.record.id}: ${artist}: ${errorText(error)})`);
            return [];
        }
    }

    private plugins(): ConcertsPlugin[] {
        return this.pluginRegistry
            .list()
            .map(asConcertsPlugin)
            .filter((plugin): plugin is ConcertsPlugin => plugin !== undefined)
            .sort((left, right) => byPluginId(left, right));
    }
}

/** A listing with the two things a presenter would say. Anything less cannot be announced. */
const usable = (concert: Concert): boolean => /^\d{4}-\d{2}-\d{2}$/.test(concert.startsOn) && concert.venue.trim().length > 0;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/**
 * A plugin's festival listing with only what it got right: a listing with no id, name or real first day is
 * dropped, an end before its start becomes the start, a page link that is not http(s) is left off, and a bill
 * that is not a list of names becomes the names it holds.
 */
export function usableListing(value: unknown): FestivalListing[] {
    if (typeof value !== 'object' || value === null) return [];
    const listing = value as Record<string, unknown>;
    if (!nonEmpty(listing.id) || !nonEmpty(listing.name) || typeof listing.startsOn !== 'string' || !DATE.test(listing.startsOn)) return [];

    const startsOn = listing.startsOn;
    const endsOn = typeof listing.endsOn === 'string' && DATE.test(listing.endsOn) && listing.endsOn >= startsOn ? listing.endsOn : startsOn;
    const url = nonEmpty(listing.url) && /^https?:\/\//i.test(listing.url.trim()) ? listing.url.trim() : undefined;
    const acts = Array.isArray(listing.acts) ? listing.acts.filter(nonEmpty).map(act => act.trim()) : [];

    return [
        {
            id: listing.id.trim(),
            name: listing.name.trim(),
            startsOn,
            endsOn,
            ...(nonEmpty(listing.venue) ? { venue: listing.venue.trim() } : {}),
            ...(nonEmpty(listing.city) ? { city: listing.city.trim() } : {}),
            ...(url === undefined ? {} : { url }),
            acts,
        },
    ];
}
