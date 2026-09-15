import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { privateAddressBehind, resolveAddresses as systemResolver, type AddressResolver } from '#modules/plugins/plugin.grants.js';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { SegmentStore, SNIFF_BYTES, sniffSegmentExtension, type SegmentExtension } from '#modules/render/segment.store.js';
import { boundedChunks, BodyTooLargeError } from '#modules/shared/bounded.body.js';
import { errorText } from '#modules/shared/error.text.js';
import type { PodcastEpisodeRecord } from './podcast.episode.js';
import { PodcastEpisodeRepository } from './podcast.episode.repository.js';
import { SYNDICATED_KIND } from './syndicated.kind.js';

/**
 * The most an episode may be, in bytes.
 *
 * Sized against what the station would actually carry: the longest episode of the six real shows
 * this was checked against runs 170 minutes, which at 128 kbps is about 165 MB. A quarter of a
 * gigabyte clears that with room and still refuses the thing this is really for, which is an
 * enclosure that is not an episode at all (a video, a live stream that never ends).
 */
export const MAX_EPISODE_BYTES = 256 * 1024 * 1024;

/**
 * The least an episode may be. Anything smaller is an error page, a tracking pixel or a trailer
 * nobody meant to schedule, and airing it would be a second or two of something at the slot where a
 * programme was promised.
 */
export const MIN_EPISODE_BYTES = 64 * 1024;

/**
 * How long one fetch is given, start to finish.
 *
 * The whole download rather than the first byte: a podcast host serves from an origin that is
 * sometimes slow, and a hundred and sixty megabytes at a modest two megabits a second is eleven
 * minutes. Generous, because nothing is waiting on it — the station fetches hours ahead of the slot.
 */
export const EPISODE_FETCH_TIMEOUT_MS = 15 * 60_000;

/**
 * How many redirects a fetch follows. Podcast audio is almost always behind a chain of analytics
 * prefixes, each redirecting to the next: an NPR episode measured on 2026-09-15 took four redirects
 * through three of them before the host answered, and eight leaves room for a publisher with more.
 */
export const MAX_REDIRECTS = 8;

/** How long after asking the station waits before asking again, for a fetch that never reported back. */
export const FETCH_RETRY_AFTER_MS = EPISODE_FETCH_TIMEOUT_MS + 5 * 60_000;

/**
 * Who the station says it is.
 *
 * Podcast hosts count downloads by user agent, under a published measurement standard, and a request
 * from a named client is counted as a listen where an anonymous one is often discarded as a bot. A
 * station carrying a show is a listen the publisher should be able to see.
 */
const USER_AGENT = 'deadair/1.0 (+https://deadair.radio)';

/** The statuses that carry a `location` to follow. */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * How the fetch reaches the network, which a test replaces.
 *
 * A class rather than constructor defaults so injectkit can register it: `PodcastsModule` builds the
 * real one, and a test builds one that answers wherever it says.
 */
export class PodcastFetchOptions {
    constructor(
        readonly fetch: typeof globalThis.fetch = globalThis.fetch,
        readonly resolveAddresses: AddressResolver = systemResolver,
    ) {}
}

/** What one fetch came to. */
export type EpisodeFetchOutcome =
    | { outcome: 'fetched'; segmentId: string; bytes: number; ext: SegmentExtension }
    | { outcome: 'held'; segmentId: string }
    | { outcome: 'failed'; error: string }
    | { outcome: 'gone' };

/** A refusal worth saying in a sentence: the message is what the console shows beside the episode. */
class EpisodeFetchError extends Error {}

/**
 * Fetches an episode's audio into the station's own store, where it becomes a segment that can air.
 *
 * ## The station's fetch, not a plugin's
 *
 * The plugin that found the episode hands over an address and nothing else (`capabilities/podcast.ts`
 * says why). So this is the API's own `fetch`, the precedent `RenderService.fetchPad` set, and it
 * carries the bounds that door carries: one request chain, a deadline, a ceiling counted as the body
 * arrives rather than trusted from `content-length`.
 *
 * ## The one thing the pad door does not need
 *
 * An operator typing a pad's address is choosing where their own air horn lives, which is why that
 * door has no allowlist and no address check. An enclosure's address is written by whoever publishes
 * the FEED, and a public name in somebody else's feed can point at this machine as easily as at a CDN.
 * Airing whatever answered would put the station's own anonymous routes, or the analysis sidecar, on
 * the mount. So every hop's name is resolved first and refused if any address it answers with is
 * private — `privateAddressBehind`, the guard `network.open` puts on a plugin's fetches, applied per
 * redirect because every hop is a new name chosen by somebody else. It shares that guard's one gap,
 * rebinding between the check and the connection, and says so where the guard is written.
 *
 * ## What the bytes are is read from the bytes
 *
 * A publisher's media type is whatever their CMS wrote. The container is sniffed from the first bytes
 * (`sniffSegmentExtension`) and that decides what the file is served as, because Liquidsoap picks its
 * decoder from the served type and a wrong one fails as silence.
 *
 * ## Streamed, never held
 *
 * The body goes chunk by chunk into `SegmentStore.writeStream`, which hashes as it writes and renames
 * into place only once the whole file has arrived, so an episode never exists whole in memory and a
 * fetch that fails leaves nothing behind under a name that claims to be complete.
 */
