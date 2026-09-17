import type { CatalogClient, Rating } from '@deadair/sdk';

import { NotConfigured } from './connection.failure.js';

/** The part of the station's SDK the vote keys use: what the station thinks of a record, and saying so. */
export type Catalog = Pick<CatalogClient, 'getTrack' | 'rateTrack'>;

export interface RatingStoreOptions {
    /** The catalog of the station in use, or none while no station is set up. Read on every call, because the station changes under it. */
    catalog: () => Catalog | undefined;
    /** How many records are remembered, which is a few either way of the one on air. */
    capacity?: number;
}

/**
 * What the station thinks of the records it is playing, asked once each.
 *
 * The transport reading the keys already share says which record is on air but not what the station
 * thinks of it, so the opinion is read separately — once when the record changes, never on a poll.
 * That is the cover's arrangement in `display/artwork.ts` and it is here for the cover's reason: a
 * key redraws every couple of seconds and the answer changes once a record.
 *
 * The cost of reading it this way rather than carrying it on the status is that a rating changed in
 * the console is not seen here until the record changes. The alternative was `rating` on
 * `PlayoutItem`, which would put a catalog lookup on a route every console and every deck polls
 * every two seconds; `apps/streamdeck/CLAUDE.md` records the choice.
 *
 * A record that could not be asked about is remembered as such, for the reason a 404 cover is: one
 * request per record whatever the answer. A Read-only key is refused the write and not the read, so
 * the usual shape of this is a key that lights correctly and says why it cannot be pressed.
 */
export class RatingStore {
    private readonly known = new Map<string, Rating | undefined>();
    private readonly pending = new Map<string, Promise<Rating | undefined>>();
    private readonly listeners = new Set<() => void>();
    private readonly catalog: () => Catalog | undefined;
    private readonly capacity: number;

    constructor(options: RatingStoreOptions) {
        this.catalog = options.catalog;
        this.capacity = options.capacity ?? 8;
    }

    /**
     * Hear about an opinion changing. Returns the way to stop hearing about it.
     *
     * A record has two keys on the deck and they are two actions, each drawn by its own instance: a
     * press on Like has to take the light off Dislike, and neither can see the other. Both hear this
     * instead, so the pair is never a second apart.
     */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * What is known about a record without asking.
     *
     * Absent means it has never been asked about. `{ rating: undefined }` means it was, and the
     * station did not answer with one: a record the catalog has never ingested, or a read that
     * failed. The two are one state here because a key does the same thing with both, and keeping
     * them apart would mean asking a failing station again on every redraw.
     */
    peek(trackId: string): { rating: Rating | undefined } | undefined {
        return this.known.has(trackId) ? { rating: this.known.get(trackId) } : undefined;
    }

    /** The station's opinion, asked the first time and shared between everybody who asks meanwhile. */
    async load(trackId: string): Promise<Rating | undefined> {
        const held = this.peek(trackId);
        if (held) return held.rating;
        const inFlight = this.pending.get(trackId);
        if (inFlight) return inFlight;

        const catalog = this.catalog();
        // Nothing is remembered without a station to have asked: the next reading with one set up
        // should ask rather than draw this moment's silence for as long as the record plays.
        if (catalog === undefined) return undefined;

        const request = this.read(catalog, trackId).then(rating => {
            this.pending.delete(trackId);
            this.remember(trackId, rating);
            return rating;
        });
        this.pending.set(trackId, request);
        return request;
    }

    /**
     * Rate a record, and remember the answer.
     *
     * The station answers a write with the record as it now stands, so the key lights from the write
     * itself and asks nothing more. A refusal is thrown to the key that pressed, for it to say so:
     * a key that may not write is not a key that may not read, and the remembered rating is still
     * true.
     */
    async rate(trackId: string, rating: Rating): Promise<Rating> {
        const catalog = this.catalog();
        if (catalog === undefined) throw new NotConfigured();
        const track = await catalog.rateTrack(trackId, { rating });
        const written = track.rating ?? 'neutral';
        this.remember(trackId, written);
        return written;
    }

    /** Forget everything. The ids belong to the station that answered them, and another station's are not the same records. */
    reset(): void {
        this.known.clear();
        this.pending.clear();
        for (const listener of this.listeners) listener();
    }

    /**
     * A record with no `rating` on it is `neutral` and not unknown: the contract defaults the field,
     * so an answer that leaves it out is the station saying it has no opinion. `undefined` here means
     * the station did not answer at all, which is the only thing a key draws differently.
     */
    private async read(catalog: Catalog, trackId: string): Promise<Rating | undefined> {
        try {
            return (await catalog.getTrack(trackId)).rating ?? 'neutral';
        } catch {
            return undefined;
        }
    }

    private remember(trackId: string, rating: Rating | undefined): void {
        const changed = !this.known.has(trackId) || this.known.get(trackId) !== rating;
        this.known.delete(trackId);
        this.known.set(trackId, rating);
        while (this.known.size > this.capacity) {
            const oldest = this.known.keys().next().value;
            if (oldest === undefined) break;
            this.known.delete(oldest);
        }
        if (changed) for (const listener of this.listeners) listener();
    }
}
