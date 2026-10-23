/**
 * A memory of recent answers: each one kept for a while, and the oldest let go once there are enough.
 *
 * Three services remember what an upstream said this way (who sounds like whom, what a web search
 * found, what a provider carries for a listener's request), each with a `Map`, a timestamp per entry
 * and the same eviction written out by hand.
 *
 * Insertion-ordered eviction rather than least-recently-used, which would need a touch on every read.
 * Writing a key again moves it to the newest end, so a refreshed answer is not the next one evicted.
 * At the sizes these hold the difference cannot matter: the bound is there to stop a station that has
 * been up for a month holding every question it ever asked.
 *
 * An expired entry is not answered but is not removed on read either; the next write or the bound
 * takes it. {@link values} sees every entry still held, fresh or not, for a reader that only wants to
 * name something a recent answer mentioned.
 */
export class BoundedTtlMap<V> {
    private readonly entries = new Map<string, { at: number; value: V }>();

    /**
     * @param ttlMs - How long an answer is given back after it was kept.
     * @param max - How many answers are held at once.
     */
    constructor(
        private readonly ttlMs: number,
        private readonly max: number,
    ) {}

    /** The answer kept under `key` while it is fresh, or `undefined` once it is older than the TTL or was never kept. */
    get(key: string, now = Date.now()): V | undefined {
        const entry = this.entries.get(key);
        return entry !== undefined && now - entry.at < this.ttlMs ? entry.value : undefined;
    }

    /** Keep an answer as the newest, letting the oldest go if the map is full. */
    set(key: string, value: V, now = Date.now()): void {
        this.entries.delete(key);
        if (this.entries.size >= this.max) {
            const oldest = this.entries.keys().next();
            if (oldest.done !== true) this.entries.delete(oldest.value);
        }
        this.entries.set(key, { at: now, value });
    }

    /** Every answer still held, oldest first, whether or not it is fresh. */
    *values(): IterableIterator<V> {
        for (const entry of this.entries.values()) yield entry.value;
    }

    /** Forget everything. */
    clear(): void {
        this.entries.clear();
    }
}