@Injectable()
export class PodcastFetchService {
    constructor(
        private readonly episodes: PodcastEpisodeRepository,
        private readonly segments: SegmentRepository,
        private readonly store: SegmentStore,
        private readonly options: PodcastFetchOptions,
        private readonly activity: ActivityRecorder,
        private readonly logger: Logger,
    ) {}

    /**
     * Fetch one episode's audio and keep it as a segment, recording on the episode what happened.
     *
     * Never throws for anything the upstream did: every refusal and failure is an outcome, written on
     * the row so the console can say why, and counted so a scheduler can stop asking.
     */
    async fetchEpisode(id: string, signal?: AbortSignal): Promise<EpisodeFetchOutcome> {
        const episode = await this.episodes.get(id);
        if (episode === undefined) return { outcome: 'gone' };
        if (episode.segmentId !== undefined) return { outcome: 'held', segmentId: episode.segmentId };

        try {
            const { checksum, ext, bytes } = await this.download(episode.audioUrl, signal);

            const segment = await this.segments.createSyndicated({
                kind: SYNDICATED_KIND,
                label: labelFor(episode),
                audioChecksum: checksum,
                audioExt: ext,
                ...(episode.durationMs === undefined ? {} : { durationMs: episode.durationMs }),
                context: contextFor(episode),
            });
            await this.episodes.markFetched(episode.id, segment.id);

            this.logger.info('podcasts: fetched an episode', { episode: episode.id, show: episode.showId, segment: segment.id, bytes, ext });
            void this.activity.record({
                module: 'render',
                kind: 'podcast.fetched',
                severity: 'info',
                detail: `The station fetched ${episode.showTitle}: ${episode.title}, ready to air.`,
                data: { episodeId: episode.id, showId: episode.showId, segmentId: segment.id, bytes },
            });

            return { outcome: 'fetched', segmentId: segment.id, bytes, ext };
        } catch (error) {
            const reason = error instanceof EpisodeFetchError ? error.message : errorText(error);
            await this.episodes.markFetchFailed(episode.id, reason);

            this.logger.warn('podcasts: an episode could not be fetched', { episode: episode.id, show: episode.showId, error: reason });
            void this.activity.record({
                module: 'render',
                kind: 'podcast.fetch_failed',
                severity: 'warn',
                detail: `The station could not fetch ${episode.showTitle}: ${episode.title} (${reason}).`,
                data: { episodeId: episode.id, showId: episode.showId, attempts: episode.fetchAttempts + 1 },
            });

            return { outcome: 'failed', error: reason };
        }
    }

    /**
     * The audio at an address, into the store, as its checksum and what it was filed as.
     *
     * Redirects are followed by hand so each hop's name is checked before it is connected to, which a
     * `redirect: 'follow'` fetch would not allow.
     */
    private async download(url: string, signal?: AbortSignal): Promise<{ checksum: string; ext: SegmentExtension; bytes: number }> {
        const deadline = AbortSignal.timeout(EPISODE_FETCH_TIMEOUT_MS);
        const aborted = signal === undefined ? deadline : AbortSignal.any([deadline, signal]);

        let address = parseAddress(url);
        for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
            await this.refusePrivate(address);

            const response = await this.options.fetch(address, {
                redirect: 'manual',
                signal: aborted,
                headers: { 'user-agent': USER_AGENT, accept: 'audio/*, */*;q=0.1' },
            });

            const location = response.headers.get('location');
            if (REDIRECTS.has(response.status) && location !== null) {
                await response.body?.cancel().catch(() => {});
                address = parseAddress(location, address);
                continue;
            }

            if (!response.ok || response.body === null) {
                await response.body?.cancel().catch(() => {});
                throw new EpisodeFetchError(`the publisher answered ${response.status}`);
            }

            return await this.keep(response.body);
        }

