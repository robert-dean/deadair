import { Injectable } from 'injectkit';
import { Redis } from 'ioredis';
import type { StorySignature } from './story.signature.js';

/** One sorted set: the member is a headline as `ReadLog` keys it, the score the instant it was read. */
const KEY = 'bulletin-read';

/**
 * A second, beside it: the member is a headline's key and what the story was ABOUT, as JSON, scored
 * the same. A second set rather than a richer member in the first, so the first keeps answering
 * exactly what it always did (a release that rolls back reads it unchanged), and `prune` is still one
 * range delete per set.
 */
const ABOUT_KEY = 'bulletin-read-about';

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

    /**
     * Everything still held: each headline's key to the instant it was read, and what each was about
     * where that was kept.
     *
     * A member that does not parse is skipped rather than failing the load, since the cost of one is a
     * story that can be read again under another headline, which is what every story cost before.
     */
    async load(): Promise<{ read: Map<string, number>; about: Map<string, StorySignature> }> {
        const read = new Map<string, number>();
        for (const [member, at] of pairs(await this.redis.zrange(KEY, '0', '-1', 'WITHSCORES'))) read.set(member, at);

        // Ascending by score, so a story read twice ends on what it was about the second time.
        const about = new Map<string, StorySignature>();
        for (const [member] of pairs(await this.redis.zrange(ABOUT_KEY, '0', '-1', 'WITHSCORES'))) {
            const parsed = parseAbout(member);
            if (parsed !== undefined) about.set(parsed[0], parsed[1]);
        }
        return { read, about };
    }

    /** Record these keys as read at `at`, and what each was about where the caller knows. */
    async save(entries: readonly { key: string; signature?: StorySignature }[], at: number): Promise<void> {
        if (entries.length === 0) return;
        await this.redis.zadd(KEY, ...entries.flatMap(entry => [String(at), entry.key]));
        await this.redis.pexpire(KEY, KEEP_MS);

        const about = entries.flatMap(entry => (entry.signature === undefined ? [] : [String(at), JSON.stringify([entry.key, entry.signature])]));
        if (about.length === 0) return;
        await this.redis.zadd(ABOUT_KEY, ...about);
        await this.redis.pexpire(ABOUT_KEY, KEEP_MS);
    }

    /** Drop everything read before `before`, exclusive, matching `ReadLog.forget`. */
    async prune(before: number): Promise<void> {
        await this.redis.zremrangebyscore(KEY, '-inf', `(${before}`);
        await this.redis.zremrangebyscore(ABOUT_KEY, '-inf', `(${before}`);
    }
}

/** A `WITHSCORES` answer as member and score, leaving out any score that is not a number. */
function pairs(flat: readonly string[]): [string, number][] {
    const out: [string, number][] = [];
    for (let index = 0; index + 1 < flat.length; index += 2) {
        const at = Number(flat[index + 1]);
        if (Number.isFinite(at)) out.push([flat[index] as string, at]);
    }
    return out;
}

/** One `ABOUT_KEY` member, or nothing when it is not the shape `save` writes. */
function parseAbout(member: string): [string, StorySignature] | undefined {
    try {
        const parsed: unknown = JSON.parse(member);
        if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') return undefined;
        const signature = parsed[1] as Partial<StorySignature> | undefined;
        const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === 'string');
        if (signature === undefined || !strings(signature.tokens) || !strings(signature.names) || !strings(signature.ids)) return undefined;
        return [parsed[0], { tokens: signature.tokens, names: signature.names, ids: signature.ids }];
    } catch {
        return undefined;
    }
}
