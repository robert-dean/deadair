import type { Container } from 'injectkit';
import type { Logger } from '@maroonedsoftware/logger';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { artPath } from './art.path.js';
import { ArtRepository } from './art.repository.js';
import { stationCover } from './art.source.token.js';

/** How long a cover the store did not hold waits before the store is asked about it again. */
export const COVER_RETRY_MS = 5_000;

/** How many resolved covers are remembered. A running order is a few dozen records; this is hours of them. */
export const COVER_MEMORY = 512;

/** What a caller needs of {@link CoverResolver}: an upstream cover in, the station's own path out, or nothing yet. */
export interface CoverLookup {
    resolve(sourceUrl: string): string | undefined;
}

/**
 * Turns a provider's cover URL into the path the station serves that cover from, once the station
 * holds it.
 *
 * **Why this exists at all.** A record is committed to the player about one item before it airs,
 * and `DirectorService.stationArtwork` resolves its cover then. A cover the store has never seen is
 * asked for on that same pass, so it normally lands while the record before it is still playing,
 * after the item was already built. The item keeps the provider's URL in `coverSourceUrl`, which
 * nothing serialises, and every reader that shows a cover to a listener asks here instead of
 * trusting what the item was built with. So the cover appears the moment the cache job lands, and
 * the provider's URL (a Subsonic one carries the operator's user and token) never leaves the server.
 * Until the cache lands, it answers the station's proxy path for the cover instead, so a listener
 * sees the sleeve straight away rather than the logo.
 *
 * **Synchronous on purpose.** Its two readers answer out of memory: `/nowplaying` is a public poll
 * that does no database work at all, and the pusher stamps a hand-over inline. So `resolve` answers
 * from what is remembered and, on a miss, starts ONE read of the store in a scope of its own and
 * answers the proxy path for now. The next read after that lookup lands gets the cached path. Only
 * hits are kept: a miss is asked again on a later read, which is what moves a cover onto its plain
 * `art/<id>` path as soon as the cache job writes it rather than leaving it on the proxy for the
 * life of the process. The retry is spaced by
 * {@link COVER_RETRY_MS} per URL so a poll from every listener during an uncached record costs one
 * query every few seconds rather than one per poll.
 *
 * A store that cannot be read answers the proxy path, and is asked again later.
 */
export class CoverResolver implements CoverLookup {
    private readonly hits = new Map<string, string>();
    private readonly askedAt = new Map<string, number>();
    private readonly inFlight = new Map<string, Promise<void>>();

    constructor(
        private readonly container: Container,
        private readonly logger: Logger,
        private readonly now: () => number = Date.now,
    ) {}

    /**
     * The station's own `art/` path for this upstream cover: the cached copy once the station holds
     * it, and until then its proxy path (`art/source/<token>/cover.jpg`), which fetches the cover on
     * first ask. Either way an `art/` path and never the upstream URL. Nothing only for something that
     * is not an upstream URL, or when no sealing key is configured.
     *
     * The proxy path carries a filename for the reason a cached cover's does: a hardware player
     * handed the mount's artwork URL fetches one ending in `.jpg` and ignores one ending in an id. The
     * name is decoration and the response's content type says what the image really is.
     */
    resolve(sourceUrl: string): string | undefined {
        const hit = this.hits.get(sourceUrl);
        if (hit !== undefined) return hit;
        if (!/^https?:\/\//i.test(sourceUrl)) return undefined;

        void this.ask(sourceUrl);
        const proxy = stationCover(sourceUrl);
        return proxy === undefined ? undefined : `${proxy}/cover.jpg`;
    }

    /**
     * Read the store for one URL now, unless a read is already running or ran too recently. Resolves
     * when that read is done, so a test (or a caller that can wait) sees its answer on the next
     * {@link resolve}.
     */
    ask(sourceUrl: string): Promise<void> {
        const running = this.inFlight.get(sourceUrl);
        if (running !== undefined) return running;

        const last = this.askedAt.get(sourceUrl);
        if (last !== undefined && this.now() - last < COVER_RETRY_MS) return Promise.resolve();
        this.remember(this.askedAt, sourceUrl, this.now());

        const read = inScope(this.container, async scope => scope.get(ArtRepository).findBySourceUrls([sourceUrl]))
            .then(held => {
                const asset = held.get(sourceUrl);
                if (asset?.checksum === undefined) return;
                this.remember(this.hits, sourceUrl, artPath(asset));
                this.askedAt.delete(sourceUrl);
            })
            .catch(error => {
                this.logger.warn(`art: could not tell whether the station holds a cover (${errorText(error)})`);
            })
            .finally(() => this.inFlight.delete(sourceUrl));

        this.inFlight.set(sourceUrl, read);
        return read;
    }

    /** Set a key, dropping the oldest once the map is full, so a station running for months holds a bounded set. */
    private remember<T>(map: Map<string, T>, key: string, value: T): void {
        map.delete(key);
        map.set(key, value);
        if (map.size > COVER_MEMORY) {
            const oldest = map.keys().next().value;
            if (oldest !== undefined) map.delete(oldest);
        }
    }
}
