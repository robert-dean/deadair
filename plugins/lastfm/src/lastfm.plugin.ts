import {
    configString,
    Plugin,
    type AlbumEnrichment,
    type AlbumRef,
    type ArtistEnrichment,
    type ArtistRef,
    type ArtistTrack,
    type ChartDescriptor,
    type ChartEntry,
    type ChartQuery,
    type ChartsProvider,
    type EnrichmentMatchKey,
    type EnrichmentProvider,
    type MusicProviderOAuth,
    type PluginConnectionResult,
    type ScrobblePlay,
    type ScrobbleProvider,
    type ScrobbleRejection,
    type ScrobbleResult,
    type SimilarArtist,
    type SimilarityProvider,
    type TrackEnrichment,
    type TrackRef,
} from '@deadair/plugin-sdk';

import { LastfmClient, LastfmRequestError, LASTFM_ERROR } from './lastfm.client.js';
import { mapAlbum, mapArtist, mapTrack, readRef } from './lastfm.mapping.js';
import { AUTH_ORIGIN, DEFAULT_MIN_TAG_WEIGHT, SCROBBLE_BATCH_SIZE, TEST_ARTIST } from './lastfm.manifest.js';
import {
    artistNameOf,
    asList,
    asNumber,
    type LastfmAlbumInfoResponse,
    type LastfmArtistInfoResponse,
    type LastfmScrobbleResponse,
    type LastfmSessionResponse,
    type LastfmSimilarArtistsResponse,
    type LastfmTokenResponse,
    type LastfmTopTracksResponse,
    type LastfmTrackInfoResponse,
} from './lastfm.types.js';

export { lastfmManifest } from './lastfm.manifest.js';

/**
 * Last.fm, as four of the station's capabilities at once.
 *
 * One service, four questions the station asks, and one API key. Splitting it
 * into four plugins would mean four keys, four copies of the signing code, and
 * an operator connecting their account four times.
 *
 * ## What it is good for, in order
 *
 * **Tags** are the reason to install it. They are the only free source of what a
 * record actually sounds like, and they are what finally populates `moods` —
 * a field the SDK has always had and nothing has ever filled. See
 * `lastfm.tags.ts` for how a folksonomy is turned into two vocabularies.
 *
 * **Similarity** is the thing MusicBrainz cannot do at all: that service has no
 * artist-similarity endpoint, so this is the only way the station reaches past
 * the acts it already owns.
 *
 * **Charts** are a brief the library cannot fill, and **scrobbling** is the
 * station keeping the operator's own listening history.
 *
 * ## Enrichment priority 500, and the declines are deliberate
 *
 * Supplementary, per the SDK's scale. It says nothing about a release year, a
 * label or an ISRC, because those are identity and MusicBrainz owns them at 100.
 * See `lastfm.mapping.ts` — the fields it refuses to fill are as much of the
 * design as the ones it does.
 *
 * ## Every capability degrades on its own
 *
 * No API key means no client at all, and every method answers empty rather than
 * throwing: an unconfigured plugin is an ordinary state. No API SECRET means
 * everything works except scrobbling, which is exactly the shape an operator who
 * wants the tags and not the publishing is in — and `accepting()` is the switch
 * that says so out loud.
 */

/** Where this sorts against other enrichment sources. Supplementary, per the SDK's own scale. */
const PRIORITY = 500;

/** Similar artists asked for when the caller does not say. */
const DEFAULT_SIMILAR_LIMIT = 20;

/**
 * The chart countries always on offer, beside the global one.
 *
 * A short fixed list rather than every country the service knows, because
 * `listCharts` is a menu a person reads. An operator whose country is missing
 * adds it with `chartCountry`, which is why that field exists.
 *
 * The names are what `geo.getTopTracks` takes: it wants a country NAME, spelled
 * as ISO 3166-1 spells it, and answers an empty chart for a two-letter code
 * rather than an error — which is the kind of failure that reads as "the plugin
 * is broken" for an hour before anyone checks.
 */
