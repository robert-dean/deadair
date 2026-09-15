/**
 * A programme the station carries, as one installed plugin describes it
 * generated from [StationShow](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck#L7)
 */
export interface StationShow {
    /** Unique across the station: the plugin's own id for the show, qualified with the plugin that offered it */
    id: string;
    pluginId: string;
    /** What the show is called, which is what a presenter says out loud */
    title: string;
    author?: string;
    /** What the show says about itself, as plain text */
    description?: string;
    artworkUrl?: string;
    homeUrl?: string;
    /** Where its feed is, when the plugin reads one */
    feedUrl?: string;
    language?: string;
    categories?: string[];
    /** Whether the publisher marked the whole show explicit. Absent means the publisher did not say, which is not the same as clean */
    explicit?: boolean;
}

/**
 * One episode of a programme the station carries, and what the station has done with it
 * generated from [StationEpisode](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck#L25)
 */
export interface StationEpisode {
    /** The station's own id for this episode */
    id: string;
    /** Qualified, matching `StationShow.id` */
    showId: string;
    /** The plugin's own id for the episode, stable across refreshes */
    episodeId: string;
    showTitle: string;
    title: string;
    /** What the publisher says it is about, as plain text */
    summary?: string;
    /** The episode's page, for a person */
    url?: string;
    /** ISO-8601 */
    publishedAt?: string;
    /** How long the publisher says it runs, in milliseconds */
    durationMs?: number;
    artworkUrl?: string;
    explicit?: boolean;
    /** ISO-8601: when a refresh last saw it in its feed */
    seenAt: string;
    /** Whether the station holds its own copy of the audio, ready to air */
    fetched: boolean;
    /** ISO-8601: when the station last asked for the audio */
    fetchRequestedAt?: string;
    /** Why the last attempt to fetch the audio failed, when it did */
    fetchError?: string;
    /** ISO-8601: the slot the audio was fetched for */
    scheduledFor?: string;
    /** ISO-8601: when a listener could first have heard it. An episode airs once */
    airedAt?: string;
}

/**
 * generated from [StationEpisodeQuery](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck#L45)
 */
export interface StationEpisodeQuery {
    /** One show's episodes, or absent for every show's, newest first */
    showId?: string;
    limit?: number;
}

/**
 * generated from [StationShowList](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck#L21)
 */
export interface StationShowList {
    shows: StationShow[];
}

/**
 * generated from [StationEpisodePage](../../../../../apps/api/data/contracts/podcasts/podcasts.types.ck#L50)
 */
export interface StationEpisodePage {
    /** Newest first. Empty when the station knows of none, which is not an error */
    episodes: StationEpisode[];
}
