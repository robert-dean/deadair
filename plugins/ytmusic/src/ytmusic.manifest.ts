import { type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

/**
 * The one host this plugin reaches, and it is measured rather than assumed.
 *
 * `youtubei.js` drives the MUSIC service by setting the `WEB_REMIX` client on the ordinary
 * InnerTube endpoints, so every request (search, continuations, library, playlists, `getInfo`)
 * goes to `www.youtube.com/youtubei/v1/*`. `music.youtube.com` is never contacted, and declaring it
 * would put a hostname in the operator's permission list that nothing here will ever use.
 */
export const YOUTUBE_HOST = 'www.youtube.com';

/** Bounds one upstream request. The whole call is bounded separately by the host's own deadline. */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * How long a fetched playlist stays in the in-memory page memo.
 *
 * The host reads a playlist an offset at a time (`catalog.sync.service.ts` walks
 * `getPlaylistTracks(id, { limit, offset })`), and YouTube pages by CONTINUATION TOKEN rather than
 * by offset, so serving an arbitrary offset means walking from the start. Short enough that an
 * operator who edits a playlist and re-syncs sees the change, long enough that one sync's sequential
 * offsets are one walk rather than one walk each.
 */
export const PLAYLIST_MEMO_TTL_MS = 60_000;

/**
 * The size suffix pinned onto every artwork URL.
 *
 * Thumbnails arrive at several sizes with the size written INTO the url
 * (`…=w120-h120-l90-rj`), so "the biggest one" is a different string per row and sometimes per
 * call. Rule 7 of the SDK contract: a URL handed back to be stored has to be stable, because the
 * host keeps it and the art cache is keyed by the string itself, so a varying part means the same
 * cover is downloaded forever. One fixed suffix makes one record one URL.
 */
export const ARTWORK_SIZE = 'w544-h544-l90-rj';

/**
 * Where the audio-url resolver answers, when the operator has not said otherwise.
 *
 * 9322, beside the analysis sidecar's 9321, and reached over loopback because in
 * the production image it is a sibling service in the same container.
 */
export const DEFAULT_RESOLVER_URL = 'http://localhost:9322';

/** Bounds a resolve. yt-dlp talks to the upstream several times to answer one. */
export const RESOLVE_TIMEOUT_MS = 45_000;

/** YouTube Music's own "Liked Music" list. Not in the library listing; addressed directly. */
export const LIKED_PLAYLIST_ID = 'LM';
export const LIKED_PLAYLIST_NAME = 'Liked Music';

/**
 * The badge that marks a record explicit.
 *
 * Keyed off `icon_type` and never off `label`. The label is the LOCALIZED word ("Explicit" in
 * English and something else on any other account), so matching it would leave the badge quietly
 * never firing. A station running a clean-only policy would then air an explicit record while the
 * console showed nothing wrong. The icon name is not translated.
 */
export const EXPLICIT_BADGE_ICON = 'MUSIC_EXPLICIT_BADGE';

/**
 * The cookie is NOT in here on purpose.
 *
 * A `secret` config field is encrypted at rest and never read back into the settings form, so it is
 * declared in `configFields` below and read through `host.secrets.get('cookie')`. Navidrome's
 * `password` is the same shape for the same reason.
 */
export const configSchema = z.object({
    // Optional in the SCHEMA and required in the FORM, on purpose. The host validates the stored
    // config against this schema before `onLoad` runs, so a required field here refuses every row
    // saved before the field existed -- the whole plugin marked misconfigured, catalog included,
    // over a missing AUDIO setting. That was measured on a real dev station, not reasoned about:
    // a lenient `onLoad` alone did not help, because the host said no first. The form still asks
    // for it, with the default filled in, so anything saved from here on carries it.
    resolverBaseUrl: z.string().min(1).optional(),
});

export type YtMusicConfig = z.infer<typeof configSchema>;

export const ytmusicManifest: PluginManifest = {
    id: 'deadair.ytmusic',
    name: 'YouTube Music',
    version: '0.0.1',
    // `catalog` only, deliberately. Nothing here can hand the station audio: a YouTube media URL is
    // bound to the client identity that minted it and needs matching `User-Agent`, `Origin` and
    // `Referer` headers, which is exactly what `resolveStreamUrl` promises a URL will NOT need
    // ("the player fetches it with no headers from us"). Serving it takes a header-fixing range
    // proxy beside the station. That is a later phase; see discussion #49. Declaring `stream` here
    // and answering `undefined` would be the dishonest version of the same state.
    // `stream` the long way round, and the long way is the only way. There is no
    // YouTube URL this plugin can mint: the audio is resolved by `ytaudio/`, a
    // sidecar on yt-dlp, because the library that knows how is Python and this is
    // Node in the host's own process. What comes back IS a plain URL the station
    // fetches directly, so nothing proxies bytes and the audio path is the
    // ordinary one. See discussion #49.
    capabilities: ['catalog', 'stream'],
    apiVersion: '^1.0.0',
    description:
        'Search YouTube Music and pull your playlists into the rotation. Audio goes through the bundled resolver and does not currently play: see the plugin README.',
    homepage: 'https://music.youtube.com',
    permissions: {
        // The known host first and the operator's address second, because the
        // first match wins. An unset or unparseable resolver URL contributes no
        // entry at all, which refuses the call exactly as an undeclared host
        // would rather than reaching somewhere nobody named.
        network: [YOUTUBE_HOST, { fromConfig: 'resolverBaseUrl' }],
        // No storage: the only cache is the playlist page memo, which lives in memory and dies with
        // the instance. No oauth: Google withdrew it for this service, hence the cookie below.
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'resolverBaseUrl',
            label: 'Audio resolver URL',
            type: 'url',
            required: true,
            default: DEFAULT_RESOLVER_URL,
            help:
                'The bundled ytaudio service, which turns a track into a URL the station can fetch. It answers on ' +
                'http://localhost:9322 in the station image. Without it the catalog still works and nothing plays.',
        },
        {
            key: 'cookie',
            label: 'Cookie',
            type: 'secret',
            required: true,
            help:
                'Sign in to music.youtube.com in a browser, open the developer tools Network tab, reload, ' +
                'select the first request and copy the whole Cookie request header. It expires on the ' +
                "account's own schedule and there is no refresh: when it does, this plugin reports a failed " +
                'connection and you paste a fresh one.',
        },
    ],
    configSchema,
};