const COUNTRIES: readonly { code: string; name: string }[] = [
    { code: 'GB', name: 'United Kingdom' },
    { code: 'US', name: 'United States' },
    { code: 'DE', name: 'Germany' },
    { code: 'FR', name: 'France' },
    { code: 'BR', name: 'Brazil' },
    { code: 'JP', name: 'Japan' },
];

/** The global chart's id within this plugin. */
const GLOBAL_CHART = 'global';

/** Prefixes for the two parameterised chart families. */
const GEO_PREFIX = 'geo:';
const TAG_PREFIX = 'tag:';

/** Where the OAuth vault keeps the two things a scrobble needs. */
const SESSION_KEY = 'sessionKey';
const SESSION_USER = 'username';

/**
 * Ignore codes from `track.scrobble` that will never change.
 *
 * 1 and 2 are an artist or a track the service will not accept under any
 * circumstances; 3 is a timestamp older than it allows, which only gets older.
 * Retrying any of them is a row that never leaves the queue.
 *
 * 4 (timestamp too new) and 5 (daily limit) are deliberately absent: a clock
 * skew resolves and a daily limit resets, so both are worth another attempt.
 */
const PERMANENT_IGNORE_CODES = new Set([1, 2, 3]);

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class LastfmPlugin extends Plugin implements EnrichmentProvider, ChartsProvider, SimilarityProvider, ScrobbleProvider, MusicProviderOAuth {
    readonly priority = PRIORITY;

    /**
     * Artist and title only.
     *
     * No `isrc`: Last.fm has never indexed them, and claiming the key would have
     * the host prefer this plugin for exactly the lookups it cannot do.
     */
    readonly matchKeys: EnrichmentMatchKey[] = ['artist-title'];

    /** The service's own documented ceiling for one `track.scrobble` request. */
    readonly maxBatchSize = SCROBBLE_BATCH_SIZE;

    private client?: LastfmClient;
    private scrobbling = false;
    private includeTags = true;
    private minTagWeight = DEFAULT_MIN_TAG_WEIGHT;
    private chartCountry = '';

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();
        this.scrobbling = config.scrobbling === true;
        this.includeTags = config.includeTags !== false;
        this.chartCountry = configString(config.chartCountry) ?? '';

        const weight = Number(config.minTagWeight);
        this.minTagWeight = Number.isFinite(weight) ? weight : DEFAULT_MIN_TAG_WEIGHT;

        const apiKey = (await this.host.secrets.get('apiKey'))?.trim() ?? '';
        const apiSecret = (await this.host.secrets.get('apiSecret'))?.trim() ?? '';

        // No key means no client at all rather than a client refused on every
        // call: one clear config state beats an error per track.
        this.client = apiKey.length > 0 ? new LastfmClient(this.host, apiKey, apiSecret.length > 0 ? apiSecret : undefined) : undefined;

        this.host.logger.info('lastfm ready', {
            configured: this.client !== undefined,
            canScrobble: this.client?.canSign === true && this.scrobbling,
            tags: this.includeTags,
        });
    }

    protected async onUnload(): Promise<void> {
        this.client = undefined;
    }

    async testConnection(): Promise<PluginConnectionResult> {
        if (!this.client) return { ok: false, message: 'Add your Last.fm API key.' };

        try {
            const response = await this.client.get<LastfmArtistInfoResponse>('artist.getInfo', { artist: TEST_ARTIST });
            if (!response.artist?.name) {
                return { ok: false, message: 'Last.fm answered, but not with an artist. Check the API key.' };
            }

            // Every capability, not just the connection. "Connected" is not what an
            // operator is really asking: they want to know which of the four things
            // this plugin declares is actually doing anything, and a capability that
            // is installed and inert is otherwise invisible — the console lists it as
            // live either way.
            return { ok: true, message: `Connected. ${this.summarise(await this.scrobbleState())}` };
        } catch (error) {
            if (error instanceof LastfmRequestError && error.apiError === LASTFM_ERROR.invalidApiKey) {
                return { ok: false, message: 'Last.fm rejected that API key.' };
            }
            return { ok: false, message: errorText(error) };
        }
    }

    /**
     * Which of the four capabilities this installation will actually contribute.
     *
     * The gap it closes: the console lists `enrichment, charts, similarity, scrobble` for an active
     * plugin whether or not any of them is switched on, so an operator who installs this for its
     * tags has no way to learn that two of the four are sitting idle. One click on Test says so.
     *
     * **It reports what the PLUGIN offers, never what the station asks for**, and the distinction is
     * real rather than pedantic: whether a chart or a neighbour reaches the air is decided by
     * `rotation.chartMix` and `rotation.similarMix`, which are STATION settings this plugin cannot
     * see — `host.config` is its own config and nothing else. So the honest thing to say is that
     * they are ready and where the switch lives. The host says the other half, once, from the
     * generators themselves.
     */
    private summarise(scrobbling: string): string {
        const tags = this.includeTags
            ? 'Tags, artist background and listener counts are on'
            : 'Tags are off, so only background and links are collected';

        return `${tags}. Charts and similar artists are ready — the station uses them only once the chart and similar-artist mixes are set in rotation settings. ${scrobbling}`;
    }

    /** The scrobbling half, which has three ways of being off and one of being on. */
    private async scrobbleState(): Promise<string> {
        if (!this.scrobbling) return 'Scrobbling is off, so nothing is being published.';
        if (this.client?.canSign !== true) return 'Scrobbling is on but has no API secret to sign with, so nothing is being published.';

        const session = await this.sessionKey();
        if (!session) return 'Scrobbling is on, but no account is connected yet — use Connect above.';

        return `Scrobbling to ${(await this.sessionUser()) ?? 'your account'}.`;
    }

    // ---------------------------------------------------------------- enrichment

    /**
     * What Last.fm knows about a recording.
     *
     * One request. `track.getInfo` takes the artist and title directly, so there
     * is no search step and nothing to score — which is why this plugin has no
     * match-score setting where the MusicBrainz one does. `autocorrect` is on,
     * so a slightly-off spelling still lands, and the answer carries the
     * service's own spelling back.
     *
     * A miss is `{}` per the SDK contract. Error 6 is the ordinary "no such
     * track" here, and it is data rather than a failure.
     */
    async enrichTrack(ref: TrackRef): Promise<Partial<TrackEnrichment>> {
        if (!this.client) return {};

        try {
            const response = await this.client.get<LastfmTrackInfoResponse>('track.getInfo', {
                artist: ref.artist,
                track: ref.title,
                autocorrect: '1',
            });

            return response.track ? mapTrack(response.track, this.minTagWeight, this.includeTags) : {};
        } catch (error) {
            if (this.isNotFound(error)) return {};
            throw error;
        }
    }

    /**
     * What Last.fm knows about an artist: the tags, the biography and the audience.
     *
     * The richest of the three, and the one worth having even on a station that
     * turns the others off. `mbid` is preferred where the catalog has resolved
     * one, since a name is ambiguous and an MBID is not.
     */
    async enrichArtist(ref: ArtistRef): Promise<Partial<ArtistEnrichment>> {
        if (!this.client) return {};

        try {
            const response = await this.client.get<LastfmArtistInfoResponse>('artist.getInfo', {
                ...(ref.mbid ? { mbid: ref.mbid } : { artist: ref.providerRef ?? ref.name }),
                autocorrect: '1',
            });

            return response.artist ? mapArtist(response.artist, this.minTagWeight, this.includeTags) : {};
        } catch (error) {
            if (this.isNotFound(error)) return {};
            throw error;
        }
    }

    /** The album equivalent. Thin, because this is not a release database. */
    async enrichAlbum(ref: AlbumRef): Promise<Partial<AlbumEnrichment>> {
        if (!this.client) return {};

        const previous = readRef(ref.providerRef);

        try {
            // Artist and title, NEVER the mbid, which is the opposite of what `enrichArtist`
            // above does. `albums.mbid` is a MusicBrainz release-GROUP id by definition (the
            // host promotes it under `musicbrainz-release-group`) and this endpoint indexes
            // RELEASE mbids, so handing it one is a lookup that cannot succeed. Measured on
            // this install: 2 hits in 432 albums that carried an mbid, against 7 in 86 that
            // had none and fell through to the names.
            const response = await this.client.get<LastfmAlbumInfoResponse>('album.getInfo', {
                artist: previous?.artist ?? ref.artist,
                album: previous?.name ?? ref.name,
                autocorrect: '1',
            });

            return response.album ? mapAlbum(response.album, this.minTagWeight, this.includeTags) : {};
        } catch (error) {
            if (this.isNotFound(error)) return {};
            throw error;
        }
    }

    // -------------------------------------------------------------------- charts

    /**
     * The charts on offer: the global one, a handful of countries, and the
     * operator's own if they named one.
     *
     * No request. The service has no endpoint that enumerates its charts — they
     * are endpoints rather than documents — so this is a description of what
     * `fetchChart` below can do, which is the honest thing for `listCharts` to be.
     */
    async listCharts(): Promise<ChartDescriptor[]> {
        if (!this.client) return [];

        const charts: ChartDescriptor[] = [
            { id: GLOBAL_CHART, name: 'Top tracks worldwide', description: 'What Last.fm listeners everywhere are playing most right now.' },
        ];

        const configured = this.chartCountry.trim();
        if (configured.length > 0) {
            charts.push({ id: `${GEO_PREFIX}${configured}`, name: `Top tracks in ${configured}`, country: configured });
        }

        for (const country of COUNTRIES) {
            if (country.name.toLowerCase() === configured.toLowerCase()) continue;
            charts.push({ id: `${GEO_PREFIX}${country.name}`, name: `Top tracks in ${country.name}`, country: country.code });
        }

        return charts;
    }

    /**
     * One chart's entries.
     *
     * Three families behind one id. `tag:` is reachable and deliberately NOT
     * listed above: a chart exists for every tag anybody has ever applied, so
     * enumerating them is impossible and offering ten arbitrary ones would be a
     * worse menu than none.
     *
     * **`date` is ignored, and that is the honest answer.** Last.fm publishes no
     * historical chart through the API — every one of these endpoints answers for
     * now — and the SDK says a service that keeps no history should answer with
     * its current edition rather than throwing. A show built on "this week in
     * 1994" needs a different source.
     */
    async fetchChart(query: ChartQuery): Promise<ChartEntry[]> {
        if (!this.client) return [];

        const limit = String(Math.max(1, Math.min(query.limit, 100)));
        const [method, params] = this.chartRequest(query.chartId, limit);
        if (!method) return [];

        try {
            const response = await this.client.get<LastfmTopTracksResponse>(method, params);
            const tracks = asList(response.tracks?.track ?? response.toptracks?.track);

            const entries: ChartEntry[] = [];
            for (const track of tracks) {
                const title = track.name?.trim();
                // The LEAD artist, which on these endpoints is the only one given.
                // A record with no credit is unusable downstream: the pick path
                // matches on the artist, so an empty one resolves to nothing.
                const artist = artistNameOf(track.artist);
                if (!title || !artist) continue;

                entries.push({ rank: entries.length + 1, title, artist });
            }

            return entries;
        } catch (error) {
            this.host.logger.debug('lastfm could not read a chart', { chartId: query.chartId, reason: errorText(error) });
            return [];
        }
    }

    /**
     * The id of this service's chart for one style.
     *
     * The other half of the `tag:` family `fetchChart` has always understood and `listCharts` has
     * always refused to enumerate. Nothing here is new work — `tag.getTopTracks` was reachable the
     * whole time — it is only the naming step, so a caller can get from "the operator asked for
     * jazz" to an id without knowing that this plugin spells it `tag:`.
     *
     * The style is passed through as the operator's own word rather than matched against anything.
     * Last.fm's tags ARE free text, so `heavy metal`, `britpop` and `witch house` are all real
     * charts, and a word nobody tagged answers empty — which is the same outcome as a chart with
     * nothing in it and needs no separate handling.
     */
    styleChartId(style: string): string | undefined {
        const tag = style.trim();
        if (!this.client || tag.length === 0) return undefined;

        return `${TAG_PREFIX}${tag}`;
    }

    /** Which endpoint a chart id names, and what to send it. */
    private chartRequest(chartId: string, limit: string): [string | undefined, Record<string, string>] {
        if (chartId === GLOBAL_CHART) return ['chart.getTopTracks', { limit }];
        if (chartId.startsWith(GEO_PREFIX)) return ['geo.getTopTracks', { country: chartId.slice(GEO_PREFIX.length), limit }];
        if (chartId.startsWith(TAG_PREFIX)) return ['tag.getTopTracks', { tag: chartId.slice(TAG_PREFIX.length), limit }];

        this.host.logger.debug('lastfm was asked for a chart it does not offer', { chartId });
        return [undefined, {}];
    }

    // ---------------------------------------------------------------- similarity

    /**
     * Who resembles this artist.
     *
     * The capability MusicBrainz cannot provide at all, and the reason a station
     * that already has an identity source still wants this one.
     *
     * `match` comes back as a string between 0 and 1 and is passed through as a
     * number. The host orders within one source's answer and never compares two
     * sources' scores, which is right: this one is derived from co-listening and
     * another's might be derived from tags.
     */
    async similarArtists(ref: ArtistRef, limit: number): Promise<SimilarArtist[]> {
        if (!this.client) return [];

        try {
            const response = await this.client.get<LastfmSimilarArtistsResponse>('artist.getSimilar', {
                ...(ref.mbid ? { mbid: ref.mbid } : { artist: ref.providerRef ?? ref.name }),
                limit: String(Math.max(1, Math.min(limit || DEFAULT_SIMILAR_LIMIT, 100))),
                autocorrect: '1',
            });

            const found: SimilarArtist[] = [];
            for (const artist of asList(response.similarartists?.artist)) {
                const name = artist?.name?.trim();
                if (!name) continue;

                const match = asNumber(artist.match);
                found.push({
                    name,
                    ...(artist.mbid?.trim() ? { mbid: artist.mbid.trim() } : {}),
                    providerRef: name,
                    ...(match === undefined ? {} : { match: Math.max(0, Math.min(match, 1)) }),
                });
            }

            return found;
        } catch (error) {
            if (this.isNotFound(error)) return [];
            throw error;
        }
    }

    /**
     * What to play by an artist.
     *
     * The half that turns a name into something the station can schedule. Without
     * it a similarity source can inform a DJ and cannot programme an hour.
     */
    async artistTopTracks(ref: ArtistRef, limit: number): Promise<ArtistTrack[]> {
        if (!this.client) return [];

        try {
            const response = await this.client.get<LastfmTopTracksResponse>('artist.getTopTracks', {
                ...(ref.mbid ? { mbid: ref.mbid } : { artist: ref.providerRef ?? ref.name }),
                limit: String(Math.max(1, Math.min(limit || 10, 50))),
                autocorrect: '1',
            });

            const tracks: ArtistTrack[] = [];
            for (const track of asList(response.toptracks?.track)) {
                const title = track.name?.trim();
                // The service's own spelling of the artist rather than the one that
                // was asked about, because `autocorrect` may have changed it and
                // the pick path matches on what it is given.
                const artist = artistNameOf(track.artist) ?? ref.name;
                if (!title) continue;

                tracks.push({ title, artist });
            }

            return tracks;
        } catch (error) {
            if (this.isNotFound(error)) return [];
            throw error;
        }
    }

    // ------------------------------------------------------------------ scrobble

    /**
     * Whether this installation is publishing anything.
     *
     * Three conditions, and each is a different thing the operator has or has not
     * done: the switch is on, the secret is present, and an account is connected.
     * Any one missing means no rows are queued at all — which is the whole point
     * of this method existing, since a station using Last.fm for its tags alone
     * should accumulate nothing.
     */
    async accepting(): Promise<boolean> {
        if (!this.scrobbling || !this.client?.canSign) return false;
        return (await this.sessionKey()) !== undefined;
    }

    /**
     * Report a batch of plays.
     *
     * Batched with indexed parameters — `artist[0]`, `track[0]`, `timestamp[0]` —
     * which is what makes fifty plays one request. The timestamps are SECONDS
     * here and milliseconds everywhere in this codebase, which is the one unit
     * conversion in this plugin and the one worth getting wrong loudly rather
     * than quietly: a millisecond timestamp is the year 57000 and is refused as
     * "too new", not silently accepted.
     *
     * Rejections are classified per the host's contract. See
     * {@link PERMANENT_IGNORE_CODES} for which of the service's ignore codes are
     * worth another attempt.
     */
    async scrobble(plays: ScrobblePlay[]): Promise<ScrobbleResult> {
        if (plays.length === 0) return { accepted: 0, rejected: [] };

        const session = await this.sessionKey();
        if (!this.client || !session) {
            // A throw rather than a rejection list: nothing about this batch is
            // wrong, so every row should be retried once the operator connects.
            throw new LastfmRequestError(200, 'Last.fm has no connected account to scrobble to', { apiError: LASTFM_ERROR.invalidSession });
        }

        const params: Record<string, string> = { sk: session };
        plays.forEach((play, index) => {
            params[`artist[${index}]`] = play.artist;
            params[`track[${index}]`] = play.title;
            params[`timestamp[${index}]`] = String(Math.floor(play.playedAt / 1000));
            if (play.album) params[`album[${index}]`] = play.album;
            if (play.albumArtist) params[`albumArtist[${index}]`] = play.albumArtist;
            if (play.trackNumber !== undefined) params[`trackNumber[${index}]`] = String(play.trackNumber);
            if (play.mbid) params[`mbid[${index}]`] = play.mbid;
            if (play.durationMs !== undefined) params[`duration[${index}]`] = String(Math.round(play.durationMs / 1000));
            // The station chose it, not a listener. The service uses this to decide
            // whether a play informs the account's recommendations.
            params[`chosenByUser[${index}]`] = '1';
        });

        const response = await this.client.post<LastfmScrobbleResponse>('track.scrobble', params);
        return readScrobbleResult(response, plays.length);
    }

    /**
     * Say what is on air.
     *
     * Not batched and not retried by anyone: the host sends it once at the moment
     * the record starts, because it describes now.
     */
    async nowPlaying(play: ScrobblePlay): Promise<void> {
        const session = await this.sessionKey();
        if (!this.client || !session) return;

        await this.client.post('track.updateNowPlaying', {
            sk: session,
            artist: play.artist,
            track: play.title,
            ...(play.album ? { album: play.album } : {}),
            ...(play.albumArtist ? { albumArtist: play.albumArtist } : {}),
            ...(play.durationMs === undefined ? {} : { duration: String(Math.round(play.durationMs / 1000)) }),
        });
    }

    // --------------------------------------------------------------------- oauth

    /**
     * Where to send the operator to approve the station.
     *
     * Last.fm's flow is not OAuth 2 and fits the host's seam anyway: a token is
     * minted BEFORE the consent screen rather than after it, and the same token
     * comes back to be exchanged for a session key that does not expire.
     *
     * **The state rides in the callback's own query string**, because the host
     * mints it and requires it back, and this service echoes no state parameter
     * of its own — it appends only `token`. If a future version of the service
     * were to mangle a callback URL that already has a query, the flow would fail
     * closed with the host's neutral message rather than completing unverified,
     * which is the right way for that to break.
     */
    async getAuthorizeUrl(state: string): Promise<string> {
        if (!this.client) throw new LastfmRequestError(200, 'Add your Last.fm API key first', { apiError: LASTFM_ERROR.invalidApiKey });

        const { token } = await this.client.get<LastfmTokenResponse>('auth.getToken');
        if (!token) throw new LastfmRequestError(200, 'Last.fm would not issue a request token');

        const redirect = await this.host.oauth.getRedirectUri();
        const callback = `${redirect}${redirect.includes('?') ? '&' : '?'}state=${encodeURIComponent(state)}`;
        const apiKey = (await this.host.secrets.get('apiKey'))?.trim() ?? '';

        return `${AUTH_ORIGIN}?api_key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}&cb=${encodeURIComponent(callback)}`;
    }

    /**
     * Exchange the approved token for a session key.
     *
     * The session key does not expire and is the only thing a scrobble needs, so
     * it is all that is stored — alongside the username, which exists purely so
     * the settings card can say whose account this is.
     */
    async handleCallback(params: Record<string, string>): Promise<void> {
        const token = params.token?.trim();
        if (!this.client || !token) throw new LastfmRequestError(200, 'Last.fm did not return a token to exchange');

        const response = await this.client.post<LastfmSessionResponse>('auth.getSession', { token });
        const key = response.session?.key?.trim();
        if (!key) throw new LastfmRequestError(200, 'Last.fm would not issue a session key');

        await this.host.oauth.saveTokens({
            [SESSION_KEY]: key,
            [SESSION_USER]: response.session?.name?.trim() ?? '',
        });

        this.host.logger.info('lastfm account connected', { user: response.session?.name });
    }

    // ------------------------------------------------------------------ internals

    /** The stored session key, or nothing when no account has been connected. */
    private async sessionKey(): Promise<string | undefined> {
        const tokens = await this.host.oauth.getTokens();
        const key = tokens?.[SESSION_KEY]?.trim();
        return key && key.length > 0 ? key : undefined;
    }

    /** Whose account it is, for the settings card. */
    private async sessionUser(): Promise<string | undefined> {
        const tokens = await this.host.oauth.getTokens();
        const user = tokens?.[SESSION_USER]?.trim();
        return user && user.length > 0 ? user : undefined;
    }

    /**
     * Whether a failure means "no such thing" rather than "something is wrong".
     *
     * TWO shapes, because this API has two. Error 6 is `invalid parameters` and
     * is what it answers for an artist or track it has never heard of. And
     * `album.getInfo` answers a plain **HTTP 404** for a record it cannot find,
     * with no error number at all in some responses.
     *
     * Recognising only the first cost 66 of 75 albums in one live enrichment
     * pass: every ordinary miss reached the host as a failure, so it was logged
     * as a fault AND no miss row was written — which means the walk re-asked the
     * same 66 albums on every pass, forever, and could never converge.
     */
    private isNotFound(error: unknown): boolean {
        if (!(error instanceof LastfmRequestError)) return false;
        return error.apiError === LASTFM_ERROR.invalidParameters || error.status === 404;
    }
}

/**
 * What became of one scrobble batch, in the host's terms.
 *
 * Exported and pure because it is the piece with the real consequences: getting
 * `retryable` backwards either fills the queue forever or throws away a listen,
 * and neither is visible from a live run without waiting a day.
 */
export function readScrobbleResult(response: LastfmScrobbleResponse, submitted: number): ScrobbleResult {
    const entries = asList(response.scrobbles?.scrobble);
    const rejected: ScrobbleRejection[] = [];

    entries.forEach((entry, index) => {
        const code = asNumber(entry?.ignoredMessage?.code);
        // 0 and absent both mean accepted: the service sends `code: "0"` on every
        // entry it took.
        if (code === undefined || code === 0) return;

        rejected.push({
            index,
            reason: entry.ignoredMessage?.['#text']?.trim() || `Last.fm ignored this play (code ${code})`,
            retryable: !PERMANENT_IGNORE_CODES.has(code),
        });
    });

    // Counted from what came back rather than from the `@attr.accepted` the
    // service reports, so the two halves cannot disagree — the host treats
    // anything not rejected as accepted, and this keeps that arithmetic true even
    // when the response is shorter than the batch.
    const accepted = Math.max(0, submitted - rejected.length);
    return { accepted, rejected };
}
