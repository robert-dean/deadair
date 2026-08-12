import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { PluginTrackResolver } from '../providers/plugin.resolver.js';
import { TrackAudioRepository } from './track.audio.repository.js';
import { TRACK_SOURCE_TYPES, TrackExtension, TrackStore } from './track.store.js';
import { trackCacheEnabled } from './track.cache.settings.js';

/**
 * How long one record may take to arrive.
 *
 * Generous next to the ten seconds an image gets, because this is a whole record off a rate-limited
 * account rather than a cover: the shim measures a 320kbps Ogg at 664ms, and a Subsonic transcode on
 * a busy server is a different order of thing. Bounded all the same, because a wedged fetch would
 * otherwise hold the job open until the broker expired it.
 */
const FETCH_TIMEOUT_MS = 90_000;

/**
 * The most bytes one record may be.
 *
 * A lossless album track runs to 40MB and an outlier further, so this is a guard against a mistake —
 * a whole album served as one file, an upstream streaming something that is not a record — rather
 * than a budget. **Exceeding it stores nothing.** A truncated file would air as a record that stops
 * mid-song, which is worse than the provider fetch it was replacing, so the cap has to be a failure
 * rather than a shorter file.
 */
export const MAX_TRACK_BYTES = 64 * 1024 * 1024;

/**
 * The fewest bytes that can be a record.
 *
 * Catches the case a content-type check cannot: an upstream answering 200 with an error page, a
 * proxy's "please authenticate" stub, a zero-length body from a relink that resolved to nothing.
 * Anything this small is not four minutes of audio whatever it calls itself.
 */
const MIN_TRACK_BYTES = 16 * 1024;

/**
 * How long a claim is good for.
 *
 * Longer than a fetch can take, so two jobs never download the same record at once, and short enough
 * that a job lost to a deploy is retried within the hour rather than leaving the binding claimed
 * until somebody notices.
 */
const CLAIM_HOLD_MS = 10 * 60 * 1000;

/** First retry after five minutes, doubling per attempt up to a day. The art cache's ladder. */
const BASE_RETRY_MS = 5 * 60 * 1000;
const MAX_RETRY_MS = 24 * 60 * 60 * 1000;

/** What the caller learns about one binding. `cached` means bytes are now on disk under `checksum`. */
export type TrackCacheOutcome = { cached: true; checksum: string; ext: TrackExtension; byteSize: number } | { cached: false; reason: string };

/** The extension for a response's content type, or undefined if it is not audio the store holds. */
function extensionFor(contentType: string | null): TrackExtension | undefined {
    if (contentType === null) return undefined;

    // `audio/mpeg; charset=binary` and friends: the parameters are noise here.
    const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    return TRACK_SOURCE_TYPES[mime];
}

/**
 * One line describing a failure, cause included.
 *
 * The cause is not decoration here. `fetch` rejects with a bare `TypeError: fetch failed` and puts
 * the only useful half — `ECONNREFUSED`, a DNS failure, a TLS error — on `cause`, and this row is the
 * ONLY evidence anybody gets: the station keeps playing through the provider, so nothing else is going
 * to notice. A `last_error` reading "fetch failed" costs an operator the whole diagnosis.
 */
const errorText = (error: unknown): string => {
    if (!(error instanceof Error)) return String(error);

    const causes: string[] = [];
    for (let cause = error.cause; cause instanceof Error && causes.length < 3; cause = cause.cause) {
        const code = (cause as { code?: string }).code;
        causes.push(code === undefined ? cause.message : `${cause.message} (${code})`);
    }

    return causes.length === 0 ? error.message : `${error.message}: ${causes.join(': ')}`;
};

/**
 * Fetching a record the station has played into the station's own copy of it.
 *
 * ## This is a second fetch, not a tee
 *
 * Liquidsoap downloads the provider URL itself and those bytes never pass through Node — that is the
 * whole point of handing over a URL rather than a stream — so nothing here can intercept them. What
 * this does instead is fetch the same binding again, once, in the background: the first play of a
 * record costs two downloads and every play after it costs none. Do not write a comment or a doc
 * claiming the air path was teed, and do not build anything on the assumption that it was.
 *
 * ## Why every failure is recorded rather than thrown
 *
 * A binding the provider will not serve is an ordinary fact about the catalog, not an error the
 * station should notice: the transport is still playing that record through the provider, and the
 * only thing this failing costs is the download it would have saved. The row is what makes the next
 * boundary back off instead of asking again immediately, which matters here more than it does for
 * art because a record comes round every few hours forever.
 */
