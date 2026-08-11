import { z } from 'zod';

/**
 * The plugin playlist to load into the running order
 * generated from [PlayoutPlaylistInput](file://./../../../../data/contracts/playout/playout.types.ck#L7)
 */
export const PlayoutPlaylistInput = z.strictObject({
    pluginId: z.string().min(1).max(200),
    playlistId: z.string().min(1).max(400),
});
export type PlayoutPlaylistInput = z.infer<typeof PlayoutPlaylistInput>;

/**
 * One item in the running order, as the console sees it
 * generated from [PlayoutItem](file://./../../../../data/contracts/playout/playout.types.ck#L12)
 */
export const PlayoutItem = z.strictObject({
    id: z.string().min(1).max(100).describe("deadair's own id for this item, not the provider's: a playlist may hold the same track twice"),
    pluginId: z.string().min(1).max(200),
    externalId: z.string().min(1).max(400).describe("The track's id in its plugin's id space"),
    title: z.string().min(1).max(400),
    artists: z.array(z.string().min(1).max(200)),
    durationMs: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Integer milliseconds. Deliberately not the `duration` scalar, which is a Luxon `Duration` over an ISO-8601 string'),
    album: z.string().max(400).optional(),
    artworkUrl: z.string().max(2000).optional().describe("The locally cached cover where there is one, the provider's URL otherwise"),
    year: z.coerce.number().int().min(0).optional().describe('First release year, when the catalog knows one'),
    trackId: z
        .string()
        .max(100)
        .optional()
        .describe('The canonical `deadair.tracks` id, when this item is a track the catalog holds. Absent for anything the catalog has never seen'),
});
export type PlayoutItem = z.infer<typeof PlayoutItem>;

/**
 * A stream container still running config the app has replaced. Icecast and Liquidsoap read
 * their rendered config ONCE, at startup, and nothing restarts or signals them when it is
 * re-rendered — so a reseeded secret leaves a process holding credentials that match nothing,
 * and the symptom names something else entirely (every listener refused, or no mount at all).
 * The app cannot restart a sibling container and should not be able to, so it reports.
 * generated from [StreamConfigWarning](file://./../../../../data/contracts/playout/playout.types.ck#L36)
 */
export const StreamConfigWarning = z.strictObject({
    container: z.enum(['icecast', 'liquidsoap']).describe('Which one is behind'),
    detail: z.string().min(1).max(1000).describe('What is wrong and how it is known, in a sentence'),
    restart: z.string().min(1).max(200).describe('The exact command that adopts the new config, which is the only thing that does'),
});
export type StreamConfigWarning = z.infer<typeof StreamConfigWarning>;

/**
 * Which rundown item Liquidsoap has just started playing
 * generated from [PlayoutAiredQuery](file://./../../../../data/contracts/playout/playout.types.ck#L54)
 */
export const PlayoutAiredQuery = z.strictObject({
    item: z.string().min(1).max(100).describe("The id the app put on the pushed uri's `annotate:` metadata"),
});
export type PlayoutAiredQuery = z.infer<typeof PlayoutAiredQuery>;

/**
 * Which way a listener went
 * generated from [PlayoutListenerQuery](file://./../../../../data/contracts/playout/playout.types.ck#L58)
 */
export const PlayoutListenerQuery = z.strictObject({
    event: z.enum(['add', 'remove']),
});
export type PlayoutListenerQuery = z.infer<typeof PlayoutListenerQuery>;

/**
 * Which way the running order went, and how long it had been that way
 * generated from [PlayoutStarveQuery](file://./../../../../data/contracts/playout/playout.types.ck#L62)
 */
export const PlayoutStarveQuery = z.strictObject({
    state: z
        .enum(['starved', 'recovered'])
        .describe(
            '`starved`: the queue stopped producing while deadair was driving, so the mount fell through to the local bed. `recovered`: it is producing again',
        ),
    forMs: z.coerce
        .number()
        .int()
        .min(0)
        .describe(
            'How long the PREVIOUS state lasted, in milliseconds. On a recovery this is the length of the gap, which is the number worth reading',
        ),
});
export type PlayoutStarveQuery = z.infer<typeof PlayoutStarveQuery>;

/**
 * What the PLAYER says is airing, which is not the same as what was last handed to it
 * generated from [PlayoutNowPlaying](file://./../../../../data/contracts/playout/playout.types.ck#L25)
 */
export const PlayoutNowPlaying = z.strictObject({
    item: PlayoutItem,
    startedAt: z.coerce.number().int().min(0).describe('Unix epoch millis, as observed when the player reported it'),
    remainingMs: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe("The decoder's own countdown, absent when it cannot say. It leads the listener by the encoder and client buffers"),
});
export type PlayoutNowPlaying = z.infer<typeof PlayoutNowPlaying>;

/**
 * The station's transport, as one reading
 * generated from [PlayoutStatus](file://./../../../../data/contracts/playout/playout.types.ck#L42)
 */
export const PlayoutStatus = z.strictObject({
    streamUp: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe("Whether Liquidsoap's control API is answering at all. False means nothing can air, whatever the running order holds"),
    onAir: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe(
            'Whether the station is actually broadcasting. deadair holds the mount on a lease it renews only while it has a programme, so a reachable stream with nothing to play is up and NOT on air: it is connected, and airing silence',
        ),
    mountPath: z
        .string()
        .min(1)
        .max(200)
        .describe(
            'Same-origin path of the Icecast mount, for a console that wants to monitor what it is driving. A path rather than a URL: the browser reaches Icecast through whatever edge served the SPA, never at the address the app itself uses',
        ),
    nowPlaying: PlayoutNowPlaying.optional(),
    upNext: z.array(PlayoutItem).describe('Waiting here, in order. Excludes what the player already holds'),
    queuedCount: z.coerce.number().int().min(0).describe('How many items are waiting in total, of which `upNext` is the head'),
    listeners: z.coerce
        .number()
        .int()
        .min(0)
        .describe(
            'How many clients Icecast has attached to the mount. Zero both for "nobody is listening" and for an Icecast that is not answering, which `audience` is where to tell apart',
        ),
    audience: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe(
            'Whether the station counts as having an audience, which lingers for a minute past the last listener so a reconnecting player does not cut the broadcast',
        ),
    staleStreamConfig: z
        .array(StreamConfigWarning)
        .describe(
            'Containers running config the app has since replaced. Empty is the ordinary state, and so is empty for anything the app has no evidence about: a warning here has never been a guess',
        ),
});
export type PlayoutStatus = z.infer<typeof PlayoutStatus>;
