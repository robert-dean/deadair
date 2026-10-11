import {
    Plugin,
    type ArtistRef,
    type ArtistTrack,
    type PluginConnectionResult,
    type SimilarArtist,
    type SimilarityPluginInstance,
} from '@deadair/plugin-sdk';

import { DeezerClient, DeezerRequestError } from './deezer.client.js';
import { DEFAULT_SIMILAR_LIMIT, DEFAULT_TOP_LIMIT, TEST_ARTIST_ID } from './deezer.manifest.js';
import { exactArtist, toArtistTracks, toSimilarArtists } from './deezer.mapping.js';
import type { DeezerArtist, DeezerList, DeezerTrack } from './deezer.types.js';

export { deezerManifest } from './deezer.manifest.js';

/**
 * Milliseconds below which the second half of a chain is not started.
 *
 * Every question here is two requests — find the artist, then ask about them —
 * and being cut off between them spends the first for nothing. Checked before
 * the second so a call that has run out of budget answers empty, which is an
 * ordinary answer, rather than throwing and counting against the plugin's
 * breaker.
 */
const STEP_BUDGET_MS = 1_500;

/** Deezer's ceiling on a list endpoint's `limit`. Asking for more is not an error, it is ignored. */
const MAX_LIMIT = 100;

/**
 * Deezer as a similarity source.
 *
 * ## Why this plugin exists
 *
 * The station's outward half — `SimilarSetGenerator`, `mixInSimilar`, the model's
 * similar-artists tool — is on by default and reaches for acts the library does not
 * hold. All of it hung on a single source, Last.fm, which needs an API key an
 * operator has to go and register for. Every install that had not done so ran a
 * station whose settings said discovery was on and whose `hasSimilarity()` was
 * false.
 *
 * Deezer's catalogue endpoints need no key, no account and no OAuth, so enabling
 * this plugin is the whole setup. That is its entire claim: not that it knows
 * better than Last.fm who resembles whom, but that it answers on a fresh install.
 *
 * ## Names in, names out
 *
 * Nothing here returns a track id, a provider id or a URL, per the capability. It
 * suggests; `PickResolver` runs the dislike veto, the repeat window and the rest
 * over every name, and looks the record up at whichever provider actually holds
 * the audio. So this cannot put a record on air that the operator forbade, and
 * the Deezer ids below never leave the plugin except as an opaque `providerRef`.
 *
 * ## Every question costs two requests, and the first one is strict
 *
 * Deezer keys everything on a numeric artist id, and the host asks in names. So
 * each answer is a search followed by the real question. The search is strict —
 * an exact normalised name or nothing — because Deezer ranks by popularity and
 * would otherwise answer a small act's name with a famous one, and an hour
 * programmed from the wrong artist's neighbours looks entirely healthy from every
 * other part of the station. See {@link exactArtist}.
 */
export class DeezerPlugin extends Plugin implements SimilarityPluginInstance {
    private client?: DeezerClient;

    protected async onLoad(): Promise<void> {
        const host = this.host;
        this.client = new DeezerClient(host);
        host.logger.info('deezer similarity ready');
    }

    protected async onUnload(): Promise<void> {
        this.client = undefined;
    }

    /**
     * One cheap request against a fixed id.
     *
     * The host also runs this unprompted while the plugin is quarantined, so it
     * stays one small GET and changes nothing upstream. A fixed id rather than a
     * search, so it fails when Deezer is unreachable and not when its ranking
     * moves.
     */
    async testConnection(): Promise<PluginConnectionResult> {
        const client = this.client;
        if (!client) return { ok: false, message: 'The plugin is not loaded.' };

        try {
            const artist = await client.get<DeezerArtist>(`artist/${TEST_ARTIST_ID}`);
            if (!artist.name) return { ok: false, message: 'Deezer answered, but not with an artist. Check the network path.' };

            return { ok: true, message: 'Connected to Deezer. No account or API key is needed.' };
        } catch (error) {
            return { ok: false, message: `Could not reach Deezer: ${this.reasonFor(error)}.` };
        }
    }