@Injectable()
export class TrackCacheService {
    constructor(
        private readonly audio: TrackAudioRepository,
        private readonly store: TrackStore,
        private readonly resolver: PluginTrackResolver,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Fetches one binding's audio into the local store.
     *
     * Claims the row first, so a duplicate send is free: the resolver fires this off a boundary
     * without waiting for it, and a record that comes round twice while the first download is in
     * flight must not be downloaded twice.
     *
     * @param signal - The job's own cancellation, combined with this fetch's timeout, so abandoning
     *   the job aborts the request in flight rather than waiting out the ninety seconds.
     */
    async cache(pluginId: string, externalId: string, signal?: AbortSignal): Promise<TrackCacheOutcome> {
        // Checked here as well as in the resolver, because between the send and the run an operator
        // may have turned the cache off, and the job is the thing that would spend the download.
        // Before the claim, so a switched-off station leaves the row exactly as it found it.
        if (!trackCacheEnabled(this.config)) return { cached: false, reason: 'the track cache is turned off' };

        const binding = await this.audio.findByBinding(pluginId, externalId);
        if (binding === undefined) return { cached: false, reason: 'the catalog does not know this binding' };
        if (binding.checksum !== undefined) return { cached: true, checksum: binding.checksum, ext: binding.ext!, byteSize: binding.byteSize ?? 0 };

        if (!(await this.audio.claim(binding.sourceId, CLAIM_HOLD_MS))) {
            return { cached: false, reason: 'another fetch holds this binding' };
        }

        try {
            const fetched = await this.download(pluginId, externalId, signal);
            const checksum = await this.store.writeStream(fetched.body, fetched.ext);
            const byteSize = fetched.byteSize();

            // The size is only knowable once the last chunk has been hashed, so the floor is checked
            // here rather than in the download. The file is left on disk: it is content-addressed, so
            // it is either the same bytes something else legitimately holds or a few kilobytes that
            // nothing points at.
            if (byteSize < MIN_TRACK_BYTES) throw new Error(`only ${byteSize} bytes, which is not a record`);

            await this.audio.recordSuccess(binding.sourceId, { checksum, ext: fetched.ext, contentType: fetched.contentType, byteSize });

            this.logger.info('playout: kept a local copy of a record', {
                plugin: pluginId,
                track: externalId,
                ext: fetched.ext,
                bytes: byteSize,
            });

            return { cached: true, checksum, ext: fetched.ext, byteSize };
        } catch (error) {
            const reason = errorText(error);
            await this.audio.recordFailure(binding.sourceId, reason, BASE_RETRY_MS, MAX_RETRY_MS);

            // Debug, not warn: on a provider that will not serve part of its catalogue this is
            // routine and the station is playing normally through it. `track_audio.last_error` is
            // where the evidence lives.
            this.logger.debug('playout: could not keep a copy of a record', { plugin: pluginId, track: externalId, reason });

            return { cached: false, reason };
        }
    }

    /**
     * One record off the wire, as a stream.
     *
     * Streamed rather than buffered, unlike the art cache: a lossless track is tens of megabytes and
     * holding one whole in memory to hash it would be a per-fetch spike for nothing.
     * `ContentStore.writeStream` hashes chunks as they pass and renames into place at the end, so an
     * interrupted fetch leaves nothing behind under a name claiming to be a whole record.
     *
     * `http(s)` only, for the reason the art cache gives: these URLs come from plugins, which are
     * trusted in-process code and also the least reviewed code in the tree, and `file:` would turn a
     * bad mapping into a local file read.
     */
    private async download(
        pluginId: string,
        externalId: string,
        signal?: AbortSignal,
    ): Promise<{ body: AsyncIterable<Uint8Array>; ext: TrackExtension; contentType: string; byteSize: () => number }> {
        // Asked of the plugin rather than read off `track_sources.uri`, because the URL is usually
        // minted per call — signed, tokenised, or pointed at a station-side helper — and the resolver
        // is the one thing that knows how each provider answers.
        const url = await this.resolver.resolveBinding(pluginId, externalId);
        if (url === undefined) throw new Error('no provider would give a url for this binding');

        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`refusing to fetch ${parsed.protocol}`);

        const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
        const response = await fetch(parsed, {
            redirect: 'follow',
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });

        if (!response.ok) throw new Error(`upstream answered ${response.status}`);

        const contentType = response.headers.get('content-type');
        const ext = extensionFor(contentType);
        if (ext === undefined) {
            await response.body?.cancel().catch(() => undefined);
            throw new Error(`not audio this station can hold: ${contentType ?? 'no content type'}`);
        }

        if (response.body === null) throw new Error('upstream sent no body');

        let total = 0;
        const capped = async function* (body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
            for await (const chunk of body) {
                total += chunk.byteLength;
                if (total > MAX_TRACK_BYTES) {
                    // Thrown mid-stream on purpose. `writeStream` removes its temp file when the
                    // iterable throws, so an over-cap fetch stores nothing rather than a prefix of a
                    // record — see MAX_TRACK_BYTES.
                    await body.cancel().catch(() => undefined);
                    throw new Error(`larger than ${MAX_TRACK_BYTES} bytes, so it was not kept`);
                }
                yield chunk;
            }
        };

        return {
            body: capped(response.body),
            ext,
            contentType: contentType!.split(';')[0]!.trim().toLowerCase(),
            byteSize: () => total,
        };
    }
}
