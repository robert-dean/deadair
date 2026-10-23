import { z } from 'zod';

/** What the plugins call themselves in the `Authorization` header, and so in the server's device list. */
export const CLIENT_NAME = 'deadair';

/**
 * The device id every request claims.
 *
 * Fixed rather than random: the server keys its device list on this, and an id minted per load would
 * add a row to the operator's dashboard every time a setting was saved.
 */
export const DEVICE_ID = 'deadair-station';

/**
 * Requests per second. Generous, because this is the operator's own server on their own network: the
 * number is here to stop a runaway loop from hammering it, not to ration a budget somebody else set.
 */
export const RATE_PER_SECOND = 10;

/** How long one call may take. A library on a LAN, not a service across the internet. */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The most items one call asks for.
 *
 * The server sets no ceiling of its own, so this is a guard against a caller asking for the whole
 * library at once rather than a number anything normally reaches: the host asks in pages of fifty.
 */
export const MAX_PAGE_SIZE = 500;

/** What the virtual whole-library playlist calls itself in the console. */
export const EVERYTHING_PLAYLIST_NAME = 'Everything';

/**
 * How many artists a search reads when it looks for one at the front of the query.
 *
 * The probe is a substring match on one word, so a common first word ("DJ", "Lil") brings back a
 * crowd. Deep enough to find the one the query names in it, shallow enough to stay one small response.
 */
export const ARTIST_PROBE_LIMIT = 100;

/** The most artist-scoped searches one query spends, longest artist name first. */
export const ARTIST_SEARCHES = 2;

/**
 * Formats the operator can ask Liquidsoap to be handed.
 *
 * `raw` is the default and means the server sends the file as it is stored, which is what a station
 * wants: no re-encode, no generation loss, no CPU spent on the library machine. The other two exist for
 * a library holding something the decoder on the other end cannot read.
 */
export const STREAM_FORMATS = ['raw', 'mp3', 'opus'] as const;

export const configSchema = z.object({
    baseUrl: z.url(),
    username: z.string().min(1),
    streamFormat: z.enum(STREAM_FORMATS).default('raw'),
    // Blank means no limit, which is also what the server does with an absent `audioBitRate`, so blank
    // is the only way it is said.
    maxBitRate: z.number().int().positive().optional(),
});

export type MediaBrowserConfig = z.infer<typeof configSchema>;
