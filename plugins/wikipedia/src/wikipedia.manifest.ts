import { type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.wikipedia';
export const PLUGIN_VERSION = '0.0.1';

/** Where identity is resolved: MusicBrainz id in, Q-id and article title out. */
export const WIKIDATA_HOST = 'www.wikidata.org';
export const WIKIDATA_API = `https://${WIKIDATA_HOST}/w/api.php`;

/** The article host is per language, so it is built rather than declared. See {@link wikipediaApi}. */
export const wikipediaApi = (language: string): string => `https://${wikipediaHost(language)}/w/api.php`;

export const wikipediaHost = (language: string): string => `${language}.wikipedia.org`;

/**
 * One bucket for both hosts, because they are one service.
 *
 * Wikimedia publishes no request-per-second number for the action API and asks
 * instead for serial requests and an honest User-Agent, so this is a
 * politeness ceiling rather than a documented limit. Two a second is well
 * inside what a browser does loading one page, and the walk that drives this is
 * already serial: the pacing that matters is the enrichment job's, not this.
 *
 * Shared across `wikidata.org` and every language's Wikipedia deliberately —
 * a published limit covers a service and not a hostname, and resolving one
 * record touches both.
 */
export const RATE_PER_SECOND = 2;

export const BUCKET = 'wikimedia';

/**
 * Per-request budget.
 *
 * Longer than a metadata lookup because the last request of a resolve pulls a
 * whole article, and shorter than MusicBrainz's ten because Wikimedia does not
 * have the slow-under-load middle ground the public MusicBrainz service does:
 * it answers, or it is not answering.
 */
export const REQUEST_TIMEOUT_MS = 8_000;

/** The default and the only one anything has been tested against. */
export const DEFAULT_LANGUAGE = 'en';

/**
 * Wikidata properties that hold a MusicBrainz id, which is how a record here
 * is found without ever matching on a title.
 *
 * The three levels are asked in the three different places the host asks about,
 * and only two of them are reliable: nearly every artist and release group with
 * an article carries its MusicBrainz id, while a RECORDING item is usually a
 * bare data item with no article at all — the prose about a song lives on the
 * song item, which carries a work id rather than a recording one. That is why
 * {@link WikipediaPlugin.enrichTrack} has a second route and the other two do
 * not.
 */
export const PROPERTY_MUSICBRAINZ_ARTIST = 'P434';
export const PROPERTY_MUSICBRAINZ_RELEASE_GROUP = 'P436';
export const PROPERTY_MUSICBRAINZ_RECORDING = 'P4404';

/** Performer, used to verify that a song item found by name is really this artist's. */
export const PROPERTY_PERFORMER = 'P175';

/** Portishead: an article this stable will not 404, so `testConnection` can rely on it. */
export const TEST_ARTIST_MBID = '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11';

export const configSchema = z.object({
    contactEmail: z.email(),
    language: z
        .string()
        .regex(/^[a-z]{2,3}(-[a-z]{2,8})*$/i, 'A Wikipedia language code, like `en` or `pt-br`.')
        .default(DEFAULT_LANGUAGE),
    includeSongArticles: z.boolean().default(true),
});

export type WikipediaConfig = z.infer<typeof configSchema>;

export const wikipediaManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Wikipedia',
    version: PLUGIN_VERSION,
    capabilities: ['enrichment'],
    apiVersion: '^1.0.0',
    description: 'Encyclopaedia articles about the songs, records and artists in the library, for the station to draw its facts from.',
    homepage: 'https://www.mediawiki.org/wiki/API:Main_page',
    permissions: {
        // Both hosts on one bucket. The language wildcard covers every edition
        // rather than only the configured one, because an operator changing the
        // language must not have to change a permission to make it work.
        network: [
            { host: WIKIDATA_HOST, ratePerSecond: RATE_PER_SECOND, bucket: BUCKET },
            { host: '*.wikipedia.org', ratePerSecond: RATE_PER_SECOND, bucket: BUCKET },
        ],
        // No storage. Every id this resolves is handed back through
        // `providerRef`, which the host stores against the thing it identifies
        // and returns on the next pass.
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
            help: 'Wikimedia asks every client to identify itself and may block ones that do not. Yours goes out in the User-Agent header and nowhere else.',
        },
        {
            key: 'language',
            label: 'Language',
            type: 'string',
            default: DEFAULT_LANGUAGE,
            help: 'Which Wikipedia to read, as a language code. Whatever the station says on air will be written from these articles, so this is the language the facts arrive in.',
        },
        {
            key: 'includeSongArticles',
            label: 'Look up articles about individual songs',
            type: 'boolean',
            default: true,
            help: 'Songs are where the good trivia is — placements in films, samples, the story behind a recording — but far fewer of them have an article than artists or records do, so this is the setting that costs the most requests per fact. Turn it off to look up only artists and records.',
        },
    ],
    configSchema,
};
