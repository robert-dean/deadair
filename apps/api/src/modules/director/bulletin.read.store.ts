import { Injectable } from 'injectkit';
import { Redis } from 'ioredis';

/** One sorted set: the member is a headline as `ReadLog` keys it, the score the instant it was read. */
const KEY = 'bulletin-read';

/**
 * How long the set outlives its last write.
 *
 * A week, the longest window `rotation.newsMaxAgeHours` accepts, so no window an operator can set
 * reaches past it. `prune` is what keeps the set to the window actually in force; this is only so a
 * station that stops reading the news does not leave the set behind forever.
 */
const KEEP_MS = 7 * 24 * 3_600_000;

/**
 * Where {@link ReadLog} keeps what it has read, so a restart does not forget it.
 *
 * In Redis rather than a table because the question has a twelve-hour half-life and a sorted set
 * scored by time answers it with nothing to migrate and nothing to sweep: `prune` is one range
 * delete, run on the way in exactly as the log's own `forget` is. The station already holds a Redis
 * for its sessions, and the `full` image saves it under `/data/redis`, so it outlives a deploy.
 *
 * Every method may throw. `ReadLog` is what absorbs a failure, because it is the one that knows a
 * failure here costs a repeated bulletin and nothing else.
 */
@Injectable()
export class ReadLogStore {
    constructor(private readonly redis: Redis) {}

    /** Everything still held, keyed headline to the instant it was read. */
    async load(): Promise<Map<string, number>> {
        const flat = await this.redis.zrange(KEY, '0', '-1', 'WITHSCORES');
        const read = new Map<string, number>();
        for (let index = 0; index + 1 < flat.length; index += 2) {
            const at = Number(flat[index + 1]);
            if (Number.isFinite(at)) read.set(flat[index] as string, at);
        }
        return read;
    }

    /** Record these keys as read at `at`. */
    async save(keys: readonly string[], at: number): Promise<void> {
        if (keys.length === 0) return;
        await this.redis.zadd(KEY, ...keys.flatMap(key => [String(at), key]));
        await this.redis.pexpire(KEY, KEEP_MS);
    }

    /** Drop everything read before `before`, exclusive, matching `ReadLog.forget`. */
    async prune(before: number): Promise<void> {
        await this.redis.zremrangebyscore(KEY, '-inf', `(${before}`);
    }
}
