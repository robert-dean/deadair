import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import {
    ENRICHMENT_MATCH_KEY_ARTIST_TITLE,
    ENRICHMENT_MATCH_KEY_ISRC,
    type AlbumEnrichment,
    type AlbumRef,
    type ArtistEnrichment,
    type ArtistRef,
    type TrackEnrichment,
    type TrackRef,
} from '@deadair/plugin-sdk';
import { asEnrichmentPlugin, type EnrichmentPlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import {
    mergeAlbumEnrichment,
    mergeArtistEnrichment,
    mergeEnrichment,
    sanitizeAlbumEnrichment,
    sanitizeArtistEnrichment,
    sanitizeEnrichment,
    type StoredAlbumEnrichment,
    type StoredArtistEnrichment,
    type StoredEnrichment,
} from './enrichment.merge.js';
import { EnrichmentRepository, type EnrichableAlbum, type EnrichableArtist, type EnrichableTrack } from './enrichment.repository.js';
import { errorText } from '#modules/shared/error.text.js';

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
 * How long the walk waits on one call into a plugin.
 *
 * `PluginInvoker` defaults to `PLUGIN_INVOKE_TIMEOUT_MS`, which is the figure
 * for a call the host knows nothing about. This walk knows quite a lot: its
 * sources are rate limited in single requests per second, a call is a handful
 * of those, and it runs in a cron job with minutes to spare rather than on a
 * request path with a person waiting. Fifteen seconds is the wrong number for
 * that, and it showed — an album call is three paced requests and was being
 * killed mid-flight, throwing away the release group it had already fetched.
 *
 * Budgeted per request the method actually makes, rather than one constant for
 * all three, because the difference between them is exactly the number of
 * upstream round trips. Raising the shared default instead would have handed
 * every plugin in the system the same rope to cover this one walk's shape.
 *
 * A plugin that needs materially more than this is not a case for a bigger
 * constant here: it is the case for the per-plugin ceiling an operator sets,
 * which does not exist yet.
 */
const UPSTREAM_REQUEST_BUDGET_MS = 12_000;

/** Identify the recording, then load its document. */
export const ENRICH_TRACK_TIMEOUT_MS = 2 * UPSTREAM_REQUEST_BUDGET_MS;

/** Search for the artist when the catalog has no id yet, then load them. */
export const ENRICH_ARTIST_TIMEOUT_MS = 2 * UPSTREAM_REQUEST_BUDGET_MS;

/** Search for the record, load the release group, then one release for the label. */
export const ENRICH_ALBUM_TIMEOUT_MS = 3 * UPSTREAM_REQUEST_BUDGET_MS;

/**
 * How long the walk waits on one `enrichTracks` chunk.
 *
 * Not scaled by the number of refs in the chunk, which is the whole point of the
 * method existing: a batch call is a small fixed number of upstream round trips
 * because the host chunks to the plugin's own `maxBatchSize`. A source that
 * answers about twenty-five tracks in one query costs one query's time.
 *
 * Four rather than two, because a batch path is allowed to fall back: identify
 * the batch in one request, and then spend a couple more on the refs that one
 * request could not account for.
 */
export const ENRICH_TRACK_BATCH_TIMEOUT_MS = 4 * UPSTREAM_REQUEST_BUDGET_MS;

/**
 * How long "that provider had nothing" is trusted.
 *
 * Much shorter than a real answer, and never permanent. MusicBrainz gains
 * recordings constantly, so a track it does not have today may exist next
 * month: the cost of asking again is one request, and the cost of never asking
 * again is a track that stays anonymous forever. A week is also short enough
 * that a bad week for an upstream cannot poison the catalog for longer than
 * one.
 *
 * Without this the walk has no way to converge. A track nothing can identify
 * has no row for any provider, so it is outstanding on every pass, forever,
 * and re-costs every source each time.
 */
export const ENRICHMENT_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

/**
 * A release *group*, not a release. `albums.mbid` is documented as the
 * release-group id, and the distinction is real: a record is the work, and the
 * pressing an operator holds a copy of is one of many.
 */
export const SOURCE_MUSICBRAINZ_RELEASE_GROUP = 'musicbrainz-release-group';

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

export interface EnrichmentAlbumOutcome extends EnrichmentEntityOutcome {
    albumId: string;
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

/**
 * One track's place in a batch: the question, and the providers it is waiting on.
 *
 * `only` is per ref rather than per batch because that is how the walk's
 * selection query reports it — two tracks in the same batch can be outstanding
 * on different providers, and holding both to the union would re-ask a source
 * that answered one of them last week.
 */
export interface BatchEnrichRequest {
    ref: TrackRef;
    /** Providers this ref is waiting on. Absent means every capable provider. */
    only?: string[];
}

/** {@link EnrichOptions} plus what each provider called this artist last time. */
export interface ArtistEnrichOptions extends EnrichOptions {
    /** Provider id to the id that provider fetched under, from its stored row. */
    refs?: Record<string, string>;
}

/**
 * Plugins that were asked, could have matched, and said they had nothing.
 *
 * Deliberately not the same list as `failures`. A plugin that threw is
 * evidence about the plugin or its upstream, not about the recording, and
 * remembering a bad minute as "this source does not have this track" would
 * make it last a week.
 */
export interface EnrichmentMisses {
    misses: string[];
}

export interface EnrichmentResult extends EnrichmentMisses {
    /** Every plugin's answer folded together in priority order. */
    enrichment: Partial<TrackEnrichment>;
    /** The answers themselves, in the order they were merged. Empty answers are dropped. */
    contributions: EnrichmentContribution[];
    failures: EnrichmentFailure[];
}

export interface ArtistEnrichmentResult extends EnrichmentMisses {
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

export interface AlbumEnrichmentContribution {
    pluginId: string;
    priority: number;
    enrichment: StoredAlbumEnrichment;
}

export interface AlbumEnrichmentResult extends EnrichmentMisses {
    enrichment: Partial<AlbumEnrichment>;
    contributions: AlbumEnrichmentContribution[];
    failures: EnrichmentFailure[];
}

/** What one track has heard so far, while the fan-out is still walking the providers. */
interface TrackAccumulator {
    contributions: EnrichmentContribution[];
    failures: EnrichmentFailure[];
    misses: string[];
}

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
    // Free, and the only key here that cannot match the wrong recording. The
    // track pass promotes it onto `tracks.mbid` from whichever source resolved
    // one, exactly as the artist and album passes have always been handed theirs
    // — so a plugin arriving after MusicBrainz gets an exact question rather
    // than a title to guess with, and the first pass over a fresh catalog is the
    // only one where it is absent.
    mbid: track.mbid,
    artist: track.artistName,
    title: track.title,
    album: track.albumName,
    durationMs: track.durationMs,
    year: track.year,
});

/**
 * The id a stored payload was fetched under, as the plugin stated it.
 *
 * Asked for rather than inferred. This used to read the first `externalIds`
 * entry on the theory that a plugin lists its own identifier first, which
 * MusicBrainz happens to do and nothing guarantees: a source that knows a
 * foreign id — a local library reading an mbid out of file tags — would have had
 * somebody else's identifier recorded as its own and handed back to it next
 * pass, missing every lookup silently. `externalIds` is now free to be listed in
 * any order, because it answers a different question.
 *
 * Provenance, not identity — the schema is explicit that this column records
 * what was asked, even when the answer later proves wrong.
 */
const providerRef = (contribution: { enrichment: { providerRef?: string } }): string | undefined => contribution.enrichment.providerRef;

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
        return pluginsWith(this.pluginRegistry.list(), asEnrichmentPlugin).sort(
            (left, right) => left.priority - right.priority || byPluginId(left, right),
        );
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

    /** {@link artistProviders} for records. */
    albumProviders(): EnrichmentPlugin[] {
        return this.providers().filter(plugin => plugin.enrichesAlbums);
    }

    albumProviderIds(): string[] {
        return this.albumProviders().map(plugin => plugin.record.id);
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
        const [result] = await this.enrichBatch([{ ref, only: options.only }], options.signal);
        return result!;
    }

    /**
     * {@link enrich} for several tracks at once, index-aligned with `requests`.
     *
     * The reason this exists rather than a loop over {@link enrich}: enrichment
     * sources are paced in single requests per second, and some of them can
     * answer about a whole batch in one query. A plugin that implements
     * `enrichTracks` is handed its refs in chunks of its own `maxBatchSize`; one
     * that does not is looped exactly as before, so this is a fast path and
     * never a new requirement on a plugin.
     *
     * Still sequential across plugins, for the reason the single-track path was:
     * parallelism buys nothing except several plugins simultaneously parked on
     * their limiters, all spending the same deadline.
     */
    async enrichBatch(requests: BatchEnrichRequest[], signal?: AbortSignal): Promise<EnrichmentResult[]> {
        const accumulators = requests.map(() => ({
            contributions: [] as EnrichmentContribution[],
            failures: [] as EnrichmentFailure[],
            misses: [] as string[],
        }));

        for (const plugin of this.providers()) {
            if (signal?.aborted) break;

            // The positions this plugin is both wanted for and able to answer.
            // Indices rather than refs, because every answer has to find its way
            // back to the request it belongs to.
            const applicable = requests
                .map((request, index) => ({ request, index }))
                .filter(({ request }) => !request.only || request.only.includes(plugin.record.id))
                .filter(({ request }) => canMatch(plugin, request.ref));

            if (applicable.length === 0) continue;

            if (plugin.enrichesBatches) {
                for (let cursor = 0; cursor < applicable.length; cursor += plugin.maxBatchSize) {
                    if (signal?.aborted) break;
                    await this.askInBulk(plugin, applicable.slice(cursor, cursor + plugin.maxBatchSize), accumulators);
                }
                continue;
            }

            for (const { request, index } of applicable) {
                if (signal?.aborted) break;
                await this.askOne(plugin, request.ref, accumulators[index]!);
            }
        }

        return accumulators.map(accumulator => ({
            enrichment: mergeEnrichment(accumulator.contributions.map(contribution => contribution.enrichment)),
            contributions: accumulator.contributions,
            failures: accumulator.failures,
            misses: accumulator.misses,
        }));
    }

    /**
     * One `enrichTracks` chunk, with the per-ref path as its safety net.
     *
     * A plugin that answers with the wrong number of entries has a bug, not an
     * opinion: the entries cannot be aligned to the refs they are about, and
     * storing them anyway would file one track's facts against another. That is
     * far worse than being slow, so the chunk is re-asked one ref at a time.
     */
    private async askInBulk(
        plugin: EnrichmentPlugin,
        chunk: { request: BatchEnrichRequest; index: number }[],
        accumulators: TrackAccumulator[],
    ): Promise<void> {
        const pluginId = plugin.record.id;
        const refs = chunk.map(({ request }) => request.ref);

        let answers: Partial<TrackEnrichment>[];
        try {
            answers = await this.pluginInvoker.invoke(pluginId, 'enrichment.enrichTracks', async () => plugin.instance.enrichTracks!(refs), {
                timeoutMs: ENRICH_TRACK_BATCH_TIMEOUT_MS,
            });
        } catch (error) {
            const message = errorText(error);
            for (const { index } of chunk) accumulators[index]!.failures.push({ pluginId, message });
            this.logger.warn('enrichment plugin failed on a batch', { pluginId, refs: refs.length, error: message });
            return;
        }

        if (!Array.isArray(answers) || answers.length !== refs.length) {
            this.logger.warn('enrichment plugin answered a batch with the wrong shape, falling back to one at a time', {
                pluginId,
                asked: refs.length,
                answered: Array.isArray(answers) ? answers.length : typeof answers,
            });
            for (const { request, index } of chunk) await this.askOne(plugin, request.ref, accumulators[index]!);
            return;
        }

        chunk.forEach(({ index }, position) => this.record(plugin, answers[position], accumulators[index]!));
    }

    /** One `enrichTrack` call, recorded against the ref it was about. */
    private async askOne(plugin: EnrichmentPlugin, ref: TrackRef, accumulator: TrackAccumulator): Promise<void> {
        const pluginId = plugin.record.id;
        try {
            const answer = await this.pluginInvoker.invoke(pluginId, 'enrichment.enrichTrack', async () => plugin.instance.enrichTrack(ref), {
                timeoutMs: ENRICH_TRACK_TIMEOUT_MS,
            });
            this.record(plugin, answer, accumulator);
        } catch (error) {
            const message = errorText(error);
            accumulator.failures.push({ pluginId, message });
            this.logger.warn('enrichment plugin failed', { pluginId, artist: ref.artist, title: ref.title, error: message });
        }
    }

    /**
     * One plugin's answer about one track, sanitized and filed.
     *
     * An empty answer is the ordinary "I do not have this track". Recording it
     * as a contribution would write an empty payload over whatever that provider
     * knew last month, so it is remembered as a miss instead — which is a
     * shorter-lived and much weaker claim.
     */
    private record(plugin: EnrichmentPlugin, answer: Partial<TrackEnrichment> | undefined, accumulator: TrackAccumulator): void {
        const pluginId = plugin.record.id;
        const enrichment = sanitizeEnrichment(answer ?? {}, reason =>
            this.logger.warn('enrichment plugin returned something unstorable', { pluginId, reason }),
        );

        if (Object.keys(enrichment).length === 0) {
            accumulator.misses.push(pluginId);
            return;
        }

        accumulator.contributions.push({ pluginId, priority: plugin.priority, enrichment });
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
        const misses: string[] = [];

        for (const plugin of this.artistProviders()) {
            if (signal?.aborted) break;
            if (only && !only.includes(plugin.record.id)) continue;

            const pluginId = plugin.record.id;
            const scoped: ArtistRef = { ...ref, providerRef: refs?.[pluginId] };

            try {
                const answer = await this.pluginInvoker.invoke(
                    pluginId,
                    'enrichment.enrichArtist',
                    async () => plugin.instance.enrichArtist!(scoped),
                    { timeoutMs: ENRICH_ARTIST_TIMEOUT_MS },
                );
                const enrichment = sanitizeArtistEnrichment(answer, reason =>
                    this.logger.warn('enrichment plugin returned something unstorable', { pluginId, reason }),
                );
                if (Object.keys(enrichment).length === 0) {
                    misses.push(pluginId);
                    continue;
                }
                contributions.push({ pluginId, priority: plugin.priority, enrichment });
            } catch (error) {
                const message = errorText(error);
                failures.push({ pluginId, message });
                this.logger.warn('artist enrichment plugin failed', { pluginId, artist: ref.name, error: message });
            }
        }

        return { enrichment: mergeArtistEnrichment(contributions.map(contribution => contribution.enrichment)), contributions, failures, misses };
    }

    /** {@link enrichArtist} for a record. */
    async enrichAlbum(ref: AlbumRef, options: ArtistEnrichOptions = {}): Promise<AlbumEnrichmentResult> {
        const { only, refs, signal } = options;
        const contributions: AlbumEnrichmentContribution[] = [];
        const failures: EnrichmentFailure[] = [];
        const misses: string[] = [];

        for (const plugin of this.albumProviders()) {
            if (signal?.aborted) break;
            if (only && !only.includes(plugin.record.id)) continue;

            const pluginId = plugin.record.id;
            const scoped: AlbumRef = { ...ref, providerRef: refs?.[pluginId] };

            try {
                const answer = await this.pluginInvoker.invoke(pluginId, 'enrichment.enrichAlbum', async () => plugin.instance.enrichAlbum!(scoped), {
                    timeoutMs: ENRICH_ALBUM_TIMEOUT_MS,
                });
                const enrichment = sanitizeAlbumEnrichment(answer, reason =>
                    this.logger.warn('enrichment plugin returned something unstorable', { pluginId, reason }),
                );
                if (Object.keys(enrichment).length === 0) {
                    misses.push(pluginId);
                    continue;
                }
                contributions.push({ pluginId, priority: plugin.priority, enrichment });
            } catch (error) {
                const message = errorText(error);
                failures.push({ pluginId, message });
                this.logger.warn('album enrichment plugin failed', { pluginId, album: ref.name, artist: ref.artist, error: message });
            }
        }

        return { enrichment: mergeAlbumEnrichment(contributions.map(contribution => contribution.enrichment)), contributions, failures, misses };
    }

    /**
     * Enriches one catalog album and writes what came back.
     *
     * `mbid` is promoted from the merged view here rather than from the track
     * pass, because a release-group id is the album's identity and no other
     * pass is looking one up.
     */
    async enrichCatalogAlbum(album: EnrichableAlbum, options: ArtistEnrichOptions = {}): Promise<EnrichmentAlbumOutcome> {
        const result = await this.enrichAlbum({ name: album.name, artist: album.artistName, mbid: album.mbid }, options);

        for (const contribution of result.contributions) {
            await this.enrichmentRepository.saveAlbumEnrichment(
                album.id,
                contribution.pluginId,
                providerRef(contribution),
                contribution.enrichment,
                ENRICHMENT_TTL_MS,
            );
        }

        for (const pluginId of result.misses) {
            await this.enrichmentRepository.recordAlbumEnrichmentMiss(album.id, pluginId, ENRICHMENT_MISS_TTL_MS);
        }

        const ids = result.enrichment.externalIds ?? [];
        const promoted =
            result.contributions.length === 0
                ? []
                : await this.enrichmentRepository.promoteAlbum(album.id, {
                      mbid: ids.find(entry => entry.source === SOURCE_MUSICBRAINZ_RELEASE_GROUP)?.id,
                      year: result.enrichment.year,
                      imageUrl: result.enrichment.artworkUrl,
                  });

        return { albumId: album.id, providers: result.contributions.map(contribution => contribution.pluginId), promoted, failures: result.failures };
    }

    /**
     * One batch of albums that have not heard from every album provider lately.
     *
     * `priority` is the records behind what the station is about to play, and it only ever reorders
     * this batch. See {@link enrichPending}.
     */
    async enrichPendingAlbums(limit: number, signal?: AbortSignal, priority: readonly string[] = []): Promise<EnrichmentPassSummary> {
        const summary: EnrichmentPassSummary = { scanned: 0, enriched: 0, promoted: 0, failed: 0 };

        const providers = this.albumProviderIds();
        if (providers.length === 0) return summary;

        const albums = await this.enrichmentRepository.listAlbumsNeedingEnrichment(providers, limit, priority);

        for (const album of albums) {
            if (signal?.aborted) break;
            summary.scanned++;

            try {
                const outcome = await this.enrichCatalogAlbum(album, { only: album.outstanding, refs: album.refs, signal });
                if (outcome.providers.length > 0) summary.enriched++;
                summary.promoted += outcome.promoted.length;
                if (outcome.failures.length > 0) summary.failed++;
            } catch (error) {
                summary.failed++;
                this.logger.warn('enrichment pass skipped an album', { albumId: album.id, error: errorText(error) });
            }
        }

        return summary;
    }

    /**
     * Enriches one catalog track and writes what came back.
     *
     * The payloads are stored per provider, exactly as each plugin said them,
     * including everything no column exists for. Only then is the merged view
     * promoted onto the canonical rows, and only into the gaps.
     *
     * A provider that answered nothing gets a miss row under a much shorter
     * TTL. That is the only thing that makes the walk converge: a track nothing
     * can identify would otherwise have no row for anybody, stay outstanding on
     * every pass forever, and re-cost every source each time. A provider that
     * *failed* gets nothing, because a bad minute is not evidence about the
     * recording.
     */
    async enrichCatalogTrack(track: EnrichableTrack, options: EnrichOptions = {}): Promise<EnrichmentTrackOutcome> {
        return this.writeTrackResult(track, await this.enrich(toTrackRef(track), options));
    }

    /**
     * The write half of {@link enrichCatalogTrack}, shared with the batch walk.
     *
     * Split out rather than duplicated because the ordering here is the part
     * that matters and must not drift between the two callers: payloads first,
     * then misses, then promotion off the merged view — and promotion only when
     * something actually answered, so a pass where every provider missed does
     * not touch the canonical row at all.
     */
    private async writeTrackResult(track: EnrichableTrack, result: EnrichmentResult): Promise<EnrichmentTrackOutcome> {
        for (const contribution of result.contributions) {
            await this.enrichmentRepository.saveTrackEnrichment(
                track.id,
                contribution.pluginId,
                providerRef(contribution),
                contribution.enrichment,
                ENRICHMENT_TTL_MS,
            );
        }

        for (const pluginId of result.misses) {
            await this.enrichmentRepository.recordTrackEnrichmentMiss(track.id, pluginId, ENRICHMENT_MISS_TTL_MS);
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

        for (const pluginId of result.misses) {
            await this.enrichmentRepository.recordArtistEnrichmentMiss(artist.id, pluginId, ENRICHMENT_MISS_TTL_MS);
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

    /**
     * One batch of artists that have not heard from every artist provider lately.
     *
     * `priority` is the artists behind what the station is about to play, and it only ever reorders
     * this batch. See {@link enrichPending}.
     */
    async enrichPendingArtists(limit: number, signal?: AbortSignal, priority: readonly string[] = []): Promise<EnrichmentPassSummary> {
        const summary: EnrichmentPassSummary = { scanned: 0, enriched: 0, promoted: 0, failed: 0 };

        const providers = this.artistProviderIds();
        if (providers.length === 0) return summary;

        const artists = await this.enrichmentRepository.listArtistsNeedingEnrichment(providers, limit, priority);

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
     *
     * `priority` is what the station is about to play, nearest slot first, and it
     * ORDERS this batch without changing what is in it — a record that has heard
     * from every provider is not selected either way. Empty is the ordinary case
     * and sorts as this always did. `LineupPriorityReader` is where it comes from
     * and argues why it exists at all.
     */
    async enrichPending(limit: number, signal?: AbortSignal, priority: readonly string[] = []): Promise<EnrichmentPassSummary> {
        const summary: EnrichmentPassSummary = { scanned: 0, enriched: 0, promoted: 0, failed: 0 };

        const providers = this.providerIds();
        if (providers.length === 0) return summary;

        const tracks = await this.enrichmentRepository.listTracksNeedingEnrichment(providers, this.isrcOnlyProviderIds(), limit, priority);
        if (tracks.length === 0) return summary;

        // The whole batch is asked at once, so a provider that can answer in
        // bulk sees the shape it needs. The selection query hands them over
        // clustered by album, which is what lets a source spend one request on a
        // record instead of one per track on it.
        const results = await this.enrichBatch(
            tracks.map(track => ({ ref: toTrackRef(track), only: track.outstanding })),
            signal,
        );

        // Written one at a time, deliberately: a write that fails is one track's
        // problem, and the rest of a batch that cost real upstream requests
        // should still land.
        for (const [index, track] of tracks.entries()) {
            const result = results[index]!;

            // Nothing heard at all, from anybody. That is an abort part way
            // through the fan-out rather than an answer, so the track is left
            // exactly as it was — no miss row, and not counted as scanned. It is
            // still outstanding, and the next pass will reach it.
            if (result.contributions.length === 0 && result.misses.length === 0 && result.failures.length === 0) continue;

            summary.scanned++;

            try {
                const outcome = await this.writeTrackResult(track, result);
                if (outcome.providers.length > 0) summary.enriched++;
                summary.promoted += outcome.promoted.length;
                if (outcome.failures.length > 0) summary.failed++;
            } catch (error) {
                summary.failed++;
                this.logger.warn('enrichment pass could not store a track', { trackId: track.id, error: errorText(error) });
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
