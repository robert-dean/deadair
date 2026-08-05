import { z } from 'zod';

/**
 * Which rundown item Liquidsoap has just started playing
 * generated from [PlayoutAiredQuery](file://./../../../../data/contracts/playout/playout.types.ck#L7)
 */
export const PlayoutAiredQuery = z.strictObject({
    item: z.string().min(1).max(100).describe("The id the app put on the pushed uri's `annotate:` metadata"),
});
export type PlayoutAiredQuery = z.infer<typeof PlayoutAiredQuery>;

/**
 * The shared secret gating the internal playout bridge, in both directions
 * generated from [PlayoutBridgeHeaders](file://./../../../../data/contracts/playout/playout.types.ck#L11)
 */
export const PlayoutBridgeHeaders = z.strictObject({
    'x-playout-secret': z.string().min(1).max(200).describe('The shared secret gating the internal playout bridge, in both directions'),
});
export type PlayoutBridgeHeaders = z.infer<typeof PlayoutBridgeHeaders>;

/**
 * The shared secret gating the track shim's login route
 * generated from [SpotifyLoginHeaders](file://./../../../../data/contracts/playout/playout.types.ck#L15)
 */
export const SpotifyLoginHeaders = z.strictObject({
    'x-spotify-login-secret': z.string().min(1).max(200).describe("The shared secret gating the track shim's login route"),
});
export type SpotifyLoginHeaders = z.infer<typeof SpotifyLoginHeaders>;

/**
 * A login for the track shim to open its own Spotify session with. Machine-to-machine: this never reaches a browser
 * generated from [SpotifySessionLogin](file://./../../../../data/contracts/playout/playout.types.ck#L19)
 */
export const SpotifySessionLogin = z.strictObject({
    username: z.string().min(1).max(200).describe("The connected account's Spotify id, which is what librespot logs in with"),
    accessToken: z.string().min(1).max(4000),
});
export type SpotifySessionLogin = z.infer<typeof SpotifySessionLogin>;
