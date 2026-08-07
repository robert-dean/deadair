import { z } from 'zod';

/**
 * The track a listener is hearing right now
 * generated from [NowPlayingTrack](file://./../../../../data/contracts/nowplaying/nowplaying.types.ck#L7)
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
    durationMs: z.coerce.number().int().min(0).optional(),
    startedAt: z.coerce.number().int().min(0).describe('Unix epoch millis, as observed when the player reported the track started'),
    remainingMs: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
            'Absent when the decoder cannot say. It leads the listener by the encoder and client buffers, so it is a display value and not a schedule',
        ),
});
export type NowPlayingTrack = z.infer<typeof NowPlayingTrack>;

/**
 * What the station is playing, for anything that wants to display it
 * generated from [NowPlaying](file://./../../../../data/contracts/nowplaying/nowplaying.types.ck#L17)
 */
export const NowPlaying = z.strictObject({
    station: z.string().max(200).describe("The station's on-air name"),
    onAir: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('False means the station is not broadcasting. `track` is absent in that case, which is an ordinary state and not an error'),
    track: NowPlayingTrack.optional(),
});
export type NowPlaying = z.infer<typeof NowPlaying>;
