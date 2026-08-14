/**
 * The plugin playlist to load into the running order
 * generated from [PlayoutPlaylistInput](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L7)
 */
export interface PlayoutPlaylistInput {
    pluginId: string;
    playlistId: string;
}

/**
 * One item in the running order, as the console sees it
 * generated from [PlayoutItem](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L12)
 */
export interface PlayoutItem {
    /** deadair's own id for this item, not the provider's: a playlist may hold the same track twice */
    id: string;
    pluginId: string;
    /** The track's id in its plugin's id space */
    externalId: string;
    title: string;
    artists: string[];
    /** Integer milliseconds. Deliberately not the `duration` scalar, which is a Luxon `Duration` over an ISO-8601 string */
    durationMs?: number;
    album?: string;
    /** The locally cached cover where there is one, the provider's URL otherwise */
    artworkUrl?: string;
    /** First release year, when the catalog knows one */
    year?: number;
    /** The canonical `deadair.tracks` id, when this item is a track the catalog holds. Absent for anything the catalog has never seen */
    trackId?: string;
}

/**
 * A stream container still running config the app has replaced. Icecast and Liquidsoap read
 * their rendered config ONCE, at startup, and nothing restarts or signals them when it is
 * re-rendered — so a reseeded secret leaves a process holding credentials that match nothing,
 * and the symptom names something else entirely (every listener refused, or no mount at all).
 * The app cannot restart a sibling container and should not be able to, so it reports.
 * generated from [StreamConfigWarning](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L36)
 */
export interface StreamConfigWarning {
    /** Which one is behind */
    container: 'icecast' | 'liquidsoap';
    /** What is wrong and how it is known, in a sentence */
    detail: string;
    /** The exact command that adopts the new config, which is the only thing that does */
    restart: string;
}

/**
 * Which gate is keeping the station quiet, or `airing` when none of them is. Ordered by cause: a
 * stalled transport loop makes every reading under it stale, so it is ruled out first
 * generated from [SilenceCause](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L44)
 */
export type SilenceCause =
    | 'airing'
    | 'transportStalled'
    | 'controlDenied'
    | 'streamUnreachable'
    | 'configNotAdopted'
    | 'stoodDown'
    | 'noProgramme'
    | 'audienceUnknown'
    | 'noAudience'
    | 'notDriving'
    | 'starved';

/**
 * How one gate is doing. `waiting` is its own state rather than a mild fault, because a station
 * idling for want of a listener and a station that cannot reach its stream are both silent and only
 * one of them is something to go and fix
 * generated from [SilenceState](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L61)
 */
export type SilenceState = 'ok' | 'waiting' | 'fault';

/**
 * Which rundown item Liquidsoap has just started playing
 * generated from [PlayoutAiredQuery](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L91)
 */
export interface PlayoutAiredQuery {
    /** The id the app put on the pushed uri's `annotate:` metadata */
    item: string;
}

/**
 * Which way the running order went, and how long it had been that way
 * generated from [PlayoutStarveQuery](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L95)
 */
export interface PlayoutStarveQuery {
    /** `starved`: the queue stopped producing while deadair was driving, so the mount fell through to the local bed. `recovered`: it is producing again */
    state: 'starved' | 'recovered';
    /** How long the PREVIOUS state lasted, in milliseconds. On a recovery this is the length of the gap, which is the number worth reading */
    forMs: number;
}

/**
 * What the PLAYER says is airing, which is not the same as what was last handed to it
 * generated from [PlayoutNowPlaying](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L25)
 */
export interface PlayoutNowPlaying {
    item: PlayoutItem;
    /** Unix epoch millis, as observed when the player reported it */
    startedAt: number;
    /** The decoder's own countdown, absent when it cannot say. It leads the listener by the encoder and client buffers */
    remainingMs?: number;
}

/**
 * One gate's answer about itself
 * generated from [SilenceCheck](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L63)
 */
export interface SilenceCheck {
    /** Never `airing`, which is the absence of a blocking gate rather than a gate */
    code: SilenceCause;
    state: SilenceState;
    /** What this gate is doing right now, whether or not it is the one blocking */
    detail: string;
    /** What would clear it, where there is something an operator can actually do */
    remedy?: string;
}

/**
 * Why the station cannot be heard, as one answer
 * generated from [StationSilence](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L70)
 */
export interface StationSilence {
    /** Whether the station believes its programme is reaching the mount. NOT whether anybody is hearing it: a station can be audible with no listeners in `always` mode, and can have listeners while airing the local bed */
    audible: boolean;
    cause: SilenceCause;
    detail: string;
    remedy?: string;
    /** Every gate, in the order they are judged, so a console can say what it ruled out. A `configNotAdopted` fault appears here and is never the cause, because a station can air perfectly well while it is true */
    checks: SilenceCheck[];
}

/**
 * The station's transport, as one reading
 * generated from [PlayoutStatus](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L78)
 */
export interface PlayoutStatus {
    /** Whether Liquidsoap's control API is answering at all. False means nothing can air, whatever the running order holds */
    streamUp: boolean;
    /** Whether the station is actually broadcasting. deadair holds the mount on a lease it renews only while it has a programme, so a reachable stream with nothing to play is up and NOT on air: it is connected, and airing silence */
    onAir: boolean;
    /** Same-origin path of the Icecast mount, for a console that wants to monitor what it is driving. A path rather than a URL: the browser reaches Icecast through whatever edge served the SPA, never at the address the app itself uses */
    mountPath: string;
    nowPlaying?: PlayoutNowPlaying;
    /** Waiting here, in order. Excludes what the player already holds */
    upNext: PlayoutItem[];
    /** How many items are waiting in total, of which `upNext` is the head */
    queuedCount: number;
    /** How many clients Icecast has attached to the mount. Zero both for "nobody is listening" and for an Icecast that is not answering, which `audience` is where to tell apart */
    listeners: number;
    /** Whether the station counts as having an audience, which lingers for a minute past the last listener so a reconnecting player does not cut the broadcast */
    audience: boolean;
    /** Containers running config the app has since replaced. Empty is the ordinary state, and so is empty for anything the app has no evidence about: a warning here has never been a guess */
    staleStreamConfig: StreamConfigWarning[];
    /** Which gate is keeping the station quiet, composed from every one of them rather than inferred from the fields above. `streamUp`, `onAir`, `audience` and `queuedCount` each answer for one gate and a console reading them alone has to guess at the rest */
    silence: StationSilence;
}
