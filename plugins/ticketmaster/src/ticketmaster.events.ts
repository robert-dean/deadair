import type { Concert } from '@deadair/plugin-sdk';

/** The part of a Discovery API event this plugin reads. Everything is optional because nothing about a foreign body is promised. */
interface DiscoveryEvent {
    url?: unknown;
    dates?: { start?: { localDate?: unknown; dateTBD?: unknown; dateTBA?: unknown }; status?: { code?: unknown } };
    _embedded?: { attractions?: { name?: unknown }[]; venues?: { name?: unknown; city?: { name?: unknown } }[] };
}

/**
 * Ticketmaster's status codes for a show that is on.
 *
 * A closed list rather than a list of the bad ones, so a status added later
 * stays off the air until somebody has read what it means.
 */
const ON_SALE_CODES: ReadonlySet<string> = new Set(['onsale', 'offsale']);

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A name reduced to what two spellings of it share: `AC/DC` and `ACDC`,
 * `The Struts` and `Struts`, `Guns N' Roses` and `Guns N Roses`.
 *
 * Only a leading `the` goes. Anything cleverer starts matching different bands.
 */
export function normalArtist(name: string): string {
    return name
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^the /, '');
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

/**
 * The shows in a Discovery API answer that are by `artist` and are on, soonest first.
 *
 * A performer has to match by name: the service's keyword search is what brings
 * back tribute acts. A listing with no date is dropped, and so is a second
 * listing of one night at one venue, which is usually a VIP package.
 */
export function concertsIn(body: unknown, artist: string): Concert[] {
    const events = (body as { _embedded?: { events?: unknown } } | undefined)?._embedded?.events;
    if (!Array.isArray(events)) return [];

    const wanted = normalArtist(artist);
    const seen = new Set<string>();
    const concerts: Concert[] = [];

    for (const event of events as DiscoveryEvent[]) {
        const performers = event._embedded?.attractions ?? [];
        if (!performers.some(performer => normalArtist(text(performer.name) ?? '') === wanted)) continue;

        const status = text(event.dates?.status?.code);
        if (status === undefined || !ON_SALE_CODES.has(status)) continue;

        const start = event.dates?.start;
        const startsOn = text(start?.localDate);
        if (startsOn === undefined || !DATE_SHAPE.test(startsOn) || start?.dateTBD === true || start?.dateTBA === true) continue;

        const place = event._embedded?.venues?.[0];
        const venue = text(place?.name);
        if (venue === undefined) continue;

        const key = `${startsOn}|${venue.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const city = text(place?.city?.name);
        const url = text(event.url);
        concerts.push({ artist, venue, startsOn, ...(city === undefined ? {} : { city }), ...(url === undefined ? {} : { url }) });
    }

    return concerts.sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}
