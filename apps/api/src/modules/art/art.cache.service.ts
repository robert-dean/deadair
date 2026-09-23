import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { privateAddressBehind, resolveAddresses as systemResolver, type AddressResolver } from '#modules/plugins/plugin.grants.js';
import { PluginOperatorHosts } from '#modules/plugins/plugin.operator.hosts.js';
import { ArtRepository } from './art.repository.js';
import { ART_CONTENT_TYPES, ArtExtension, ArtStore } from './art.store.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * How long one image may take.
 *
 * The same ten seconds a MusicBrainz request gets. Cover Art Archive redirects to archive.org and
 * archive.org can be slow, but a cover is not worth holding a sweep open for.
 */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * The most bytes one image may be.
 *
 * Enforced while reading rather than from `content-length`, which is absent on a chunked response
 * and is in any case the upstream's claim rather than a fact. Cover Art Archive's `front-500` is
 * tens of kilobytes; the cap is here to stop a mistake (a full-size gatefold scan, an HTML error
 * page served as an image) rather than to be a tight budget.
 */
const MAX_BYTES = 5 * 1024 * 1024;

/** First retry after five minutes, doubling per attempt up to a day. */
const BASE_RETRY_MS = 5 * 60 * 1000;
const MAX_RETRY_MS = 24 * 60 * 60 * 1000;

/**
 * How many redirects one image follows.
 *
 * Cover Art Archive answers with two (to archive.org, then to the storage node holding the file), and
 * a CDN adds at most one more. The same five a plugin's own fetch gets.
 */
const MAX_REDIRECTS = 5;

/** The statuses that carry a `location` to follow. */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** What the caller learns about one URL. `cached` means bytes are now on disk under `id`. */
export type ArtCacheOutcome = { cached: true; id: string } | { cached: false; reason: string };

/**
 * How the fetch reaches the network, which a test replaces.
 *
 * A class rather than constructor defaults so injectkit can register it, on `PodcastFetchOptions`'s
 * pattern: `ArtModule` builds the real one, and a test builds one that answers wherever it says.
 */
export class ArtCacheOptions {
    constructor(
        readonly fetch: typeof globalThis.fetch = globalThis.fetch,
        readonly resolveAddresses: AddressResolver = systemResolver,
    ) {}
}

/** The extension for a response's content type, or undefined if it is not art we serve. */
function extensionFor(contentType: string | null): ArtExtension | undefined {
    if (contentType === null) return undefined;

    // `image/jpeg; charset=binary` and friends: the parameters are noise here.
    const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    return ART_CONTENT_TYPES[mime];
}

/** An http(s) address, resolved against the hop that pointed at it. Anything else is a refusal. */
function parseAddress(raw: string, base?: URL): URL {
    const address = new URL(raw, base);
    if (address.protocol !== 'http:' && address.protocol !== 'https:') {
        throw new Error(base === undefined ? `refusing to fetch ${address.protocol}` : `refusing a redirect to ${address.protocol}`);
    }
    return address;
}

/**
 * Fetches upstream art into the station's own store, which serves it publicly at `/art/{id}`.
 *
 * ## Whose address it is
 *
 * An art URL is DATA: `artists.image_url` and `albums.image_url` are whatever Last.fm, Deezer,
 * Wikipedia, Cover Art Archive, Spotify or a Navidrome's `getArtistInfo` said, and a public name in
 * any of those can be pointed at `127.0.0.1`, `169.254.169.254` or the analysis sidecar by whoever
 * owns it. A response that came back an image would then be published to anybody. So every hop is
 * resolved before it is connected to and refused if any address it answers with is private
 * (`privateAddressBehind`, the guard a plugin's `network.open` fetches get), and redirects are
 * followed by hand so a public host cannot bounce the fetch onto a private one.
 *
 * The exception is the one the plugin host makes: a server the OPERATOR pointed a plugin at is
 * theirs, and is allowed to be on the LAN. Navidrome's cover URLs live there, and refusing them would
 * cost every self-hosted library its sleeves. `PluginOperatorHosts` names those servers by host and
 * port, read once per sweep. It shares the guard's one gap, rebinding between the check and the
 * connection; see `privateAddressBehind`.
 */
@Injectable()
export class ArtCacheService {
    /** The operator's servers, read on the first fetch and kept for this instance's scope, which is one sweep. */
    private trusted?: Promise<ReadonlySet<string>>;

    constructor(
        private readonly artRepository: ArtRepository,
        private readonly artStore: ArtStore,
        private readonly operatorHosts: PluginOperatorHosts,
        private readonly options: ArtCacheOptions,
        private readonly logger: Logger,
    ) {}

