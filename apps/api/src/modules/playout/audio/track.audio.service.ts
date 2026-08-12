import { createHash } from 'node:crypto';
import { Container } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { PluginTrackResolver } from '../providers/plugin.resolver.js';
import { TrackAudioRepository, type SourceAudio } from './track.audio.repository.js';
import { TRACK_CONTENT_TYPES, TRACK_SOURCE_TYPES, TrackContentType, TrackExtension, TrackStore } from './track.store.js';
import { trackCacheEnabled } from './track.cache.settings.js';

/**
 * How long one record may take to arrive.
 *
 * Generous next to the ten seconds an image gets, because this is a whole record off a rate-limited
 * account rather than a cover: the shim measures a 320kbps Ogg at 664ms, and a Subsonic transcode on a
 * busy server is a different order of thing. Bounded all the same, because this now runs on the air
 * path as well as on a job, and a wedged fetch there is a request Liquidsoap is waiting on.
 */
const FETCH_TIMEOUT_MS = 90_000;

/**
 * The most bytes one record may be.
 *
 * A lossless album track runs to 40MB and an outlier further, so this is a guard against a mistake — a
 * whole album served as one file, an upstream streaming something that is not a record — rather than a
 * budget. **Exceeding it serves and stores nothing.** A truncated file would air as a record that
 * stops mid-song, which is worse than an item the player skips.
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

/** First retry after five minutes, doubling per attempt up to a day. The art cache's ladder. */
const BASE_RETRY_MS = 5 * 60 * 1000;
const MAX_RETRY_MS = 24 * 60 * 60 * 1000;

/**
 * How far past the cursor a record is fetched before its slot, in ITEMS.
 *
 * Small on purpose, and the constraint is a provider's quota rather than disk. Every fetch is a whole
 * record off a rate-limited credential, and `docs/todo/provider-audio-failures.md` records a burst of
 * them exhausting Spotify's audio-key quota and taking the station off air — so the window is a few
 * records of lead, not an hour of it.
 *
 * Three, against a `COMMIT_LEAD` of 3: the window reaches exactly as far as the items the director has
 * not handed over yet, so a record is fetched while the ones ahead of it play and never while it is
 * being handed over. A record whose fetch does not finish in time is not lost — the request the player
 * makes fetches it — which is what keeps warming an optimisation rather than a dependency.
 *
 * A constant like `PLANT_AHEAD` and `WRITE_AHEAD` beside it, for the same reason those are:
 * `playout.trackCache` is the decision an operator has, and this is a number tied to the commit lead.
 *
 * It lives HERE rather than in `TrackCachePlanner`, which owns the window and reads backwards — and is
 * deliberate, exactly as `TRACK_PACE_MS` living in `AnalysisService` rather than in its job is. The
 * planner imports this service, so a constant the service reads cannot live in the planner: that cycle
 * loads fine under vitest and throws `Cannot access 'CACHE_AHEAD' before initialization` under Node's
 * ESM loader. Which it did, on the first boot after it was written.
 */
export const CACHE_AHEAD = 3;

/**
 * How much just-fetched audio to keep in memory for a station that is keeping nothing on disk.
 *
 * Bounded two ways on purpose. The entry count is what makes it a hold rather than a cache — it is
 * meant to carry a record from the ripener's fetch to the request a minute later, nothing longer. It is
 * derived from {@link CACHE_AHEAD} plus room for the record currently airing, so the window the ripener
 * fills and the hold that has to survive until those slots arrive cannot drift apart.
 *
 * The BYTE cap is the one that actually protects the process: at {@link MAX_TRACK_BYTES} even a handful
 * of entries is hundreds of megabytes resident, which a lossless catalogue would reach immediately.
 */
const HOLD_MAX_ENTRIES = CACHE_AHEAD + 2;
const HOLD_MAX_BYTES = 96 * 1024 * 1024;

