import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { stationZone } from '#modules/director/clock.words.js';
import { ConcertService } from '#modules/concerts/concert.service.js';
import { FestivalRepository } from './festival.repository.js';
import { festivalDraftOf, festivalState, stationToday, type Festival as StoredFestival } from './festival.rules.js';
import type { Festival, FestivalInput, FestivalList, FestivalLookup } from './types/festivals.types.js';

/**
 * The console's door onto the station's festivals.
 *
 * A festival is stored material and nothing more: a show names one from the schedule, and only then does
 * it reach what the station plays and says. Every write answers the whole list, as the occasions do.
 */
@Injectable()
export class FestivalService {
    constructor(
        private readonly festivals: FestivalRepository,
        // For a lookup alone. Resolved per request, so this module sitting after concerts is a lifecycle order.
        private readonly concerts: ConcertService,
        private readonly config: AppConfig,
    ) {}

    /** `GET /festivals`. */
    async list(): Promise<FestivalList> {
        const today = stationToday(Date.now(), stationZone(this.config));
        return { festivals: (await this.festivals.list()).map(festival => toContract(festival, today)) };
    }

    /**
     * `POST /festivals`. An imported festival names where it came from, which is kept as provenance and
     * never read again: what airs is the row as the operator saved it.
     */
    async add(body: FestivalInput): Promise<FestivalList> {
        const source =
            body.sourcePluginId === undefined || body.sourceEventId === undefined
                ? undefined
                : { pluginId: body.sourcePluginId, eventId: body.sourceEventId };
        await this.festivals.add(festivalDraftOf(body, source));
        return await this.list();
    }

    /** `GET /festivals/lookup`. Writes nothing. Festivals from today on, on the station's calendar. */
    async lookup(query: { name: string }): Promise<FestivalLookup> {
        const today = stationToday(Date.now(), stationZone(this.config));
        const { listings, unanswered } = await this.concerts.findFestivals(query.name.trim(), today);
        return {
            listings: listings.map(listing => {
                const place = [listing.venue, listing.city].filter((part): part is string => part !== undefined && part.length > 0).join(', ');
                return {
                    pluginId: listing.pluginId,
                    eventId: listing.id,
                    name: listing.name,
                    startsOn: listing.startsOn,
                    endsOn: listing.endsOn,
                    ...(place === '' ? {} : { place }),
                    ...(listing.url === undefined ? {} : { url: listing.url }),
                    acts: listing.acts,
                };
            }),
            ...(unanswered.length === 0 ? {} : { unanswered }),
        };
    }

    /**
     * `PUT /festivals/{id}`. Where it was imported from is kept whatever the body says: an edit of an
     * imported bill is still that import, corrected, and a body cannot rewrite where a row came from.
     */
    async change(id: string, body: FestivalInput): Promise<FestivalList> {
        const existing = await this.festivals.find(id);
        if (existing === undefined) throw notFound(id);
        await this.festivals.change(id, festivalDraftOf(body, existing.source));
        return await this.list();
    }

    /** `DELETE /festivals/{id}`. */
    async remove(id: string): Promise<FestivalList> {
        if (!(await this.festivals.remove(id))) throw notFound(id);
        return await this.list();
    }
}

/** A stored festival as the console reads it, saying where it stands today. */
export function toContract(festival: StoredFestival, today: string): Festival {
    return {
        id: festival.id,
        name: festival.name,
        startsOn: festival.startsOn,
        endsOn: festival.endsOn,
        ...(festival.place === undefined ? {} : { place: festival.place }),
        ...(festival.url === undefined ? {} : { url: festival.url }),
        acts: festival.acts.map(act => ({
            artist: act.artist,
            ...(act.day === undefined ? {} : { day: act.day }),
            ...(act.headliner ? { headliner: true } : {}),
        })),
        state: festivalState(festival, today),
        ...(festival.source === undefined ? {} : { sourcePluginId: festival.source.pluginId }),
    };
}

const notFound = (id: string) => httpError(404).withDetails({ message: `festival "${id}" does not exist` });
