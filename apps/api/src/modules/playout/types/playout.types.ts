import { z } from 'zod';

/**
 * The plugin playlist to load into the running order
 * generated from [PlayoutPlaylistInput](../../../../data/contracts/playout/playout.types.ck#L7)
 */
export const PlayoutPlaylistInput = z.strictObject({
    pluginId: z.string().min(1).max(200),
    playlistId: z.string().min(1).max(400),
});
export type PlayoutPlaylistInput = z.infer<typeof PlayoutPlaylistInput>;

/**
 * The published chart to build the running order from
 * generated from [PlayoutChartInput](../../../../data/contracts/playout/playout.types.ck#L12)
 */
export const PlayoutChartInput = z.strictObject({
    chartId: z.string().min(1).max(400).describe('As `pluginId:chartId`, which is how `GET /charts` lists them'),
    chartOrder: z
        .enum(['countdown', 'ranked', 'unordered'])
        .optional()
        .describe('Which way round to play it. Absent is `countdown`, which opens on the lowest rank and ends on number one'),
});
export type PlayoutChartInput = z.infer<typeof PlayoutChartInput>;

/**
 * One item in the running order, as the console sees it
 * generated from [PlayoutItem](../../../../data/contracts/playout/playout.types.ck#L17)
 */
export const PlayoutItem = z.strictObject({
    id: z.string().min(1).max(100).describe("deadair's own id for this item, not the provider's: a playlist may hold the same track twice"),
    pluginId: z.string().min(1).max(200),
    externalId: z.string().min(1).max(400).describe("The track's id in its plugin's id space"),
    title: z.string().min(1).max(400),
    artists: z.array(z.string().min(1).max(200)),
    durationMs: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .optional()
        .describe('Integer milliseconds. Deliberately not the `duration` scalar, which is a Luxon `Duration` over an ISO-8601 string'),
    album: z.string().max(400).optional(),
    artworkUrl: z.string().max(2000).optional().describe("The locally cached cover where there is one, the provider's URL otherwise"),
    year: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .optional()
        .describe('First release year, when the catalog knows one'),
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
 * generated from [StreamConfigWarning](../../../../data/contracts/playout/playout.types.ck#L41)
 */
export const StreamConfigWarning = z.strictObject({
    container: z.enum(['icecast', 'liquidsoap']).describe('Which one is behind'),
    detail: z.string().min(1).max(1000).describe('What is wrong and how it is known, in a sentence'),
    restart: z.string().min(1).max(200).describe('The exact command that adopts the new config, which is the only thing that does'),
});
export type StreamConfigWarning = z.infer<typeof StreamConfigWarning>;

/**
 * Which gate is keeping the station quiet, or `airing` when none of them is. Ordered by cause: a
 * stalled transport loop makes every reading under it stale, so it is ruled out first
 * generated from [SilenceCause](../../../../data/contracts/playout/playout.types.ck#L49)
 */
export const SilenceCause = z.enum([
    'airing',
    'transportStalled',
    'controlDenied',
    'streamUnreachable',
    'configNotAdopted',
    'stoodDown',
    'noProgramme',
    'noAudience',
    'warmingUp',
    'waitingOnAudio',
    'notDriving',
    'starved',
]);
export type SilenceCause = z.infer<typeof SilenceCause>;

/**
 * How one gate is doing. `waiting` is its own state rather than a mild fault, because a station
 * idling for want of a listener and a station that cannot reach its stream are both silent and only
 * one of them is something to go and fix
 * generated from [SilenceState](../../../../data/contracts/playout/playout.types.ck#L67)
 */
export const SilenceState = z.enum(['ok', 'waiting', 'fault']);
export type SilenceState = z.infer<typeof SilenceState>;

/**
 * One mount the station is publishing right now
 * generated from [PlayoutMount](../../../../data/contracts/playout/playout.types.ck#L84)
 */
export const PlayoutMount = z.strictObject({
    format: z.enum(['mp3', 'opus', 'aac', 'flac']),
    path: z.string().min(1).max(200).describe('Same-origin path, on the same terms as `PlayoutStatus.mountPath`'),
    bitrateKbps: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1))
        .optional()
        .describe('Absent for FLAC, which is lossless and has no rate to set'),
});
export type PlayoutMount = z.infer<typeof PlayoutMount>;

/**
 * Which rundown item Liquidsoap has just started playing
 * generated from [PlayoutAiredQuery](../../../../data/contracts/playout/playout.types.ck#L104)
 */
export const PlayoutAiredQuery = z.strictObject({
    item: z.string().min(1).max(100).describe("The id the app put on the pushed uri's `annotate:` metadata"),
});
export type PlayoutAiredQuery = z.infer<typeof PlayoutAiredQuery>;

/**
 * Which way the running order went, and how long it had been that way
 * generated from [PlayoutStarveQuery](../../../../data/contracts/playout/playout.types.ck#L108)
 */
export const PlayoutStarveQuery = z.strictObject({
    state: z
        .enum(['starved', 'recovered'])
        .describe(
            '`starved`: the queue stopped producing while deadair was driving, so the mount fell through to the local bed. `recovered`: it is producing again',
        ),
    forMs: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe(
            'How long the PREVIOUS state lasted, in milliseconds. On a recovery this is the length of the gap, which is the number worth reading',
        ),
});
export type PlayoutStarveQuery = z.infer<typeof PlayoutStarveQuery>;

/**
 * What the PLAYER says is airing, which is not the same as what was last handed to it
 * generated from [PlayoutNowPlaying](../../../../data/contracts/playout/playout.types.ck#L30)
 */
export const PlayoutNowPlaying = z.strictObject({
    item: PlayoutItem,
    startedAt: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('Unix epoch millis, as observed when the player reported it'),
    remainingMs: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .optional()
        .describe("The decoder's own countdown, absent when it cannot say. It leads the listener by the encoder and client buffers"),
});
export type PlayoutNowPlaying = z.infer<typeof PlayoutNowPlaying>;

/**
 * One gate's answer about itself
 * generated from [SilenceCheck](../../../../data/contracts/playout/playout.types.ck#L69)
 */
export const SilenceCheck = z.strictObject({
    code: SilenceCause.describe('Never `airing`, which is the absence of a blocking gate rather than a gate'),
    state: SilenceState,
    detail: z.string().min(1).max(1000).describe('What this gate is doing right now, whether or not it is the one blocking'),
    remedy: z.string().max(500).optional().describe('What would clear it, where there is something an operator can actually do'),
});
export type SilenceCheck = z.infer<typeof SilenceCheck>;

/**
 * Why the station cannot be heard, as one answer
 * generated from [StationSilence](../../../../data/contracts/playout/playout.types.ck#L76)
 */
export const StationSilence = z.strictObject({
    audible: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe(
            'Whether the station believes its programme is reaching the mount. NOT whether anybody is hearing it: a station can be audible with no listeners in `always` mode, and can have listeners while airing the local bed',
        ),
    cause: SilenceCause,
    detail: z.string().min(1).max(1000),
    remedy: z.string().max(500).optional(),
    checks: z
        .array(SilenceCheck)
        .describe(
            'Every gate, in the order they are judged, so a console can say what it ruled out. A `configNotAdopted` fault appears here and is never the cause, because a station can air perfectly well while it is true',
        ),
});
export type StationSilence = z.infer<typeof StationSilence>;

/**
 * The station's transport, as one reading
 * generated from [PlayoutStatus](../../../../data/contracts/playout/playout.types.ck#L90)
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
            'Same-origin path of the Icecast MP3 mount, which is always published and is the one a console names when it can only name one. A path rather than a URL: the browser reaches Icecast through whatever edge served the SPA, never at the address the app itself uses',
        ),
    mounts: z
        .array(PlayoutMount)
        .describe(
            'Every mount being published, MP3 first, so a console can offer the others rather than implying the station is only on one. Never empty: MP3 has no switch. A format the operator has not switched on is absent rather than present and disabled, because every consumer of this wants the mounts that are actually there',
        ),
    nowPlaying: PlayoutNowPlaying.optional(),
    upNext: z.array(PlayoutItem).describe('Waiting here, in order. Excludes what the player already holds'),
    queuedCount: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('How many items are waiting in total, of which `upNext` is the head'),
    listeners: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
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
    silence: StationSilence.describe(
        'Which gate is keeping the station quiet, composed from every one of them rather than inferred from the fields above. `streamUp`, `onAir`, `audience` and `queuedCount` each answer for one gate and a console reading them alone has to guess at the rest',
    ),
});
export type PlayoutStatus = z.infer<typeof PlayoutStatus>;