    /**
     * Fetches one upstream art URL into the local store.
     *
     * Every failure is recorded rather than thrown: a dead cover is an ordinary fact about the
     * catalog, not an error the sweep should stop for, and the row is what makes the next pass back
     * off instead of asking again immediately.
     *
     * @param signal - The sweep's own cancellation, combined with this fetch's timeout. Aborting the
     *   job aborts the request in flight rather than waiting out the ten seconds.
     */
    async cache(sourceUrl: string, signal?: AbortSignal): Promise<ArtCacheOutcome> {
        try {
            const bytes = await this.download(sourceUrl, signal);
            const checksum = await this.artStore.write(bytes.body, bytes.ext);
            const asset = await this.artRepository.recordSuccess(sourceUrl, {
                checksum,
                ext: bytes.ext,
                contentType: bytes.contentType,
                byteSize: bytes.body.byteLength,
            });

            return { cached: true, id: asset.id };
        } catch (error) {
            const reason = errorText(error);
            await this.artRepository.recordFailure(sourceUrl, reason, BASE_RETRY_MS, MAX_RETRY_MS);
            this.logger.debug('could not cache art', { sourceUrl, reason });

            return { cached: false, reason };
        }
    }

    /**
     * One image off the wire.
     *
     * `http(s)` only, on every hop: these URLs come from plugins, which are trusted in-process code
     * but are also the least reviewed code in the tree, and `file:` would turn a bad mapping into a
     * local file read. That is a guard against a mistake; the private-address check on each hop is
     * the guard against the upstream (see the class).
     *
     * Redirects are followed by hand so each hop's name is checked before it is connected to, which a
     * `redirect: 'follow'` fetch would not allow. One deadline covers the whole chain and the body.
     */
    private async download(sourceUrl: string, signal?: AbortSignal): Promise<{ body: Buffer; ext: ArtExtension; contentType: string }> {
        const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
        const aborted = signal ? AbortSignal.any([signal, timeout]) : timeout;

        let address = parseAddress(sourceUrl);
        let from: URL | undefined;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
            await this.refusePrivate(address, from);

            const response = await this.options.fetch(address, { redirect: 'manual', signal: aborted });

            const location = response.headers.get('location');
            if (REDIRECTS.has(response.status) && location !== null) {
                await response.body?.cancel().catch(() => undefined);
                from = address;
                address = parseAddress(location, address);
                continue;
            }

            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                throw new Error(`upstream answered ${response.status}`);
            }

            const contentType = response.headers.get('content-type');
            const ext = extensionFor(contentType);
            if (ext === undefined) {
                await response.body?.cancel().catch(() => undefined);
                throw new Error(`not an image: ${contentType ?? 'no content type'}`);
            }

            return { body: await this.readCapped(response), ext, contentType: contentType!.split(';')[0]!.trim().toLowerCase() };
        }

        throw new Error(`upstream redirected more than ${MAX_REDIRECTS} times`);
    }

    /**
     * Refuse a hop whose name reaches this machine or the network it is on, unless it is a server the
     * operator configured.
     *
     * By `host` (name and port) against the operator's list, so a Navidrome at `nas.lan:4533` does
     * not vouch for `nas.lan:8000`. A name that does not resolve fails closed: the fetch behind it
     * would fail on the same lookup, and "could not resolve" must not read as "resolved to nothing
     * private".
     */
    private async refusePrivate(address: URL, from?: URL): Promise<void> {
        this.trusted ??= this.operatorHosts.list().catch(error => {
            // Not kept: one failed read should cost this URL, not every URL left in the sweep.
            this.trusted = undefined;
            throw error;
        });
        if ((await this.trusted).has(address.host.toLowerCase())) return;

        let behind: string | undefined;
        try {
            behind = await privateAddressBehind(address.hostname, this.options.resolveAddresses);
        } catch (error) {
            throw new Error(`${address.hostname} could not be resolved (${errorText(error)})`, { cause: error });
        }
        if (behind === undefined) return;

        const redirected = from === undefined ? '' : ` (redirected there by ${from.hostname})`;
        this.logger.warn('refused to fetch art from a private address', {
            hostname: address.hostname,
            address: behind,
            ...(from === undefined ? {} : { from: from.hostname }),
        });
        throw new Error(`${address.hostname} reaches the private address ${behind}${redirected}, and is not a server the operator configured`);
    }

    /** The body, refusing anything over {@link MAX_BYTES} as it arrives rather than after it lands. */
    private async readCapped(response: Response): Promise<Buffer> {
        if (response.body === null) throw new Error('upstream sent no body');

        const chunks: Buffer[] = [];
        let total = 0;

        for await (const chunk of response.body) {
            const buffer = Buffer.from(chunk as Uint8Array);
            total += buffer.byteLength;
            if (total > MAX_BYTES) {
                await response.body.cancel().catch(() => undefined);
                throw new Error(`image is larger than ${MAX_BYTES} bytes`);
            }
            chunks.push(buffer);
        }

        if (total === 0) throw new Error('upstream sent an empty body');

        return Buffer.concat(chunks);
    }
}
