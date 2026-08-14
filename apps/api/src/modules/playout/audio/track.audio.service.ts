import { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import { PluginTrackResolver } from '../providers/plugin.resolver.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { TrackAudioRepository, type SourceAudio } from './track.audio.repository.js';
import { TRACK_CONTENT_TYPES, TRACK_SOURCE_TYPES, TrackContentType, TrackExtension, TrackStore } from './track.store.js';

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
 * How many failures in a row before the station stops offering the copy at all.
 *
 * Four, which against the retry ladder above is roughly an hour and a quarter of trying (5 + 10 + 20 +
 * 40 minutes) before a record is benched — long enough that a provider blip, a restarted shim or an
 * expired session costs nothing, short enough that a station is not offering a record nothing can serve
 * all evening.
 *
 * It counts CONSECUTIVE failures rather than total attempts, which is `recordSuccess` resetting the
 * counter. A count that only ever climbed would eventually bench a perfectly good catalogue, one
 * record at a time, silently — a record fetched successfully forty times and refused four is a record
 * with an intermittent upstream, not a copy to write off.
 */
const MISSING_AFTER_ATTEMPTS = 4;

/**
 * How far past the cursor a record is fetched before its slot, in ITEMS.
 *
 * Small on purpose, and the constraint is a provider's quota rather than disk. Every fetch is a whole
 * record off a rate-limited credential, and `docs/todo/provider-audio-failures.md` records a burst of
 * them exhausting Spotify's audio-key quota and taking the station off air — so the window is a few
 * records of lead, not an hour of it.
 *
 * **It LEADS the commit window rather than matching it**, which is the whole point and is a reversal of
 * what this said before. At three against a `COMMIT_LEAD` of three, the two windows were the same items:
 * a record's fetch started at the same pass that handed it over, so the first play of every record was a
 * provider round trip inside the request Liquidsoap was waiting on, and warming could only ever be an
 * optimisation. Six means a record is fetched several boundaries before its slot, which is what lets the
 * director REFUSE to commit one whose audio is not here yet — see `DirectorService.commit`. The lead is
 * the margin in which an upstream that will not serve can be discovered early enough to route around.
 *
 * It is deliberately not much larger than that. Every fetch is a whole record off a rate-limited
 * credential, and `docs/todo/provider-audio-failures.md` records a burst of them exhausting Spotify's
 * audio-key quota and taking the station off air. Six is a few records of lead, not an hour of it.
 *
 * A constant like `PLANT_AHEAD` and `WRITE_AHEAD` beside it, and for the same reason those are: it is
 * a number tied to the commit lead rather than a decision anybody would make from a console.
 *
 * It lives HERE rather than in `TrackCachePlanner`, which owns the window and reads backwards — and is
 * deliberate, exactly as `TRACK_PACE_MS` living in `AnalysisService` rather than in its job is. The
 * planner imports this service, so a constant the service reads cannot live in the planner: that cycle
 * loads fine under vitest and throws `Cannot access 'CACHE_AHEAD' before initialization` under Node's
 * ESM loader. Which it did, on the first boot after it was written.
 */
export const CACHE_AHEAD = 6;

/** Which copy of a record: the pair that keys `deadair.track_sources`. */
export interface TrackBinding {
    pluginId: string;
    externalId: string;
}

/**
 * How a binding is named in the answer {@link TrackAudioService.readyFor} gives.
 *
 * The pair rather than `track_sources.id`, because the caller is the director holding running-order
 * items, and an item carries the binding it was built from and has never seen a source id. Exported
 * so the reader and the writer of that set cannot spell the key differently.
 */
export const bindingKey = (binding: TrackBinding): string => `${binding.pluginId} ${binding.externalId}`;

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
 * ## A fetched record is always kept
 *
 * There used to be a `playout.trackCache` switch: off meant the station neither served from the cache
 * nor filled it, and the bytes went to a small bounded hold in memory instead of `TRACKS_DIR`. It is
 * gone, and the reason is that its off state stopped being expressible. A record may not be committed
 * to the running order until its audio is on this machine ({@link readyFor}), so a station keeping
 * nothing would have nothing ready and would never commit anything at all.
 *
 * What the switch was actually used for — A/B-ing a suspected bad cached file — is served better by
 * deleting the file: {@link locate} already treats a row claiming bytes the disk does not have as a
 * re-fetch, and repairs the row on the way through.
 *
 * The cost is that `TRACKS_DIR` grows without bound until eviction lands. See
 * `docs/todo/track-cache-eviction.md`, which is the follow-on and is deliberately not this change.
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

    constructor(
        // The ROOT container: this is a singleton, so its scoped dependencies have to be resolved per
        // call rather than injected. The same reasoning `SegmentTrackResolver` spells out — it is
        // reached from the request path, from a job and from the pusher's loop, and borrowing whichever
        // scope built it would mean holding a connection from a scope disposed moments later.
        private readonly container: Container,
        private readonly store: TrackStore,
        private readonly resolver: PluginTrackResolver,
        private readonly logger: Logger,
    ) {}

    /**
     * A record's audio: from disk, from a fetch already running, or from the provider.
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
        const source = await inScope(this.container, scope => scope.get(TrackAudioRepository).findForSource(sourceId));

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

        return this.fetchAndKeep(source, signal);
    }

    /**
     * Get a record's audio in hand before anything asks for it, and answer nothing.
     *
     * What the ripener's job calls. Identical to {@link ensure} in every respect except that the bytes
     * are dropped: they are on disk by the time this resolves, so the request that follows a minute
     * later is served without a provider round trip. Never throws — a warm that fails leaves the same
     * recorded failure a live request would, and the live request will try again.
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
     * Which of these bindings the station already has the audio for, by source id.
     *
     * The question the director's commit pass asks of its window, and it is asked HERE rather than
     * worked out by the caller from a `track_audio` row, because what "here" means is this class's
     * business: today it is a checksum on the row plus the file actually being on disk, and a caller
     * that only read the row would call a record ready whose file an operator had deleted.
     *
     * One query for the whole window and a `stat` per candidate. The stat is worth it for exactly
     * that case: {@link locate} repairs a row claiming bytes the disk has not got by re-fetching, but
     * it does that INSIDE the request the player is waiting on, which is the round trip this whole
     * arrangement exists to keep off the air path.
     *
     * A binding the catalog has written off is absent from the query rather than reported unready,
     * which is the same answer as far as this is concerned: not something to commit.
     */
    async readyFor(bindings: readonly TrackBinding[]): Promise<Set<string>> {
        if (bindings.length === 0) return new Set();

        const states = await inScope(this.container, scope => scope.get(TrackAudioRepository).findForBindings(bindings));
        const ready = await Promise.all(
            states.map(async state =>
                state.checksum !== undefined && state.ext !== undefined && (await this.store.exists(state.checksum, state.ext))
                    ? bindingKey(state)
                    : undefined,
            ),
        );

        return new Set(ready.filter((key): key is string => key !== undefined));
    }

    /** Whether this one binding's audio is on this machine. {@link readyFor} for a single record. */
    async has(binding: TrackBinding): Promise<boolean> {
        return (await this.readyFor([binding])).size > 0;
    }

    /**
     * The provider fetch, plus whatever the station does with the result.
     *
     * Every failure is recorded and none escapes as a rejection: a binding the provider will not serve
     * is an ordinary fact about the catalog rather than an error the request path should throw over,
     * and the row is what makes the ripener back off and what Phase 4's bench reads.
     */
    private async fetchAndKeep(source: SourceAudio, signal?: AbortSignal): Promise<ServedAudio | undefined> {
        try {
            const fetched = await this.download(source, signal);
            const served = await this.keep(source, fetched);

            await this.record(source.sourceId, served, fetched);

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

            // `attempts` on the row we read was the count BEFORE this failure, which the write above has
            // just bumped — hence `+ 1` rather than a re-read.
            if (source.attempts + 1 >= MISSING_AFTER_ATTEMPTS) await this.bench(source, reason);

            return undefined;
        }
    }

    /**
     * Stop offering a copy whose audio never arrives.
     *
     * Writes `track_sources.missing_at` through the catalog, which owns that table. Every reader
     * already excludes on it, so this one statement takes the binding out of rotation, out of binding
     * selection, out of measurement and out of the running order — see `TracksRepository`.
     *
     * A bench rather than a ban: the hourly `catalog.sync` clears the mark on every re-sighting, so a
     * record the provider still lists comes back, gets one more attempt, and is benched again if it
     * still refuses. That is the reason this uses `missing_at` and not `playable`, which nothing clears.
     *
     * Said at `warn` and once, because the station is narrowing its own rotation and nothing else will
     * mention it. Swallows its own failure: not being able to write the mark is not a reason to fail a
     * request that has already answered.
     */
    private async bench(source: SourceAudio, reason: string): Promise<void> {
        try {
            await inScope(this.container, async scope => {
                // Already benched, by an earlier failure or by ingest noticing the same thing: say nothing
                // rather than repeating a line an operator has already seen.
                if (!(await scope.get(TracksRepository).markBindingMissing(source.pluginId, source.externalId))) return;

                this.logger.warn('playout: giving up on a copy of a record; the catalog will stop offering it', {
                    plugin: source.pluginId,
                    track: source.externalId,
                    attempts: source.attempts + 1,
                    reason,
                });

                // Inside the `markBindingMissing` guard, so the feed carries the moment a copy was
                // written off and not every later request that finds it already benched. This is the
                // station narrowing its own rotation without being asked, which nothing else surfaces:
                // the symptom otherwise arrives weeks later as "that album stopped playing".
                //
                // `reason` is the station's own summary of why the fetch failed, never the upstream's
                // body — see the rule in `ActivityRecorder`.
                void scope.get(ActivityRecorder).record({
                    module: 'catalog',
                    kind: 'binding.benched',
                    severity: 'fault',
                    detail: `A copy of a record stopped serving after ${source.attempts + 1} attempts, so the station will not offer it again until a sync sees it: ${reason}`,
                    data: { pluginId: source.pluginId, externalId: source.externalId, attempts: source.attempts + 1 },
                });
            });
        } catch (error) {
            this.logger.warn('playout: could not write off a binding that will not serve', {
                plugin: source.pluginId,
                track: source.externalId,
                error: errorText(error),
            });
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
     * The bookkeeping half: what was fetched, and that the fetch worked.
     *
     * It used to be written with or without the bytes, because the bytes were optional. They are not
     * any more, so this always carries the checksum — and `recordSuccess` resetting `attempts` is
     * what makes that column mean CONSECUTIVE failures.
     */
    private async record(sourceId: string, served: ServedAudio, fetched: FetchedAudio): Promise<void> {
        await this.inScope(repository =>
            repository.recordSuccess(sourceId, {
                checksum: served.checksum,
                ext: fetched.ext,
                contentType: fetched.contentType,
                byteSize: fetched.body.byteLength,
            }),
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
        return inScope(this.container, scope => use(scope.get(TrackAudioRepository)));
    }
}

/** A record off the wire: the bytes, and what the upstream called them. */
interface FetchedAudio {
    body: Buffer;
    ext: TrackExtension;
    contentType: string;
}
