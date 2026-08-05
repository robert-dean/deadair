import type { RundownItem } from './rundown.js';

/**
 * Turning one rundown item into audio the player can fetch, as one DI seam.
 *
 * deadair hands the player a complete URL per item and Liquidsoap downloads it
 * ahead of air. That is what lets the station own both the running order AND the
 * transport: a skip lands at once because no audio is committed to a pipe we
 * cannot take back, and a DJ break can later be a real item in the order rather
 * than something engineered around an external player's queue.
 *
 * Declared as an abstract class so injectkit can use it as a token. Deliberately
 * kept free of any implementation's imports: the rundown depends on this file,
 * and a concrete resolver reaching into the plugin system would drag that whole
 * subsystem in behind it.
 */
export abstract class TrackResolver {
    /**
     * A complete, fetchable URL for one item, or `undefined` when this resolver
     * cannot answer for it (a source it does not own, or one not configured yet).
     *
     * The URL must carry its own authentication: Liquidsoap fetches it with no
     * headers from us.
     */
    abstract resolve(item: RundownItem): Promise<string | undefined>;
}

/**
 * Every resolver, asked in order until one claims the item.
 *
 * Deliberately not a switch on some "current source" setting. Each resolver
 * guards on the item's own `pluginId`, so the item itself decides who answers:
 * a running order still holding items from a plugin that has since been disabled
 * resolves them on the way out rather than failing everything until it drains.
 */
export class CompositeTrackResolver extends TrackResolver {
    constructor(private readonly resolvers: readonly TrackResolver[]) {
        super();
    }

    async resolve(item: RundownItem): Promise<string | undefined> {
        for (const resolver of this.resolvers) {
            const url = await resolver.resolve(item);
            if (url) return url;
        }
        return undefined;
    }
}