    /**
     * Who resembles this artist.
     *
     * Deezer's `related` is ordered by its own judgement and carries no score, so
     * the answer carries none either: the host orders within one source's answer,
     * and a position turned into a 0-to-1 number would be compared against
     * Last.fm's co-listening scores as though the two meant the same thing.
     */
    async similarArtists(ref: ArtistRef, limit: number): Promise<SimilarArtist[]> {
        const client = this.client;
        if (!client) return [];

        try {
            const id = await this.artistId(ref);
            if (id === undefined) return [];

            const related = await client.get<DeezerList<DeezerArtist>>(`artist/${id}/related`, {
                limit: String(this.clamp(limit, DEFAULT_SIMILAR_LIMIT)),
            });

            return toSimilarArtists(related.data ?? []);
        } catch (error) {
            if (this.isEmpty(error)) return [];
            throw error;
        }
    }

    /**
     * What to play by an artist.
     *
     * The half that turns a name into something the station can schedule.
     * Deezer's `top` is ordered by plays, which is the same basis Last.fm's
     * top tracks use, so the two are interchangeable here in a way they are not
     * for `similarArtists`.
     */
    async artistTopTracks(ref: ArtistRef, limit: number): Promise<ArtistTrack[]> {
        const client = this.client;
        if (!client) return [];

        try {
            const id = await this.artistId(ref);
            if (id === undefined) return [];

            const top = await client.get<DeezerList<DeezerTrack>>(`artist/${id}/top`, {
                limit: String(this.clamp(limit, DEFAULT_TOP_LIMIT)),
            });

            return toArtistTracks(top.data ?? []);
        } catch (error) {
            if (this.isEmpty(error)) return [];
            throw error;
        }
    }

    /**
     * The artist's Deezer id, by exact name, or nothing.
     *
     * `ref.providerRef` is deliberately not read, although this plugin puts its
     * own id there. Nothing in the host forwards it back yet, and the refs that
     * DO arrive here were built by the host from another source's answer — so a
     * `providerRef` reaching this method would be some other plugin's id, and
     * spending it as a Deezer one would look up an unrelated artist and succeed.
     * `ref.mbid` is not read either: Deezer has no MusicBrainz id anywhere in
     * its API.
     */
    private async artistId(ref: ArtistRef): Promise<number | undefined> {
        const client = this.client;
        const name = ref.name?.trim();
        if (!client || !name) return undefined;

        const found = await client.get<DeezerList<DeezerArtist>>('search/artist', { q: name, limit: '10' });
        const artist = exactArtist(found.data ?? [], name);
        if (!artist?.id) {
            this.host.logger.debug('deezer does not carry that artist under that name', { artist: name });
            return undefined;
        }

        // The second half of the chain is only worth starting with time to
        // finish it in.
        if (this.host.remainingMs() < STEP_BUDGET_MS) {
            this.host.logger.debug('deezer ran out of budget before asking', { artist: name });
            return undefined;
        }

        return artist.id;
    }

    /** A limit Deezer will accept, with the plugin's own default for a caller that asked for nothing. */
    private clamp(limit: number, fallback: number): number {
        return Math.max(1, Math.min(limit || fallback, MAX_LIMIT));
    }

    /**
     * Whether a failure means "nothing here" rather than "something is wrong".
     *
     * Deezer answers an id it does not know, and an artist with no neighbours,
     * with the same 200-plus-code-800. Both are ordinary empty answers. A 404 is
     * read the same way for the same reason. Everything else is raised, because a
     * quota or an outage that reads as "no neighbours" is a station that quietly
     * stops reaching outside its library.
     */
    private isEmpty(error: unknown): boolean {
        return error instanceof DeezerRequestError && (error.isNoData || error.status === 404);
    }

    /** The short reason for a connection message. */
    private reasonFor(error: unknown): string {
        if (error instanceof DeezerRequestError) {
            return error.upstreamCode === undefined ? `HTTP ${error.status}` : `Deezer error ${error.upstreamCode}`;
        }
        return 'the request failed';
    }
}
