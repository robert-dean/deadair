/**
 * The `podcast` kind. A podcast plugin answers "what programmes has this
 * station subscribed to, and what has each of them published", as episodes
 * somebody else made.
 *
 * ## It reports, and the host fetches
 *
 * Nothing here plays anything, schedules anything, or fetches the audio. A
 * plugin hands over what its feeds published, with each episode's audio as an
 * ADDRESS, and the station decides whether and when to carry it. The host then
 * fetches that address itself, once, hours ahead of the slot, into the same
 * store the station's own recordings live in. Two reasons it is the host and not
 * the plugin:
 *
 * - **Size.** An episode is tens of megabytes, often more than a hundred. Every
 *   body a plugin reads through `host.fetch` is bounded well below that, on
 *   purpose, and raising the bound for one capability would raise it for every
 *   plugin reading through the same guard.
 * - **Timing.** The audio is wanted when a clock band asks for it, which is a
 *   station decision a plugin cannot see. A plugin that fetched on its own
 *   schedule would either fetch everything or guess.
 *
 * The same boundary `capabilities/news.ts` keeps, one step further: a news
 * plugin reports and the station decides what to SAY; a podcast plugin reports
 * and the station decides what to AIR. A source able to put itself on air is a
 * source that can talk over an operator's decisions.
 *
 * ## An episode is not a record
 *
 * Deliberately not a `catalog` provider with shows for playlists and episodes
 * for tracks, which is the shape that needs nothing new and is wrong everywhere
 * it touches. The station treats a record as a song: it draws it into rotation,
 * spaces it by artist, asks the enrichment sources about it, measures it,
 * crossfades into it, scrobbles it at half its length, and refuses its file past
 * the size of an album. An hour-long programme survives none of that. What it
 * needs is what the station already does for a programme it made itself — one
 * item that airs whole, as speech, at the time a clock band says — and the
 * shapes below are what that needs and no more.
 *
 * ## `id`s are a de-duplication contract
 *
 * **A {@link PodcastEpisode.id} is stable for the same episode across calls**,
 * on exactly `news.ts`'s terms, because the host remembers which episodes it has
 * fetched and which it has aired by that id. A plugin that renumbered would have
 * the station fetch and air the same episode twice. Building episodes with
 * `parseFeed` gives this for free; it is where the ladder lives. A
 * {@link PodcastShow.id} is stable in the same way, for as long as the operator
 * keeps the subscription.
 *
 * Every shape here is JSON-safe.
 */

/**
 * One programme this plugin carries: something the operator subscribed to.
 *
 * `id` is scoped to this plugin and needs to be unique only within it. The host
 * qualifies it before anything outside sees it, so a short flat id is right.
 */
export interface PodcastShow {
    id: string;
    /** What the show calls itself, e.g. `The Long Wave`. What a presenter says out loud. */
    title: string;
    /** Who makes it, as the publisher writes it. */
    author?: string;
    /** What the show says about itself, as PLAIN TEXT. It may reach a model's context. */
    description?: string;
    /** The show's artwork. Always http(s), and stable across calls (README rule 7). */
    artworkUrl?: string;
    /** Where the show lives for a person, as opposed to its feed. */
    homeUrl?: string;
    /**
     * Where the show's feed is, when the plugin reads one.
     *
     * Reported so the console can say which subscription a show came from and
     * tell a directory result apart from a show the station already carries.
     * Nothing fetches it but the plugin.
     */
    feedUrl?: string;
    /** ISO 639-1, or the feed's own tag (`en-gb`), when the plugin knows. */
    language?: string;
    /** The publisher's own labels, unmapped. */
    categories?: string[];
    /**
     * Whether the publisher marked the whole show explicit. Absent means the
     * feed did not say, which is not the same as clean; see
     * {@link PodcastEpisode.explicit}.
     */
    explicit?: boolean;
}

/**
 * Where an episode's audio is, and what the publisher says about it.
 *
 * Only `url` is load-bearing. The rest are the publisher's claims, passed on as
 * claims: the host reads the bytes it actually receives and decides from those
 * what it holds. `mimeType` in particular is whatever the publisher's CMS wrote,
 * and `audio/x-m4a`, `audio/mp3` and an empty string are all ordinary.
 */
export interface PodcastAudio {
    /**
     * An http(s) address the HOST will fetch, with no headers from the plugin.
     *
     * The same rule `ProviderStream.url` is under and for the same reason:
     * whatever authentication it needs has to be in the address, because it is
     * fetched by somebody other than the plugin that found it. A feed that
     * needs a login for its audio is one this capability cannot carry.
     */
    url: string;
    mimeType?: string;
    /** The declared size in bytes. A claim, and a hint about cost rather than a limit. */
    lengthBytes?: number;
}

