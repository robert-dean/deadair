/**
 * The `concerts` kind. A concert plugin answers "when is this artist next
 * playing near here", for one artist and one place, as dated listings.
 *
 * ## Why this is not `enrichment`
 *
 * Enrichment answers about a record and is true for as long as the record
 * exists, so it is stored. A concert is true until its date passes, it is called
 * off or it moves, and a station that files one with a record's facts says it
 * after the night has gone. It is asked per break and thrown away, like a
 * weather reading.
 *
 * ## The artist is matched exactly, and that is the plugin's job
 *
 * Ticket services search on keywords, so asking about `Queen` also answers with
 * tribute nights and a Queens of the Stone Age date. Everything a plugin returns
 * is said on air as a fact about the artist asked for, so a listing whose
 * performers do not include that artist by name must be dropped rather than
 * ranked lower. Missing a date costs nothing; naming a wrong one sends a listener
 * to a venue.
 *
 * ## Only what is on
 *
 * A listing that is cancelled, postponed or has no date yet is not returned. The
 * station has nowhere to put "maybe", so a plugin answers only with shows it
 * would be content to hear announced.
 *
 * Every shape here is JSON-safe.
 */

/** What a concert source is asked. */
export interface ConcertQuery {
    /** The artist, as the station credits them: `Foo Fighters`. */
    artist: string;
    /** The place, as somebody wrote it: `Atlanta, GA`. Resolved by the plugin, for `WeatherQuery.place`'s reason. */
    place: string;
    /** How far from the place still counts, in kilometres. A plugin picks its own default when absent. */
    withinKm?: number;
    /** The earliest date to answer with, as `YYYY-MM-DD` on the venue's own calendar. Absent means today. */
    from?: string;
}

/** One show, as the station may say it. */
export interface Concert {
    /** The artist asked about, exactly as {@link ConcertQuery.artist} gave it, which is the name a presenter says. */
    artist: string;
    /** The venue's name: `Tabernacle`. */
    venue: string;
    /** The town the venue is in, when the service says. Not always the place asked about: a metro is several towns. */
    city?: string;
    /** The date on the venue's own calendar, as `YYYY-MM-DD`. A calendar date, because a show is on a night rather than an instant. */
    startsOn: string;
    /** The service's page for the show. Kept as where the claim came from, and never read out. */
    url?: string;
}

/** What a festival lookup is asked: a festival by name, for an operator about to add it. */
export interface FestivalQuery {
    /** The festival's name, as somebody typed it: `Shaky Knees`. A keyword, not an exact match. */
    name: string;
    /** The earliest date to answer with, as `YYYY-MM-DD`. Absent means today. */
    from?: string;
}

/**
 * One festival as a ticket service lists it, for an operator to check and then keep.
 *
 * Unlike a {@link Concert}, this is not said on air as it stands: the station
 * shows it to an operator, who edits it and saves it as the station's own row,
 * and only that row is ever read out. So a listing may carry what a plugin is
 * unsure of, and the bill is whoever the service lists as performing, in its order.
 */
export interface FestivalListing {
    /** The service's own id for the listing, kept as where an imported festival came from. */
    id: string;
    name: string;
    /** The first day, as `YYYY-MM-DD` on the venue's own calendar. */
    startsOn: string;
    /** The last day, inclusive. The same as {@link startsOn} when the service gives no end. */
    endsOn: string;
    venue?: string;
    city?: string;
    /** The service's page for it. Never read out. */
    url?: string;
    /** Who is on the bill, as the service lists them, without the festival's own name. */
    acts: string[];
}

/** What makes a plugin a concert source. */
export interface ConcertsProvider {
    /**
     * The shows matching the query, soonest first, or an empty list.
     *
     * Empty is the ordinary answer: most artists are not coming. A service that
     * REFUSED throws instead, for `getWeather`'s reason.
     */
    getConcerts(query: ConcertQuery): Promise<Concert[]>;
    /**
     * Festivals matching a name, soonest first, or an empty list. Optional: a plugin that cannot
     * list festivals leaves it out, and the console's lookup then has nothing from it. Asked only
     * when an operator looks one up, never on air.
     */
    findFestivals?(query: FestivalQuery): Promise<FestivalListing[]>;
}