        throw new EpisodeFetchError(`the address redirected more than ${MAX_REDIRECTS} times`);
    }

    /** Refuse an address whose name reaches this machine or the network it is on. */
    private async refusePrivate(address: URL): Promise<void> {
        let behind: string | undefined;
        try {
            behind = await privateAddressBehind(address.hostname, this.options.resolveAddresses);
        } catch (error) {
            // A name that does not resolve fails closed: the fetch behind it would fail on the same
            // lookup, and "could not resolve" must not read as "resolved to nothing private".
            throw new EpisodeFetchError(`${address.hostname} could not be resolved (${errorText(error)})`);
        }

        if (behind !== undefined)
            throw new EpisodeFetchError(`${address.hostname} reaches a private address, which the station will not fetch from a feed`);
    }

    /**
     * A body into the store: the first bytes sniffed for what it is, the rest counted as it streams.
     *
     * The ceiling and the floor are both enforced INSIDE the stream the store is writing, so a body
     * that turns out too large or too small fails the write, and the store removes its temp file
     * rather than keeping a file that is not an episode.
     */
    private async keep(body: ReadableStream<Uint8Array>): Promise<{ checksum: string; ext: SegmentExtension; bytes: number }> {
        const chunks = boundedChunks(body, MAX_EPISODE_BYTES);

        const head: Uint8Array[] = [];
        let seen = 0;
        try {
            while (seen < SNIFF_BYTES) {
                const next = await chunks.next();
                if (next.done) break;
                head.push(next.value);
                seen += next.value.byteLength;
            }
        } catch (error) {
            throw tooLarge(error);
        }

        const ext = sniffSegmentExtension(Buffer.concat(head));
        if (ext === undefined) {
            await chunks.return(undefined);
            throw new EpisodeFetchError('the address answered with something that is not audio the station can air');
        }

        let bytes = 0;
        const counted = async function* (): AsyncGenerator<Uint8Array> {
            for (const chunk of head) {
                bytes += chunk.byteLength;
                yield chunk;
            }
            for await (const chunk of chunks) {
                bytes += chunk.byteLength;
                yield chunk;
            }
            if (bytes < MIN_EPISODE_BYTES) throw new EpisodeFetchError(`the address answered with only ${bytes} bytes, which is not an episode`);
        };

        try {
            const checksum = await this.store.writeStream(counted(), ext);
            return { checksum, ext, bytes };
        } catch (error) {
            throw tooLarge(error);
        }
    }
}

/** A size refusal in words; anything else passes through untouched. */
function tooLarge(error: unknown): unknown {
    return error instanceof BodyTooLargeError ? new EpisodeFetchError(`the episode is larger than ${MAX_EPISODE_BYTES / 1024 / 1024} MB`) : error;
}

/** An http(s) address, resolved against the one that pointed at it. Anything else is a refusal. */
function parseAddress(raw: string, base?: URL): URL {
    let address: URL;
    try {
        address = new URL(raw, base);
    } catch {
        throw new EpisodeFetchError('the audio address is not one the station can read');
    }

    if (address.protocol !== 'http:' && address.protocol !== 'https:')
        throw new EpisodeFetchError(`the audio address is ${address.protocol} rather than http(s)`);
    return address;
}

/**
 * What the console calls the segment: the show and the episode.
 *
 * Capped at the length the segment contract allows, since a publisher's title has no limit.
 */
function labelFor(episode: PodcastEpisodeRecord): string {
    const label = `${episode.showTitle}: ${episode.title}`;
    return label.length <= 400 ? label : `${label.slice(0, 399)}…`;
}

/**
 * Which episode a segment is, flat, as `segments.context` holds it.
 *
 * What the running order needs to name it on the mount (`programmeRundownTrack`) and what a presenter
 * around it needs to introduce it (the summary, read by `WriteBreakJob`), written once now so nothing
 * at air time has to reach back into this module to ask. The summary is the publisher's teaser, already
 * plain text and already capped by the feed parser.
 */
function contextFor(episode: PodcastEpisodeRecord): Record<string, string | number | boolean> {
    return {
        podcastEpisodeId: episode.id,
        showId: episode.showId,
        episodeId: episode.episodeId,
        showTitle: episode.showTitle,
        episodeTitle: episode.title,
        ...(episode.publishedAt === undefined ? {} : { publishedAt: new Date(episode.publishedAt).toISOString() }),
        ...(episode.artworkUrl === undefined ? {} : { artworkUrl: episode.artworkUrl }),
        ...(episode.summary === undefined ? {} : { summary: episode.summary }),
    };
}
