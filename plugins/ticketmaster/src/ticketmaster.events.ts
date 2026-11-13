import type { Concert, FestivalListing } from '@deadair/plugin-sdk';

/** The part of a Discovery API event this plugin reads. Everything is optional because nothing about a foreign body is promised. */
interface DiscoveryEvent {
    id?: unknown;
    name?: unknown;
    url?: unknown;
    dates?: { start?: { localDate?: unknown; dateTBD?: unknown; dateTBA?: unknown }; end?: { localDate?: unknown }; status?: { code?: unknown } };
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

/**
 * The festivals in a Discovery API answer that are on and dated, soonest first.
 *
 * Read for an operator to check rather than to say, so it keeps what a concert drops for
 * being unsure of (a listing whose performers do not match a name), and drops only what
 * cannot be a festival at all: no id, no name, no date, or a status that is not on. The
 * bill is the performers in the service's order, without the festival's own name, which
 * the service lists among them. A festival sold as one listing per day stays several
 * listings; the operator picks the one to start from.
 */
export function festivalsIn(body: unknown): FestivalListing[] {
    const events = (body as { _embedded?: { events?: unknown } } | undefined)?._embedded?.events;
    if (!Array.isArray(events)) return [];

    const listings: FestivalListing[] = [];
    for (const event of events as DiscoveryEvent[]) {
        const id = text(event.id);
        const name = text(event.name);
        if (id === undefined || name === undefined) continue;

        const status = text(event.dates?.status?.code);
        if (status === undefined || !ON_SALE_CODES.has(status)) continue;

        const start = event.dates?.start;
        const startsOn = text(start?.localDate);
        if (startsOn === undefined || !DATE_SHAPE.test(startsOn) || start?.dateTBD === true || start?.dateTBA === true) continue;
        const ending = text(event.dates?.end?.localDate);
        const endsOn = ending !== undefined && DATE_SHAPE.test(ending) && ending >= startsOn ? ending : startsOn;

        const own = normalArtist(name);
        const seen = new Set<string>();
        const acts: string[] = [];
        for (const performer of event._embedded?.attractions ?? []) {
            const artist = text(performer.name);
            if (artist === undefined) continue;
            const key = normalArtist(artist);
            // The festival lists itself among its performers, sometimes under a shorter name or as a pass
            // ("Shaky Knees", "Shaky Knees 3-Day Pass"). Matched as whole words, and a one-word act only when it
            // IS the festival's name, so an act called "Live" is not lost from "Live at the Park".
            if (key.length === 0 || seen.has(key) || isTheFestival(key, own)) continue;
            seen.add(key);
            acts.push(artist);
        }

        const place = event._embedded?.venues?.[0];
        const venue = text(place?.name);
        const city = text(place?.city?.name);
        const url = webPage(text(event.url));
        listings.push({
            id,
            name,
            startsOn,
            endsOn,
            ...(venue === undefined ? {} : { venue }),
            ...(city === undefined ? {} : { city }),
            ...(url === undefined ? {} : { url }),
            acts,
        });
    }

    return listings.sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

/** Whether a performer listed on a festival is the festival itself. Whole words, and two of them at least unless it is the name exactly. */
function isTheFestival(performer: string, festival: string): boolean {
    if (performer === festival) return true;
    const words = (value: string): string => ` ${value} `;
    const several = performer.includes(' ');
    return (several && words(festival).includes(words(performer))) || words(performer).includes(words(festival));
}

/** A page link the console may show, or nothing: only http and https. */
function webPage(url: string | undefined): string | undefined {
    return url !== undefined && /^https?:\/\//i.test(url) ? url : undefined;
}
