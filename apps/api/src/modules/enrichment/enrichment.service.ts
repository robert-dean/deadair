import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import {
    ENRICHMENT_MATCH_KEY_ARTIST_TITLE,
    ENRICHMENT_MATCH_KEY_ISRC,
    type ArtistEnrichment,
    type ArtistRef,
    type TrackEnrichment,
    type TrackRef,
} from '@deadair/plugin-sdk';
import { asEnrichmentPlugin, type EnrichmentPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import {
    mergeArtistEnrichment,
    mergeEnrichment,
    sanitizeArtistEnrichment,
    sanitizeEnrichment,
    type StoredArtistEnrichment,
    type StoredEnrichment,
} from './enrichment.merge.js';
import { EnrichmentRepository, type EnrichableArtist, type EnrichableTrack } from './enrichment.repository.js';

/**
 * How long a stored payload is trusted before the walk asks again.
 *
 * Long, because the answers are stable: a recording's year, label and personnel
 * do not move, and what does move (a new relation, a corrected spelling) is not
 * worth a rate-limited request a week to catch. Bounded rather than infinite so
 * corrections do land eventually, and so a source that was wrong about a track
 * is not wrong about it forever.
 */
export const ENRICHMENT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * The `externalIds` sources the host promotes onto canonical columns.
 *
 * Naming MusicBrainz here is not the host playing favourites with a plugin:
 * `tracks.mbid` and `artists.mbid` are MusicBrainz columns by definition, named
 * as such in `0004_music.sql`, and a source string is the only thing that says
 * which id is one. Any plugin that resolves a MusicBrainz id may fill them by
 * saying so.
 */
export const SOURCE_MUSICBRAINZ_RECORDING = 'musicbrainz';
export const SOURCE_MUSICBRAINZ_ARTIST = 'musicbrainz-artist';

/** What one plugin contributed, kept apart from the merge because it is stored per provider. */
export interface EnrichmentContribution {
    pluginId: string;
    priority: number;
    /** Stored verbatim against this provider, `extra` and all. */
    enrichment: StoredEnrichment;
}

/** A plugin that was asked and could not answer. Reported, never thrown. */
export interface EnrichmentFailure {
    pluginId: string;
    message: string;
}

/** One run of the walk, for the job's log line. */
export interface EnrichmentPassSummary {
    scanned: number;
    /** Tracks that came back with something from at least one provider. */
    enriched: number;
    /** Canonical columns filled across the whole batch. */
    promoted: number;
    /** Tracks where at least one provider failed. Not the same as a track nobody could identify. */
    failed: number;
}

/** What one entity's pass did, for the job's log line. */
export interface EnrichmentEntityOutcome {
    /** Plugins that had something to say, and therefore have a stored payload. */
    providers: string[];
    /** Canonical columns this pass filled in. Empty is the normal case for a row already complete. */
    promoted: string[];
    failures: EnrichmentFailure[];
}

export interface EnrichmentTrackOutcome extends EnrichmentEntityOutcome {
    trackId: string;
}

export interface EnrichmentArtistOutcome extends EnrichmentEntityOutcome {
    artistId: string;
}

/**
 * How to run one fan-out.
 *
 * `only` is the walk telling the fan-out which providers this entity is
 * actually waiting on, so a source that answered last week is not asked again
 * because a different one expired. Absent means every capable provider, which
 * is what an on-demand caller wants: it has no stored rows to reason about.
 */
export interface EnrichOptions {
    only?: string[];
    signal?: AbortSignal;
}

/** {@link EnrichOptions} plus what each provider called this artist last time. */
export interface ArtistEnrichOptions extends EnrichOptions {
    /** Provider id to the id that provider fetched under, from its stored row. */
    refs?: Record<string, string>;
}

export interface EnrichmentResult {
    /** Every plugin's answer folded together in priority order. */
    enrichment: Partial<TrackEnrichment>;
    /** The answers themselves, in the order they were merged. Empty answers are dropped. */
    contributions: EnrichmentContribution[];
    failures: EnrichmentFailure[];
}

export interface ArtistEnrichmentResult {
    enrichment: Partial<ArtistEnrichment>;
    contributions: ArtistEnrichmentContribution[];
    failures: EnrichmentFailure[];
}

/** One plugin's answer about an artist, kept apart from the merge because it is stored per provider. */
export interface ArtistEnrichmentContribution {
    pluginId: string;
    priority: number;
    enrichment: StoredArtistEnrichment;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * A catalog row as the question a plugin is asked.
 *
 * `artistName` rather than the row's `artists` credit line: the credit is what
 * the release printed ("X feat. Y") and the canonical artist is what a lookup
 * should match on. A plugin that wants the credit can still see it in the
 * title-and-album context it gets.
 */
export const toTrackRef = (track: EnrichableTrack): TrackRef => ({
    isrc: track.isrc,
    artist: track.artistName,
    title: track.title,
    album: track.albumName,
    durationMs: track.durationMs,
    year: track.year,
});

/**
 * The id a stored payload was fetched under.
 *
 * The first `externalIds` entry, which is the convention the SDK's own example
 * follows: a plugin lists its most specific identifier for the thing it just
 * looked up first. Provenance, not identity — the schema is explicit that this
 * column records what was asked, even when the answer later proves wrong.
 */
const providerRef = (contribution: { enrichment: { externalIds?: { id: string }[] } }): string | undefined =>
    contribution.enrichment.externalIds?.[0]?.id;

/**
 * Whether it is worth asking this plugin about this track.
 *
 * `matchKeys` is the plugin telling the host what it can look a track up by,
 * and the honest reading of a plugin that only declares `isrc` is that a track
 * without one is not a question it can answer. Asking anyway would spend a
 * rate-limited request to be told nothing.
 */
export const canMatch = (plugin: EnrichmentPlugin, ref: TrackRef): boolean => {
    const keys = plugin.instance.matchKeys ?? [];
    if (keys.includes(ENRICHMENT_MATCH_KEY_ARTIST_TITLE)) return true;
    return keys.includes(ENRICHMENT_MATCH_KEY_ISRC) && ref.isrc !== undefined;
};

/**
 * The fan-out half of enrichment: ask every enrichment plugin about one track
 * and fold their answers into one.
 *
 * This is the piece the SDK has always described and nothing implemented.
 * Deliberately free of the database and of HTTP: it takes a `TrackRef` and
 * returns what was learned, so the job that walks the catalog, a future route
 * that enriches one track on demand, and a test all drive the identical path.
 *
 * A plugin that fails is data, not an exception. One quarantined source must
 * not deny the station everything the others knew, so a failure is recorded
 * against its plugin and the pass continues; `PluginInvoker` is already
 * counting those failures towards the breaker that will stop it being asked.
 */
@Injectable()
export class EnrichmentService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly enrichmentRepository: EnrichmentRepository,
        private readonly logger: Logger,
    ) {}

    /**
     * Every plugin that could answer right now, lowest `priority` first.
     *
     * Order is fixed here rather than at the call sites so the merge and the
     * "which providers has this track heard from" question cannot disagree
     * about who is running.
     */
    providers(): EnrichmentPlugin[] {
        const plugins: EnrichmentPlugin[] = [];
        for (const record of this.pluginRegistry.list()) {
            const plugin = asEnrichmentPlugin(record);
            if (plugin) plugins.push(plugin);
        }
        return plugins.sort((left, right) => left.priority - right.priority || left.record.id.localeCompare(right.record.id));
    }

    /** The ids of {@link providers}, which is what the catalog stores as `provider`. */
    providerIds(): string[] {
        return this.providers().map(plugin => plugin.record.id);
    }

    /**
     * The subset of {@link providers} that also answers about artists.
     *
     * A separate list rather than a flag checked at the call site, because the
     * artist walk's selection query counts providers: an artist held to a bar
     * that included a track-only plugin would stay outstanding forever, which
     * is the same trap `isrcOnlyProviderIds` exists to avoid for tracks.
     */
    artistProviders(): EnrichmentPlugin[] {
        return this.providers().filter(plugin => plugin.enrichesArtists);
    }

    artistProviderIds(): string[] {
        return this.artistProviders().map(plugin => plugin.record.id);
    }

    /**
     * The providers that can only match on ISRC, which the selection query has
     * to know about to avoid holding an ISRC-less track to a bar it can never
     * clear. See `listTracksNeedingEnrichment`.
     */
    isrcOnlyProviderIds(): string[] {
        return this.providers()
            .filter(plugin => !(plugin.instance.matchKeys ?? []).includes(ENRICHMENT_MATCH_KEY_ARTIST_TITLE))
            .map(plugin => plugin.record.id);
    }

    /**
     * Asks the capable plugins about one track.
     *
     * Sequential rather than concurrent, on purpose. Enrichment sources publish
     * rate limits measured in single requests per second and the host paces
     * each one to them, so parallelism here buys nothing except several plugins
     * simultaneously parked on their limiters, all spending the same deadline.
     *
     * With `only` set, the merged view is built from fewer answers than the
     * track has stored. That is safe rather than lossy because promotion fills
     * gaps and never overwrites: a subset can promote less than the whole would
     * have, never something different.
     */
    async enrich(ref: TrackRef, options: EnrichOptions = {}): Promise<EnrichmentResult> {
        const { only, signal } = options;
        const contributions: EnrichmentContribution[] = [];
        const failures: EnrichmentFailure[] = [];

        for (const plugin of this.providers()) {
            if (signal?.aborted) break;
            if (only && !only.includes(plugin.record.id)) continue;
            if (!canMatch(plugin, ref)) continue;

            const pluginId = plugin.record.id;
            try {
                const answer = await this.pluginInvoker.invoke(pluginId, 'enrichment.enrichTrack', async () => plugin.instance.enrichTrack(ref));
                const enrichment = sanitizeEnrichment(answer, reason =>
                    this.logger.warn('enrichment plugin returned something unstorable', { pluginId, reason }),
                );
                // An empty answer is the ordinary "I do not have this track".
                // Recording it as a contribution would write an empty payload
                // over whatever that provider knew last month.
                if (Object.keys(enrichment).length === 0) continue;
                contributions.push({ pluginId, priority: plugin.priority, enrichment });
            } catch (error) {
                const message = errorText(error);
                failures.push({ pluginId, message });
                this.logger.warn('enrichment plugin failed', { pluginId, artist: ref.artist, title: ref.title, error: message });
            }
        }

        return { enrichment: mergeEnrichment(contributions.map(contribution => contribution.enrichment)), contributions, failures };
    }

    /**
     * Asks the capable plugins about one artist.
     *
     * The sibling of {@link enrich}, and separate from it rather than a mode of
     * it: the answers have a different shape, land in a different table, and
     * are asked for once per artist rather than once per track, which is the
     * entire reason the method exists.
     *
     * Each plugin is handed its own `providerRef`, so two sources that both
     * know this artist under their own ids each get theirs back.
     */
    async enrichArtist(ref: ArtistRef, options: ArtistEnrichOptions = {}): Promise<ArtistEnrichmentResult> {
        const { only, refs, signal } = options;
        const contributions: ArtistEnrichmentContribution[] = [];
        const failures: EnrichmentFailure[] = [];

        for (const plugin of this.artistProviders()) {
            if (signal?.aborted) break;
            if (only && !only.includes(plugin.record.id)) continue;

            const pluginId = plugin.record.id;
            const scoped: ArtistRef = { ...ref, providerRef: refs?.[pluginId] };

            try {
                const answer = await this.pluginInvoker.invoke(pluginId, 'enrichment.enrichArtist', async () =>
                    plugin.instance.enrichArtist!(scoped),
                );
                const enrichment = sanitizeArtistEnrichment(answer, reason =>
                    this.logger.warn('enrichment plugin returned something unstorable', { pluginId, reason }),
                );
                if (Object.keys(enrichment).length === 0) continue;
                contributions.push({ pluginId, priority: plugin.priority, enrichment });
            } catch (error) {
                const message = errorText(error);
                failures.push({ pluginId, message });
                this.logger.warn('artist enrichment plugin failed', { pluginId, artist: ref.name, error: message });
            }
        }

        return { enrichment: mergeArtistEnrichment(contributions.map(contribution => contribution.enrichment)), contributions, failures };
    }

    /**
     * Enriches one catalog track and writes what came back.
     *
     * The payloads are stored per provider, exactly as each plugin said them,
     * including everything no column exists for. Only then is the merged view
     * promoted onto the canonical rows, and only into the gaps.
     *
     * A track nothing could identify is not an error and leaves no row. There is
     * no "we tried and failed" marker, deliberately: the next pass costs one
     * search, and a marker would be a second thing to keep true.
     */
    async enrichCatalogTrack(track: EnrichableTrack, options: EnrichOptions = {}): Promise<EnrichmentTrackOutcome> {
        const result = await this.enrich(toTrackRef(track), options);

        for (const contribution of result.contributions) {
            await this.enrichmentRepository.saveTrackEnrichment(
                track.id,
                contribution.pluginId,
                providerRef(contribution),
                contribution.enrichment,
                ENRICHMENT_TTL_MS,
            );
        }

        const promoted = result.contributions.length === 0 ? [] : await this.promote(track, result.enrichment);

        return { trackId: track.id, providers: result.contributions.map(contribution => contribution.pluginId), promoted, failures: result.failures };
    }

    /**
     * Enriches one catalog artist and writes what came back.
     *
     * The same shape as {@link enrichCatalogTrack}, one table over. Only the
     * artist's own image is promoted: `mbid` comes off the *track* pass, free
     * with the recording's artist credit, and `name` is not a gap anything can
     * fill.
     */
    async enrichCatalogArtist(artist: EnrichableArtist, options: ArtistEnrichOptions = {}): Promise<EnrichmentArtistOutcome> {
        const result = await this.enrichArtist({ name: artist.name, mbid: artist.mbid }, options);

        for (const contribution of result.contributions) {
            await this.enrichmentRepository.saveArtistEnrichment(
                artist.id,
                contribution.pluginId,
                providerRef(contribution),
                contribution.enrichment,
                ENRICHMENT_TTL_MS,
            );
        }

        const promoted =
            result.contributions.length === 0
                ? []
                : await this.enrichmentRepository.promoteArtist(artist.id, { imageUrl: result.enrichment.imageUrl });

        return {
            artistId: artist.id,
            providers: result.contributions.map(contribution => contribution.pluginId),
            promoted,
            failures: result.failures,
        };
    }

    /** One batch of artists that have not heard from every artist provider lately. */
    async enrichPendingArtists(limit: number, signal?: AbortSignal): Promise<EnrichmentPassSummary> {
        const summary: EnrichmentPassSummary = { scanned: 0, enriched: 0, promoted: 0, failed: 0 };

        const providers = this.artistProviderIds();
        if (providers.length === 0) return summary;

        const artists = await this.enrichmentRepository.listArtistsNeedingEnrichment(providers, limit);

        for (const artist of artists) {
            if (signal?.aborted) break;
            summary.scanned++;

            try {
                const outcome = await this.enrichCatalogArtist(artist, { only: artist.outstanding, refs: artist.refs, signal });
                if (outcome.providers.length > 0) summary.enriched++;
                summary.promoted += outcome.promoted.length;
                if (outcome.failures.length > 0) summary.failed++;
            } catch (error) {
                summary.failed++;
                this.logger.warn('enrichment pass skipped an artist', { artistId: artist.id, error: errorText(error) });
            }
        }

        return summary;
    }

    /**
     * One batch of tracks that have not heard from every provider lately.
     *
     * Bounded, and small: an enrichment source paced at one request per second
     * spends a few seconds per track, so the batch is really a statement about
     * how long one run takes. Whatever is left is picked up by the next run, and
     * there is always a next run.
     *
     * A track that fails is skipped, not retried here. Its rows are unchanged,
     * so it is still outstanding and the next pass will find it; retrying inside
     * the batch would spend the whole run on one bad track.
     */
    async enrichPending(limit: number, signal?: AbortSignal): Promise<EnrichmentPassSummary> {
        const summary: EnrichmentPassSummary = { scanned: 0, enriched: 0, promoted: 0, failed: 0 };

        const providers = this.providerIds();
        if (providers.length === 0) return summary;

        const tracks = await this.enrichmentRepository.listTracksNeedingEnrichment(providers, this.isrcOnlyProviderIds(), limit);

        for (const track of tracks) {
            if (signal?.aborted) break;
            summary.scanned++;

            try {
                const outcome = await this.enrichCatalogTrack(track, { only: track.outstanding, signal });
                if (outcome.providers.length > 0) summary.enriched++;
                summary.promoted += outcome.promoted.length;
                if (outcome.failures.length > 0) summary.failed++;
            } catch (error) {
                summary.failed++;
                this.logger.warn('enrichment pass skipped a track', { trackId: track.id, error: errorText(error) });
            }
        }

        return summary;
    }

    /**
     * The merged view onto the canonical rows: identity, and gaps only.
     *
     * `genre` takes the first genre rather than joining them, because the column
     * holds one and a comma-joined list would be a value nothing can group by.
     * The rest of what a plugin found stays in the jsonb payload, which is where
     * anything richer should read it from.
     */
    private async promote(track: EnrichableTrack, enrichment: Partial<TrackEnrichment>): Promise<string[]> {
        const ids = enrichment.externalIds ?? [];
        const idFor = (source: string): string | undefined => ids.find(entry => entry.source === source)?.id;

        const promoted = await this.enrichmentRepository.promoteTrack(track.id, {
            mbid: idFor(SOURCE_MUSICBRAINZ_RECORDING),
            year: enrichment.year,
            genre: enrichment.genres?.[0],
        });

        if (await this.enrichmentRepository.promoteArtistMbid(track.artistId, idFor(SOURCE_MUSICBRAINZ_ARTIST))) {
            promoted.push('artist.mbid');
        }

        if (track.albumId && (await this.enrichmentRepository.promoteAlbumArtwork(track.albumId, enrichment.artworkUrl))) {
            promoted.push('album.imageUrl');
        }

        return promoted;
    }
}
