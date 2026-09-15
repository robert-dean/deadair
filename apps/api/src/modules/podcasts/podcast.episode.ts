/**
 * An episode of somebody else's programme, as the station holds it.
 *
 * The app's own shape over `deadair.podcast_episodes`, in the codebase's own conventions rather than
 * the table's: instants are epoch milliseconds, and a column the database holds as null is a field
 * that is absent here.
 */
export interface PodcastEpisodeRecord {
    /** The row's own id. */
    id: string;
    /** Qualified: `<plugin id>:<the plugin's show id>`. */
    showId: string;
    /** The plugin's own id for the episode. */
    episodeId: string;
    showTitle: string;
    title: string;
    summary?: string;
    url?: string;
    publishedAt?: number;
    /** The publisher's claim about how long it runs. */
    durationMs?: number;
    audioUrl: string;
    audioMime?: string;
    audioBytes?: number;
    artworkUrl?: string;
    explicit?: boolean;
    seenAt: number;
    /** The station's own copy of the audio, once it has one. */
    segmentId?: string;
    fetchRequestedAt?: number;
    fetchAttempts: number;
    fetchError?: string;
    scheduledFor?: number;
    airedAt?: number;
}

/**
 * What a refresh knows about an episode: everything the feed said, and nothing the station did.
 *
 * Kept apart from {@link PodcastEpisodeRecord} so a refresh cannot, even by accident, write over what
 * the station did with an episode. A re-read feed describing episode 12 again must leave its segment
 * and its aired mark exactly where they were.
 */
export interface PodcastEpisodeListing {
    showId: string;
    episodeId: string;
    showTitle: string;
    title: string;
    summary?: string;
    url?: string;
    publishedAt?: number;
    durationMs?: number;
    audioUrl: string;
    audioMime?: string;
    audioBytes?: number;
    artworkUrl?: string;
    explicit?: boolean;
}
