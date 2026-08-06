import { type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.musicbrainz';
export const PLUGIN_VERSION = '0.0.1';

/** The public web service. Also the default `baseUrl`, which an operator can point at a mirror. */
export const DEFAULT_BASE_URL = 'https://musicbrainz.org/ws/2';

/** Where a MusicBrainz entity is browsable by a human, for `links`. Not the web service root. */
export const MUSICBRAINZ_WEB_ORIGIN = 'https://musicbrainz.org';

/**
 * Cover art lives here, and this plugin never calls it: a release document
 * already says whether a front cover exists, so the URL is derived and handed
 * on for whoever renders it. That is why the archive is absent from
 * `permissions.network`, and it has to stay absent unless something here
 * actually starts fetching one.
 */
export const COVER_ART_ORIGIN = 'https://coverartarchive.org';

/**
 * Requests per second the public service asks anonymous clients to keep. Declared
 * on the manifest's network entries rather than implemented here: `host.fetch`
 * paces the call itself, parking it until there is headroom.
 */
export const PUBLIC_RATE_PER_SECOND = 1;

/**
 * One limiter for every hostname MusicBrainz answers on. The published limit
 * covers the service, not the host, so two entries against two buckets would
 * quietly buy twice the allowance and get the station blocked.
 */
export const MUSICBRAINZ_BUCKET = 'musicbrainz';

/**
 * Per-request budget.
 *
 * Ten seconds because the public service genuinely takes that long under load,
 * and five was cutting off answers that were on their way: three timeouts in a
 * pass trip the host's breaker, so a slow minute cost the whole walk rather
 * than one track.
 *
 * This is a ceiling, not a reservation. The host caps every fetch by whatever
 * is left of the current invocation, so a request started late gets the
 * remainder and no more — which is also why raising this does not let one
 * request eat a whole pass.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Search results below this score are not the track we asked about. MusicBrainz scores 0-100. */
export const DEFAULT_MATCH_SCORE = 90;

/** Pink Floyd, used by `testConnection` because an artist that stable will not 404. */
export const TEST_ARTIST_MBID = '83d91898-7763-47d7-b03b-b92132375c47';

export const configSchema = z.object({
    contactEmail: z.email(),
    baseUrl: z.url().default(DEFAULT_BASE_URL),
    matchScore: z.coerce.number().int().min(0).max(100).default(DEFAULT_MATCH_SCORE),
    includeArtistFacts: z.boolean().default(true),
    includeArtwork: z.boolean().default(true),
});

export type MusicBrainzConfig = z.infer<typeof configSchema>;

export const musicbrainzManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'MusicBrainz',
    version: PLUGIN_VERSION,
    kind: 'enrichment',
    capabilities: ['enrichment'],
    apiVersion: '^1.0.0',
    description: 'Canonical artist, release and recording identity from MusicBrainz, plus genres, label and artwork.',
    homepage: 'https://musicbrainz.org/doc/MusicBrainz_API',
    permissions: {
        // The two public entries share a bucket and are listed first, so a
        // `baseUrl` left pointing at the public service is matched by them and
        // keeps the strict rate. A mirror resolves to its own hostname and its
        // own bucket at the host's default rate, which is the point of running
        // one.
        network: [
            { host: 'musicbrainz.org', ratePerSecond: PUBLIC_RATE_PER_SECOND, bucket: MUSICBRAINZ_BUCKET },
            { host: '*.musicbrainz.org', ratePerSecond: PUBLIC_RATE_PER_SECOND, bucket: MUSICBRAINZ_BUCKET },
            { fromConfig: 'baseUrl' },
        ],
        // No storage. Everything this plugin learns is stored by the host,
        // against the track, artist or album it is about, so there is nothing
        // for a plugin-private key/value store to hold.
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'contactEmail',
            label: 'Contact email',
            type: 'string',
            required: true,
            placeholder: 'you@example.com',
            help: "MusicBrainz asks every client to identify itself with a contact address, and refuses ones that don't. Yours goes out in the User-Agent header and nowhere else.",
        },
        {
            key: 'baseUrl',
            label: 'Web service URL',
            type: 'url',
            default: DEFAULT_BASE_URL,
            help: 'Point this at your own musicbrainz-docker mirror to skip the one-request-per-second limit the public service asks for.',
        },
        {
            key: 'matchScore',
            label: 'Minimum match score',
            type: 'number',
            default: DEFAULT_MATCH_SCORE,
            help: 'How confident a search result has to be, out of 100, before a track is treated as identified. Lower it to fill in more tracks, raise it if the DJ starts talking about the wrong song.',
        },
        {
            key: 'includeArtistFacts',
            label: 'Look up artist background',
            type: 'boolean',
            default: true,
            help: 'Where the artist is from, when they were active, and links out. Looked up once per artist rather than once per track, so a rotation of a few hundred artists costs a few hundred requests in total.',
        },
        {
            key: 'includeArtwork',
            label: 'Include cover art',
            type: 'boolean',
            default: true,
            help: 'Cover Art Archive images for the matched release.',
        },
    ],
    configSchema,
};
