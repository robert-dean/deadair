// Where the bulletin read log is kept across a restart. The decisions worth pinning are the ones a
// sorted set makes for us: a read is its score, and the window is a range delete.

import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';

import { ReadLogStore } from '../../../src/modules/director/bulletin.read.store.js';

/** The four sorted-set commands the store uses, over a plain map, with Redis's argument shapes. */
function fakeRedis() {
    const set = new Map<string, number>();
    let expiresMs: number | undefined;
    const redis = {
        zadd: async (_key: string, ...args: (number | string)[]) => {
            for (let index = 0; index < args.length; index += 2) set.set(String(args[index + 1]), Number(args[index]));
            return args.length / 2;
        },
        zrange: async () => [...set].sort((a, b) => a[1] - b[1]).flatMap(([member, score]) => [member, String(score)]),
        zremrangebyscore: async (_key: string, _min: string, max: string) => {
            const exclusive = max.startsWith('(');
            const bound = Number(exclusive ? max.slice(1) : max);
            for (const [member, score] of set) if (exclusive ? score < bound : score <= bound) set.delete(member);
            return 0;
        },
        pexpire: async (_key: string, ms: number) => {
            expiresMs = ms;
            return 1;
        },
    };
    return { redis: redis as unknown as Redis, set, expires: () => expiresMs };
}

describe('the read log store', () => {
    it('loads back what it saved, with the instant each was read', async () => {
        const { redis } = fakeRedis();
        const store = new ReadLogStore(redis);

        await store.save(['bridge reopens', 'ferry resumes'], 1_000);
        await store.save(['library opens'], 2_000);

        expect(await store.load()).toEqual(
            new Map([
                ['bridge reopens', 1_000],
                ['ferry resumes', 1_000],
                ['library opens', 2_000],
            ]),
        );
    });

    it('moves a story read again to its later instant rather than holding it twice', async () => {
        const { redis, set } = fakeRedis();
        const store = new ReadLogStore(redis);

        await store.save(['bridge reopens'], 1_000);
        await store.save(['bridge reopens'], 5_000);

        expect(set).toEqual(new Map([['bridge reopens', 5_000]]));
    });

    // Exclusive, so it drops exactly what `ReadLog.forget` drops and the two never disagree.
    it('prunes everything read before the bound and keeps what was read on it', async () => {
        const { redis } = fakeRedis();
        const store = new ReadLogStore(redis);
        await store.save(['old'], 999);
        await store.save(['edge'], 1_000);

        await store.prune(1_000);

        expect([...(await store.load()).keys()]).toEqual(['edge']);
    });

    it('expires the whole set no sooner than the longest window an operator can set', async () => {
        const { redis, expires } = fakeRedis();

        await new ReadLogStore(redis).save(['bridge reopens'], 1_000);

        expect(expires()).toBeGreaterThanOrEqual(168 * 3_600_000);
    });

    it('writes nothing for a bulletin that kept nothing', async () => {
        const { redis, expires } = fakeRedis();

        await new ReadLogStore(redis).save([], 1_000);

        expect(expires()).toBeUndefined();
    });
});
