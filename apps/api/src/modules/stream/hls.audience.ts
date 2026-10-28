import { Injectable } from 'injectkit';

/**
 * Who is listening over HLS, counted from the only evidence there is.
 *
 * Icecast knows its own listeners because it holds each one's connection open, and
 * `IcecastStatsClient` simply asks it. HLS has no connection to hold: a player
 * fetches a playlist, then some segments, then the playlist again, and every one of
 * those is a request that ends. Nothing on the server side is in a position to be
 * asked how many people are there.
 *
 * What makes them countable anyway is that a LIVE playlist has to be re-fetched. A
 * player cannot learn about the next segment any other way, so it comes back every
 * target duration for as long as somebody is listening, and stops the moment they
 * are not. So a playlist request is a heartbeat that arrives on its own, and this
 * class is the register of who has ticked recently.
 *
 * **This is not the access-log counting that `AudienceWatch` refuses.** The
 * distinction is that a log is a record of what happened and this is a reading of
 * what is true now: an entry is present because a request arrived inside the window,
 * and absent because one did not. Zero here means nobody is listening, not "we could
 * not tell" — which is the property the audience gate is built on and the reason the
 * gate may act on this number at all.
 *
 * It is deliberately not persisted. A restart forgets every listener, and they are
 * all back within one segment duration because their players keep asking.
 */

/**
 * How long one tick counts for.
 *
 * A player fetches the media playlist about once per segment, so this has to cover
 * several segments to survive an ordinary late one, and must not be so long that a
 * listener who has closed their player holds the station on air. Fifteen seconds is
 * roughly three segments at the two-second default plus slack for a slow fetch.
 *
 * The five-minute linger in `AudienceWatch` sits on TOP of this and is a different
 * question — this one is "is that player still asking", and that one is "should the
 * station keep the mount up for somebody who might come back". Conflating them would
 * make an HLS listener's departure take five minutes to notice, or an Icecast
 * listener's take fifteen seconds.
 */
export const HLS_PRESENCE_MS = 15_000;

/**
 * One HLS player, as far as an anonymous GET can say: who the edge says asked, and what
 * they said they were. Built by the heartbeat middleware, which is the only thing that
 * has the request.
 */
export interface HlsClient {
    /** The address the edge reported. A listener's own only when the edge is trusted to say so. */
    address: string;
    /** What the player said it was. Absent when it sent nothing. */
    agent?: string;
}

/** A player being counted right now, and since when. */
export interface HlsPresence extends HlsClient {
    /** Epoch milliseconds of the first tick of this stretch of listening. */
    firstSeenAt: number;
    /** Epoch milliseconds of the latest tick. */
    lastSeenAt: number;
}

/**
 * The register's key for a client.
 *
 * Address plus agent, in the form the heartbeat middleware has always built: the address
 * alone would collapse a household behind one NAT into one listener, and the agent alone
 * would collapse everyone using the same player. Two identical phones on one network are
 * still one entry, which is the undercount `seen` documents.
 */
export const hlsClientKey = (client: HlsClient): string => `${client.address} ${client.agent ?? ''}`;

@Injectable()
export class HlsAudience {
    /** Client key to who it is and when it was heard from. */
    private readonly seenAt = new Map<string, HlsPresence>();
    /** Told when the count changes, so the gate moves on arrival rather than on the next poll. */
    private readonly listeners = new Set<() => void>();

    /**
     * Note that a client has just asked for a playlist.
     *
     * Two listeners behind one NAT with the same player count as one (see
     * {@link hlsClientKey}). That is a known undercount and the acceptable direction to
     * be wrong in: it can only ever make the station think fewer people are listening
     * than are, and the gate opens on one.
     *
     * A client that had already lapsed starts a new stretch rather than resuming the old
     * one, even if the prune has not got to it yet: somebody who stopped and came back
     * ten minutes later has been listening for as long as they have been back.
     */
    seen(client: HlsClient): void {
        const before = this.count();
        const now = Date.now();
        const key = hlsClientKey(client);
        const earlier = this.seenAt.get(key);
        const firstSeenAt = earlier && earlier.lastSeenAt >= now - HLS_PRESENCE_MS ? earlier.firstSeenAt : now;

        this.seenAt.set(key, { address: client.address, ...(client.agent ? { agent: client.agent } : {}), firstSeenAt, lastSeenAt: now });
        if (this.count() !== before) this.announce();
    }

    /**
     * Whether this client is being counted right now.
     *
     * What lets a listener cap turn away a NEW client without turning away one already listening:
     * a player that is counted keeps asking for the playlist, and every one of those asks has to be
     * served or the listener is dropped mid-programme by a cap they were inside.
     */
    has(client: HlsClient): boolean {
        const presence = this.seenAt.get(hlsClientKey(client));
        return presence !== undefined && presence.lastSeenAt >= Date.now() - HLS_PRESENCE_MS;
    }

    /**
     * How many HLS listeners there are right now.
     *
     * Prunes as it counts rather than on a timer, because there is no loop here to hang
     * one on and the map only grows while somebody is listening. A station nobody has
     * ever streamed over HLS does no work at all.
     */
    count(): number {
        this.prune();
        return this.seenAt.size;
    }

    /**
     * Every player being counted right now, longest-listening first.
     *
     * The same window as {@link count}, so the two cannot disagree about who is there. A
     * copy, so a caller holding it cannot edit the register. For somebody looking: like
     * the register itself it is never stored, and nothing in the station acts on it.
     */
    present(): HlsPresence[] {
        this.prune();
        return [...this.seenAt.values()].map(presence => ({ ...presence })).sort((a, b) => a.firstSeenAt - b.firstSeenAt);
    }

    /**
     * Be told when the count changes. Returns the unsubscribe.
     *
     * Arrivals only, in practice: a departure is the absence of a request, so nothing
     * happens at the moment it occurs and the next `count()` is what notices. The poll
     * in `AudienceWatch` is what makes that harmless, exactly as it is for a dropped
     * event-feed message.
     */
    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Forget everyone. For a shutdown, and for a test that wants a clean room. */
    clear(): void {
        this.seenAt.clear();
    }

    /** Drop everyone whose last tick is outside the window. */
    private prune(): void {
        const cutoff = Date.now() - HLS_PRESENCE_MS;
        for (const [key, presence] of this.seenAt) {
            if (presence.lastSeenAt < cutoff) this.seenAt.delete(key);
        }
    }

    private announce(): void {
        for (const listener of this.listeners) {
            try {
                listener();
            } catch {
                // A subscriber that throws must not cost a listener their tick. There is no
                // logger here on purpose: this class is on the path of every playlist request.
            }
        }
    }
}