/** Audio ready to hand to a caller, however it was come by. */
export interface ServedAudio {
    contentType: TrackContentType;
    body: Buffer;
    /** sha256 hex of these bytes. What the route's ETag is built from, on disk or not. */
    checksum: string;
}

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
 * The cause is not decoration. `fetch` rejects with a bare `TypeError: fetch failed` and puts the only
 * useful half — `ECONNREFUSED`, a DNS failure, a TLS error — on `cause`, and `track_audio.last_error`
 * is the only evidence anybody gets: an item that fails here is skipped by the player and the station
 * carries on. A `last_error` reading "fetch failed" costs an operator the whole diagnosis.
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
 * The one place the station gets a record's audio from.
 *
 * ## Why this exists at all
 *
 * Because the alternative was two paths. The transport used to hand the player either the station's
 * own URL (when a copy was on disk) or the PROVIDER's (when it was not), and a provider URL is only
 * fetchable from wherever it was minted for — a distinction that is invisible until an app on the host
 * is handed an address minted for a container and answers `ENOTFOUND`. Now the player is always handed
 * `/playout/audio/{sourceId}`, this is what serves it, and **the app is the only thing in the system
 * that ever fetches a provider**. One path, one vantage point, one place a failure is recorded.
 *
 * ## What `playout.trackCache` decides, and what it does not
 *
 * It decides whether a fetched record is KEPT, not whether it is available. Off, the station still
 * plays everything and still pre-fetches ahead of the cursor; the bytes go into a small bounded hold
 * in memory instead of `TRACKS_DIR`, and are gone shortly after. On, they are written
 * content-addressed and every later play is a local read. Either way the bookkeeping half of
 * `track_audio` — attempts, the last error, the backoff — is written, because a provider refusing a
 * binding is a fact worth keeping whether or not the station is hoarding audio.
 *
 * ## De-duplication is in-process, and that is deliberate
 *
 * A `Map` of in-flight fetches, not a database claim. Two things ask for the same record at once — a
 * `MAX_HAND_OVERS` retry arriving while the first request is still downloading, or the ripener racing
 * the request it was trying to spare — and both must wait on ONE download rather than starting a
 * second. The station is a single process by construction (one running order, one rundown, one
 * `AudienceWatch`), so a map in memory is exactly as correct as a lock in the database and costs no
 * round trip. The row went back to being a record rather than a mutex.
 */
export class TrackAudioService {
    /** Fetches in flight, by source id. The value is shared: everybody waiting gets the same bytes. */
    private readonly inFlight = new Map<string, Promise<ServedAudio | undefined>>();

    /** Just-fetched audio for a station keeping nothing. Insertion-ordered, so the oldest is first. */
    private readonly hold = new Map<string, ServedAudio>();

    private holdBytes = 0;

