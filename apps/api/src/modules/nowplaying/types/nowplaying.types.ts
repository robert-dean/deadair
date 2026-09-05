import { z } from 'zod';

/**
 * The track a listener is hearing right now
 * generated from [NowPlayingTrack](../../../../data/contracts/nowplaying/nowplaying.types.ck#L7)
 */
export const NowPlayingTrack = z.strictObject({
    title: z.string().min(1).max(400),
    artist: z
        .string()
        .max(400)
        .describe('Comma-joined, as a display line rather than a list: this is what a player or a device shows, not something to iterate'),
    album: z.string().max(400).optional(),
    artworkUrl: z
        .string()
        .max(2000)
        .optional()
        .describe("The station's own cached cover where there is one, the provider's URL otherwise. Relative values are paths under the API root"),
    durationMs: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0)).optional(),
    startedAt: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('Unix epoch millis, as observed when the player reported the track started'),
    remainingMs: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .optional()
        .describe(
            'Absent when the decoder cannot say. It leads the listener by the encoder and client buffers, so it is a display value and not a schedule',
        ),
});
export type NowPlayingTrack = z.infer<typeof NowPlayingTrack>;

/**
 * One way to listen to this station right now
 * generated from [NowPlayingMount](../../../../data/contracts/nowplaying/nowplaying.types.ck#L17)
 */
export const NowPlayingMount = z.strictObject({
    format: z
        .enum(['mp3', 'opus', 'aac', 'flac', 'hls'])
        .describe('`hls` is the master playlist rather than an Icecast mount, which is why this enum has an arm `PlayoutMount` does not'),
    path: z
        .string()
        .min(1)
        .max(200)
        .describe(
            'Same-origin path, leading slash included. A path and not a URL: the station is reached through whatever edge served this answer, never at the address the app itself uses',
        ),
    bitrateKbps: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1))
        .optional()
        .describe("Absent for FLAC, which is lossless and has no rate to set, and for HLS, whose rate is the AAC variant's"),
});
export type NowPlayingMount = z.infer<typeof NowPlayingMount>;

/**
 * What the station is playing, for anything that wants to display it
 * generated from [NowPlaying](../../../../data/contracts/nowplaying/nowplaying.types.ck#L23)
 */
export const NowPlaying = z.strictObject({
    station: z.string().max(200).describe("The station's on-air name"),
    onAir: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('False means the station is not broadcasting. `track` is absent in that case, which is an ordinary state and not an error'),
    listeners: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe(
            "How many people are listening right now. Public because it says only what Icecast's own status document already says to anyone who asks, and a station page should not need a session to show it",
        ),
    mounts: z
        .array(NowPlayingMount)
        .describe(
            'Every way to listen, MP3 first. Never empty: MP3 has no switch. A format the operator has not switched on is ABSENT rather than present and disabled, because a client asking this wants the mounts that are actually there — and a client that had to find out by connecting to each one would put an audience-gated station on air to do it',
        ),
    track: NowPlayingTrack.optional(),
});
export type NowPlaying = z.infer<typeof NowPlaying>;
