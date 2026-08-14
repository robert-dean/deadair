/**
 * The `scrobble` kind. A scrobble plugin reports what the station played to
 * somebody else's service.
 *
 * ## The only capability that SENDS
 *
 * Everything else a plugin does is a read: enrichment asks an upstream what it
 * knows, a chart asks what is popular, a provider asks for audio. This publishes
 * the station's own listening to an account the operator holds, which makes it
 * the one place where getting it wrong writes to somebody else's records rather
 * than producing a worse hour.
 *
 * Three things follow from that and are worth knowing before implementing one.
 *
 * **Late is fine and lost is not.** The host queues every play durably and
 * retries with a backoff, so a plugin never has to hold anything: answer for the
 * batch you were given and say what happened to it.
 *
 * **{@link ScrobbleRejection.retryable} is the field that matters.** "The service
 * was down" and "that timestamp is too old to accept" are opposite facts, and a
 * queue that cannot tell them apart either loses plays or retries a permanent
 * rejection forever. The plugin classifies, because only the plugin knows what
 * its upstream meant; the host obeys.
 *
 * **{@link ScrobbleProvider.accepting} is how an operator says no.** A service
 * that also does something else — Last.fm is enrichment, charts, similarity and
 * this — is one installed plugin, and wanting its tags without sending it your
 * listening is an ordinary position. Since `plugin_configs.plugin_id` is a
 * primary key, it cannot be expressed by installing twice, and since capabilities
 * are fixed when the plugin is written it cannot be expressed by the manifest
 * either. So it is a config field, read back through one optional method.
 *
 * Every shape here is JSON-safe.
 */

/** One record the station played. */
export interface ScrobblePlay {
    title: string;
    /**
     * The LEAD artist, as the catalog credits it.
     *
     * Not a joined credit line, for the reason every other capability here gives:
     * a scrobbling service matches on artist and title, and "A, B & C" matches
     * nothing. {@link albumArtist} is where a compilation's own credit goes.
     */
    artist: string;
    album?: string;
    /** The record's own credit, where it differs from the track's. */
    albumArtist?: string;
    /** Integer milliseconds. Some services use it to decide whether a play counts. */
    durationMs?: number;
    trackNumber?: number;
    /** MusicBrainz recording id, when the catalog has resolved one. */
    mbid?: string;
    /**
     * When it started, as Unix epoch MILLISECONDS. Never a `Date`.
     *
     * Milliseconds because that is what the rest of this SDK uses; a service
     * wanting seconds divides. It is the moment the record went to air rather
     * than the moment this call was made, and the difference is the whole reason
     * the host queues: a play sent an hour late is still a play at the time it
     * happened.
     */
    playedAt: number;
}

/** Why one play in a batch was refused. */
export interface ScrobbleRejection {
    /** Which play, as its index in the batch that was submitted. */
    index: number;
    /** What the upstream said, summarized by the plugin. Never the raw body. */
    reason: string;
    /**
     * Whether sending it again could work.
     *
     * `true` for a timeout, a 5xx, a rate limit. `false` for a timestamp the
     * service will not accept, a malformed record, a revoked authorization. When
     * in doubt, say `false`: a play retried forever is a queue that never drains,
     * and one dropped is one listen missing from a history nobody audits.
     */
    retryable: boolean;
}

/** What became of one batch. */
export interface ScrobbleResult {
    /** How many the service took. */
    accepted: number;
    /** The ones it did not, each said to be worth retrying or not. */
    rejected: ScrobbleRejection[];
}

/**
 * Implemented by a `scrobble` plugin.
 */
export interface ScrobbleProvider {
    /**
     * How many plays this plugin will take in one {@link scrobble} call.
     *
     * The host chunks to it. Absent means the host picks a modest default, which
     * is the right answer for a service with no published batch limit.
     */
    maxBatchSize?: number;

    /**
     * Report plays that have already happened.
     *
     * The batch is ordered oldest first. Answer for every entry: anything neither
     * counted in `accepted` nor listed in `rejected` is treated as accepted, since
     * a plugin that quietly dropped one is a worse outcome than a duplicate.
     *
     * THROW only when the whole batch failed for one reason — no credentials, the
     * service unreachable — which the host treats as retryable for all of them.
     * A per-play problem belongs in `rejected`, where it can be classified.
     */
    scrobble(plays: ScrobblePlay[]): Promise<ScrobbleResult>;

    /**
     * Say what is playing right now.
     *
     * Optional, and deliberately not part of the durable path: it is worthless
     * late, so the host sends it once, at the moment the record goes to air, and
     * never retries or queues it. A plugin should treat a failure here as
     * unimportant.
     */
    nowPlaying?(play: ScrobblePlay): Promise<void>;

    /**
     * Whether this destination currently wants the station's plays.
     *
     * Optional, and ABSENT MEANS YES — a plugin that exists only to scrobble
     * never has to write it. Implement it when the same plugin does other things
     * and an operator might want those without this.
     *
     * Asked before anything is queued, so answering `false` means nothing
     * accumulates rather than a queue that drains into a discard. Keep it cheap:
     * it is a config read, not a call to the service.
     */
    accepting?(): Promise<boolean>;
}