/** One programme a show published. */
export interface PodcastEpisode {
    /** Stable across calls. See the de-duplication contract in this file's header. */
    id: string;
    /** The {@link PodcastShow.id} this belongs to, as the plugin's own unqualified id. */
    showId: string;
    /** That show's title, so a caller reading one list can say what it is part of. */
    showTitle: string;
    title: string;
    /**
     * What the publisher says the episode is about, as PLAIN TEXT.
     *
     * The line a presenter reaches for when introducing it, which is why it has
     * to be plain: it ends up in a model's context and possibly a voice.
     */
    summary?: string;
    /** The episode's page, for a person. Never the audio; that is {@link audio}. */
    url?: string;
    /** ISO-8601. Never a `Date`, and absent when the feed published no readable one. */
    publishedAt?: string;
    /**
     * How long it runs, in whole milliseconds, as the publisher says.
     *
     * A claim, and the only length the station has before the bytes arrive, so
     * it is what an episode is planned against. Absent when the feed made none:
     * a plugin must not estimate one from a file size.
     */
    durationMs?: number;
    audio: PodcastAudio;
    /** The episode's own artwork where it has some, else the show's. Always http(s). */
    artworkUrl?: string;
    /** The publisher's season number, a positive whole number. */
    season?: number;
    /** The publisher's episode number within its season, a positive whole number. */
    number?: number;
    /**
     * Whether the publisher marked this episode explicit.
     *
     * Absent means the feed did not say, which is not the same as clean. A host
     * enforcing a clean-only policy has to demand a positive `false`, on
     * `ProviderTrack.advisory`'s argument: treating silence as consent is how a
     * station promises something it cannot deliver.
     */
    explicit?: boolean;
}

/** What a podcast source is asked for when the host wants a show's episodes. */
export interface PodcastEpisodesQuery {
    /**
     * A {@link PodcastShow.id} this plugin offered.
     *
     * Required, unlike `NewsQuery.feedId`, because an episode is always of a
     * show and the host keeps them per show. "Everything, merged" is a question
     * nobody here asks.
     */
    showId: string;
    /** How many episodes to return, newest first. A plugin may return fewer; it must not return more. */
    limit: number;
    /**
     * Only episodes published after this instant, as an ISO-8601 string.
     *
     * A plugin that cannot filter upstream filters what it got rather than
     * ignoring this, `NewsQuery.since`'s rule. An undated episode is kept: it is
     * unjudgeable rather than old.
     */
    since?: string;
}

/** What a directory is asked when an operator looks for a show to subscribe to. */
export interface PodcastDirectoryQuery {
    /** Words the operator typed: a show's name, a publisher, a subject. */
    query: string;
    /** How many results to return. A plugin may return fewer; it must not return more. */
    limit: number;
}

/**
 * A show a directory knows about, which the station may or may not carry.
 *
 * Its own shape rather than a {@link PodcastShow}, because the two answer
 * different questions: a show is something this plugin will list episodes of,
 * and this is somewhere an operator could point it. `id` is the DIRECTORY'S
 * identifier, meaningful to nothing here but as a key in a list, and `feedUrl`
 * is what subscribing actually needs.
 */
export interface PodcastDirectoryEntry {
    id: string;
    title: string;
    /** Where the show's feed is. Required: a directory result nobody can subscribe to is no result. */
    feedUrl: string;
    author?: string;
    /** PLAIN TEXT. */
    description?: string;
    /** Always http(s). */
    artworkUrl?: string;
    homeUrl?: string;
    categories?: string[];
    explicit?: boolean;
}

/**
 * Implemented by a `podcast` plugin.
 */
export interface PodcastProvider {
    /**
     * What this plugin carries, right now.
     *
     * Asked per call rather than cached by the host, for the reason
     * `NewsProvider.listFeeds` is: an operator editing a subscription
     * reinitializes the plugin, and a list built from a config field would
     * otherwise be a boot snapshot of a setting that has since changed.
     *
     * An empty array is an ordinary answer. A plugin nobody has subscribed to
     * anything yet has nothing to offer, and that is not a failure.
     */
    listShows(): Promise<PodcastShow[]>;

    /**
     * A show's episodes, newest first, each with an address its audio can be
     * fetched from.
     *
     * Leave out an entry that attaches no audio, or attaches it somewhere
     * nothing can fetch: an episode without {@link PodcastEpisode.audio} is not
     * one the station can carry, and handing it over only makes the host drop
     * it. Return `[]` for a `showId` you do not recognise rather than throwing
     * — the host asks the plugin that named the id, so an unknown one is a
     * stale request — and the same for a show whose feed could not be read:
     * one failing show must not cost the others.
     */
    listEpisodes(query: PodcastEpisodesQuery): Promise<PodcastEpisode[]>;

    /**
     * Shows a directory knows about, for an operator looking for something to
     * subscribe to.
     *
     * Optional: a plugin that reads only the feeds it was given is a complete
     * podcast plugin. Subscribing is not part of this capability, because what
     * a subscription IS (a row in a config field, an account on a service) is
     * each plugin's own business. An empty array is an answer, including for a
     * directory that is down.
     */
    searchShows?(query: PodcastDirectoryQuery): Promise<PodcastDirectoryEntry[]>;
}
