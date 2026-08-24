import { z } from 'zod';

/**
 * What the station's track fetcher holds by way of a Spotify login
 * generated from [FetcherAuthorization](file://./../../../../data/contracts/stream/stream.types.ck#L8)
 */
export const FetcherAuthorization = z.strictObject({
    reachable: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe(
            'Whether the fetcher answered at all. False makes every field below a default rather than a reading, so a fetcher that is merely down is never reported as one that was never authorized',
        ),
    configured: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether this install has a stream half yet. False means there is nothing here to authorize'),
    authorized: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe(
            "Whether the fetcher holds its OWN stored authorization, which is the only kind Spotify's login accepts. False with a healthy plugin above it is a station that lists playlists perfectly and cannot fetch a single record",
        ),
    session: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).describe('Whether a login is established right now'),
    loginError: z
        .string()
        .max(500)
        .optional()
        .describe('The last reason a login was refused. Present is not the same as fatal: a session may have recovered since'),
    pendingUrl: z
        .string()
        .max(2000)
        .optional()
        .describe(
            'An authorization already started and not yet finished, so an operator who lost the URL is given it back rather than having to start again',
        ),
    callbackUrl: z
        .string()
        .max(2000)
        .optional()
        .describe(
            'The address the browser will be sent to and will not be able to load. Reported so the console can say which page is expected to fail, rather than leaving that looking like a fault. Absent when the fetcher did not answer, since it is the only thing that knows it',
        ),
});
export type FetcherAuthorization = z.infer<typeof FetcherAuthorization>;

/**
 * An authorization to open in a browser
 * generated from [FetcherAuthorizationStart](file://./../../../../data/contracts/stream/stream.types.ck#L19)
 */
export const FetcherAuthorizationStart = z.strictObject({
    authorizeUrl: z.string().min(1).max(2000).describe('The Spotify consent page, to be opened by the operator'),
    expiresInMs: z.coerce.number().int().min(0).describe('How long this URL is good for. Starting another replaces it'),
});
export type FetcherAuthorizationStart = z.infer<typeof FetcherAuthorizationStart>;

/**
 * The callback the browser could not deliver, handed over by the operator instead
 * generated from [FetcherAuthorizationInput](file://./../../../../data/contracts/stream/stream.types.ck#L25)
 */
export const FetcherAuthorizationInput = z.strictObject({
    redirectUrl: z
        .string()
        .min(1)
        .max(2000)
        .describe(
            'The address the browser ended up at, pasted whole. Taken apart by the fetcher rather than here, because two readings of one address is one of them being wrong eventually',
        ),
});
export type FetcherAuthorizationInput = z.infer<typeof FetcherAuthorizationInput>;

/**
 * Which account the station now fetches as
 * generated from [FetcherAuthorizationFinished](file://./../../../../data/contracts/stream/stream.types.ck#L30)
 */
export const FetcherAuthorizationFinished = z.strictObject({
    username: z
        .string()
        .min(1)
        .max(200)
        .describe(
            'The Spotify account that was authorized. Reported because an operator with two accounts in two browser profiles wants to know which one this station now is',
        ),
});
export type FetcherAuthorizationFinished = z.infer<typeof FetcherAuthorizationFinished>;
