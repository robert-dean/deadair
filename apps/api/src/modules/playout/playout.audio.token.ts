import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The token on an audio URL the player fetches.
 *
 * Liquidsoap, the mixer and the analysis sidecar fetch a segment, a stored take or the station's
 * copy of a record with a headerless GET, so none of them can hold a session and none of them can
 * present the bridge secret in a header. For a long time the answer was to leave those routes
 * anonymous, on the argument that the mount broadcasts the same audio to anyone. It does not: the
 * mount is a mixed, ducked broadcast, and `/playout/audio/{sourceId}` is the full-length file,
 * fetched from the provider through the operator's own credentials on a miss. So the URL carries
 * what a header cannot: a signature over the PATH with an expiry, cut with the secret both sides of
 * the bridge already hold, in the query string where a headerless fetch can carry it.
 *
 * The same shape as the shim's track token (`spotify.shim.client.ts`), for the same reasons and
 * with the same length-prefixed MAC input, so one `(path, expiry)` pair cannot be re-cut into
 * another that signs the same bytes. Signed over the path rather than over an id so that a token
 * for one segment is a token for that segment's route and nothing else.
 */

/**
 * How long a signed audio URL stays valid.
 *
 * Longer than the shim's thirty minutes, because a cue's URL is armed when the record it rides is
 * pushed and fetched when the cue fires — a lead of records plus the length of the one it is over —
 * and a stitched programme's beats are joined one after another. An hour covers both with room, and
 * is still short enough that a URL in a log is not replayable for the rest of the day.
 */
export const AUDIO_URL_TTL_MS = 60 * 60_000;

/** The query parameter the token rides in. */
export const AUDIO_TOKEN_PARAM = 't';

/** Sign one path: `<expiry-unix>.<base64url(hmac-sha256)>`. */
export function signAudioPath(secret: string, path: string, expiresAtMs: number): string {
    const expiry = String(Math.floor(expiresAtMs / 1000));
    return `${expiry}.${mac(secret, path, expiry)}`;
}

/**
 * Whether `token` signs `path` with `secret` and has not expired at `nowMs`.
 *
 * One answer for a bad signature, an expired one and a malformed one: a caller without the secret
 * learns nothing from which it was. Constant-time on the MAC, because this sits on a route the
 * player polls.
 */
export function verifyAudioToken(secret: string, path: string, token: string, nowMs: number): boolean {
    if (secret.length === 0) return false;

    const dot = token.indexOf('.');
    if (dot <= 0) return false;
    const expiry = token.slice(0, dot);
    const presented = token.slice(dot + 1);
    if (!/^\d{1,12}$/.test(expiry) || presented.length === 0) return false;
    if (Number(expiry) * 1000 < nowMs) return false;

    const expected = Buffer.from(mac(secret, path, expiry));
    const given = Buffer.from(presented);
    return given.length === expected.length && timingSafeEqual(given, expected);
}

const mac = (secret: string, path: string, expiry: string): string =>
    createHmac('sha256', secret).update(`${path.length}:${path}:${expiry.length}:${expiry}`).digest('base64url');