    constructor(
        // The ROOT container: this is a singleton, so its scoped dependencies have to be resolved per
        // call rather than injected. The same reasoning `SegmentTrackResolver` spells out — it is
        // reached from the request path, from a job and from the pusher's loop, and borrowing whichever
        // scope built it would mean holding a connection from a scope disposed moments later.
        private readonly container: Container,
        private readonly store: TrackStore,
        private readonly resolver: PluginTrackResolver,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * A record's audio: from disk, from the hold, from a fetch already running, or from the provider.
     *
     * `undefined` means there is nothing to play — no such binding, or a provider that would not serve
     * it — and the caller turns that into a 404, which the player treats as an item to skip.
     *
     * **The backoff is deliberately not consulted here.** A request for these bytes is a demand rather
     * than speculation: something is about to play this record, and refusing to try because a fetch
     * failed five minutes ago would turn a recoverable blip into a skipped item. The backoff exists to
     * stop the RIPENER spending downloads on a binding that keeps refusing, and that is where it is
     * read.
     */
    async ensure(sourceId: string, signal?: AbortSignal): Promise<ServedAudio | undefined> {
        // Checked FIRST, and the window it covers is the whole operation rather than just the download.
        // A lookup takes a round trip, and two callers arriving inside it would otherwise both come out
        // the other side and fetch — which is exactly the race the ripener asking `isFetching` is
        // trying to avoid.
        const running = this.inFlight.get(sourceId);
        if (running !== undefined) return running;

        const work = this.locate(sourceId, signal).finally(() => this.inFlight.delete(sourceId));
        this.inFlight.set(sourceId, work);

        return work;
    }

    /** {@link ensure}'s body, minus the de-duplication that wraps it. */
    private async locate(sourceId: string, signal?: AbortSignal): Promise<ServedAudio | undefined> {
        const scope = this.container.createScopedContainer();
        let source: SourceAudio | undefined;
        try {
            source = await scope.get(TrackAudioRepository).findForSource(sourceId);
        } finally {
            await scope.disposeAsync();
        }

        // Not a binding the catalog holds. A stale URL, or a source row deleted since the running order
        // was built.
        if (source === undefined) return undefined;

        if (source.checksum !== undefined && source.ext !== undefined) {
            const bytes = await this.store.read(source.checksum, source.ext);
            // A row claiming bytes the disk does not have. Rather than 404 — which would skip a record
            // the station can perfectly well fetch again — fall through and re-fetch, which also
            // repairs the row. This is the state a manually emptied TRACKS_DIR leaves behind.
            if (bytes !== undefined) {
                return { contentType: TRACK_CONTENT_TYPES[source.ext], body: bytes, checksum: source.checksum };
            }
            this.logger.warn('playout: a cached record is missing its file; fetching it again', { source: sourceId });
        }

        const held = this.hold.get(sourceId);
        if (held !== undefined) return held;

        return this.fetchAndKeep(source, signal);
    }

    /**
     * Get a record's audio in hand before anything asks for it, and answer nothing.
     *
     * What the ripener's job calls. Identical to {@link ensure} in every respect except that the bytes
     * are dropped: with the cache on they are on disk by the time this resolves, and with it off they
     * are in the hold, so either way the request that follows a minute later is served without a
     * provider round trip. Never throws — a warm that fails leaves the same recorded failure a live
     * request would, and the live request will try again.
     */
    async warm(sourceId: string, signal?: AbortSignal): Promise<boolean> {
        const served = await this.ensure(sourceId, signal).catch(error => {
            this.logger.debug('playout: could not warm a record', { source: sourceId, error: errorText(error) });
            return undefined;
        });

        return served !== undefined;
    }

    /**
     * Whether this binding is already being looked up or fetched, so the ripener does not queue a job
     * for a record something is already getting.
     *
     * Covers the lookup as well as the download, because that is the window de-duplication has to
     * cover: the read that decides whether a fetch is needed is itself a round trip.
     */
    isFetching(sourceId: string): boolean {
        return this.inFlight.has(sourceId);
    }

    /**
     * The provider fetch, plus whatever the station does with the result.
     *
     * Every failure is recorded and none escapes as a rejection: a binding the provider will not serve
     * is an ordinary fact about the catalog rather than an error the request path should throw over,
     * and the row is what makes the ripener back off and what Phase 4's bench reads.
     */
    private async fetchAndKeep(source: SourceAudio, signal?: AbortSignal): Promise<ServedAudio | undefined> {
        const keeping = trackCacheEnabled(this.config);

        try {
            const fetched = await this.download(source, signal);
            const served: ServedAudio = keeping ? await this.keep(source, fetched) : this.holdOnto(source.sourceId, fetched);

            await this.record(source.sourceId, served, fetched, keeping);

            return served;
        } catch (error) {
            const reason = errorText(error);
            await this.inScope(repository => repository.recordFailure(source.sourceId, reason, BASE_RETRY_MS, MAX_RETRY_MS));

            // Warn rather than debug, unlike the old background-only version: this fetch is on the air
            // path now, so a failure here is an item the player will skip.
            this.logger.warn('playout: could not get a record from its provider', {
                plugin: source.pluginId,
                track: source.externalId,
                reason,
            });

            return undefined;
        }
    }

    /** Write the bytes content-addressed and answer what to serve. */
    private async keep(source: SourceAudio, fetched: FetchedAudio): Promise<ServedAudio> {
        const checksum = await this.store.write(fetched.body, fetched.ext);

        this.logger.info('playout: kept a local copy of a record', {
            plugin: source.pluginId,
            track: source.externalId,
            ext: fetched.ext,
            bytes: fetched.body.byteLength,
        });

        return { contentType: TRACK_CONTENT_TYPES[fetched.ext], body: fetched.body, checksum };
    }

    /**
     * Put the bytes in the bounded hold and answer what to serve.
     *
     * The checksum is computed here rather than by the store, because the store is not involved: the
     * ETag has to be as real with the cache off as with it on, or a conditional GET would revalidate
     * against nothing.
     */
    private holdOnto(sourceId: string, fetched: FetchedAudio): ServedAudio {
        const served: ServedAudio = {
            contentType: TRACK_CONTENT_TYPES[fetched.ext],
            body: fetched.body,
            checksum: createHash('sha256').update(fetched.body).digest('hex'),
        };

        this.hold.set(sourceId, served);
        this.holdBytes += served.body.byteLength;

        // Oldest first, until both bounds are satisfied. `Map` iterates in insertion order, so the
        // first key is the least recently fetched.
        while (this.hold.size > HOLD_MAX_ENTRIES || this.holdBytes > HOLD_MAX_BYTES) {
            const oldest = this.hold.keys().next();
            if (oldest.done === true || oldest.value === sourceId) break;

            this.holdBytes -= this.hold.get(oldest.value)?.body.byteLength ?? 0;
            this.hold.delete(oldest.value);
        }

        return served;
    }

    /** The bookkeeping half, written whether or not the bytes were kept. */
    private async record(sourceId: string, served: ServedAudio, fetched: FetchedAudio, keeping: boolean): Promise<void> {
        await this.inScope(repository =>
            repository.recordSuccess(
                sourceId,
                keeping
                    ? { checksum: served.checksum, ext: fetched.ext, contentType: fetched.contentType, byteSize: fetched.body.byteLength }
                    : undefined,
            ),
        );
    }

    /**
     * One record off the wire, whole, with the caps enforced as it arrives.
     *
     * Buffered rather than streamed to disk, which is a change from the background-only version and
     * worth saying why: the caller is usually a route that has to hand the router a `Buffer`, so
     * streaming to disk and reading it back would be two passes over the same bytes to end up in the
     * same place. Peak cost is one track per in-flight fetch, and in-flight is de-duplicated per
     * binding and bounded by the ripener's window.
     *
     * `http(s)` only: these URLs come from plugins, which are trusted in-process code and also the
     * least reviewed code in the tree, and `file:` would turn a bad mapping into a local file read.
     */
    private async download(source: SourceAudio, signal?: AbortSignal): Promise<FetchedAudio> {
        // Asked of the plugin rather than read off `track_sources.uri`, because the URL is usually
        // minted per call — signed, tokenised, or pointed at a station-side helper — and the resolver is
        // the one thing that knows how each provider answers.
        const url = await this.resolver.resolveBinding(source.pluginId, source.externalId);
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

        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of response.body) {
            const buffer = Buffer.from(chunk as Uint8Array);
            total += buffer.byteLength;
            if (total > MAX_TRACK_BYTES) {
                await response.body.cancel().catch(() => undefined);
                throw new Error(`larger than ${MAX_TRACK_BYTES} bytes, so it was not kept`);
            }
            chunks.push(buffer);
        }

        if (total < MIN_TRACK_BYTES) throw new Error(`only ${total} bytes, which is not a record`);

        return { body: Buffer.concat(chunks), ext, contentType: contentType!.split(';')[0]!.trim().toLowerCase() };
    }

    /** One scope, one repository, one statement. This is a singleton, so it cannot hold either. */
    private async inScope(use: (repository: TrackAudioRepository) => Promise<void>): Promise<void> {
        const scope = this.container.createScopedContainer();
        try {
            await use(scope.get(TrackAudioRepository));
        } finally {
            await scope.disposeAsync();
        }
    }
}

/** A record off the wire: the bytes, and what the upstream called them. */
interface FetchedAudio {
    body: Buffer;
    ext: TrackExtension;
    contentType: string;
}
