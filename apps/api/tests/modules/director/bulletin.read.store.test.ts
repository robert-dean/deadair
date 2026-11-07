// Where the bulletin read log is kept across a restart. The decisions worth pinning are the ones a
// sorted set makes for us: a read is its score, and the window is a range delete.

import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';

import { ReadLogStore } from '../../../src/modules/director/bulletin.read.store.js';
import type { StorySignature } from '../../../src/modules/director/story.signature.js';

/** The four sorted-set commands the store uses, over plain maps (one per key), with Redis's argument shapes. */
function fakeRedis() {
    const sets = new Map<string, Map<string, number>>();
    const of = (key: string): Map<string, number> => {
        if (!sets.has(key)) sets.set(key, new Map());
        return sets.get(key) as Map<string, number>;
    };
    const expiry = new Map<string, number>();
    const redis = {
        zadd: async (key: string, ...args: (number | string)[]) => {
            for (let index = 0; index < args.length; index += 2) of(key).set(String(args[index + 1]), Number(args[index]));
            return args.length / 2;
        },
        zrange: async (key: string) => [...of(key)].sort((a, b) => a[1] - b[1]).flatMap(([member, score]) => [member, String(score)]),
        zremrangebyscore: async (key: string, _min: string, max: string) => {
            const exclusive = max.startsWith('(');
            const bound = Number(exclusive ? max.slice(1) : max);
            for (const [member, score] of of(key)) if (exclusive ? score < bound : score <= bound) of(key).delete(member);
            return 0;
        },
        pexpire: async (key: string, ms: number) => {
            expiry.set(key, ms);
            return 1;
        },
    };
    return { redis: redis as unknown as Redis, set: of('bulletin-read'), about: of('bulletin-read-about'), expiry };
}

const keys = (...headlines: string[]) => headlines.map(key => ({ key }));

const SIGNATURE: StorySignature = { tokens: ['cornell', 'faculty', 'vote'], names: ['cornell'], ids: [] };

describe('the read log store', () => {
    it('loads back what it saved, with the instant each was read', async () => {
        const { redis } = fakeRedis();
        const store = new ReadLogStore(redis);

        await store.save(keys('bridge reopens', 'ferry resumes'), 1_000);
        await store.save(keys('library opens'), 2_000);

        expect((await store.load()).read).toEqual(
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

        await store.save(keys('bridge reopens'), 1_000);
        await store.save(keys('bridge reopens'), 5_000);

        expect(set).toEqual(new Map([['bridge reopens', 5_000]]));
    });

    // Exclusive, so it drops exactly what `ReadLog.forget` drops and the two never disagree.
    it('prunes everything read before the bound and keeps what was read on it', async () => {
        const { redis } = fakeRedis();
        const store = new ReadLogStore(redis);
        await store.save([{ key: 'old', signature: SIGNATURE }], 999);
        await store.save([{ key: 'edge', signature: SIGNATURE }], 1_000);

        await store.prune(1_000);

        const loaded = await store.load();
        expect([...loaded.read.keys()]).toEqual(['edge']);
        expect([...loaded.about.keys()]).toEqual(['edge']);
    });

    it('expires the whole set no sooner than the longest window an operator can set', async () => {
        const { redis, expiry } = fakeRedis();

        await new ReadLogStore(redis).save([{ key: 'bridge reopens', signature: SIGNATURE }], 1_000);

        expect(expiry.get('bulletin-read')).toBeGreaterThanOrEqual(168 * 3_600_000);
        expect(expiry.get('bulletin-read-about')).toBeGreaterThanOrEqual(168 * 3_600_000);
    });

    it('writes nothing for a bulletin that kept nothing', async () => {
        const { redis, expiry } = fakeRedis();

        await new ReadLogStore(redis).save([], 1_000);

        expect(expiry.size).toBe(0);
    });

    // A second set rather than a richer member in the first, so the first answers what it always did.
    it('keeps what a story was about beside its key, and leaves the first set as it was', async () => {
        const { redis, set } = fakeRedis();
        const store = new ReadLogStore(redis);

        await store.save([{ key: 'cornell faculty vote', signature: SIGNATURE }, { key: 'bridge reopens' }], 1_000);

        expect(set).toEqual(
            new Map([
                ['cornell faculty vote', 1_000],
                ['bridge reopens', 1_000],
            ]),
        );
        expect((await store.load()).about).toEqual(new Map([['cornell faculty vote', SIGNATURE]]));
    });

    it('answers what a story read twice was about the second time', async () => {
        const { redis } = fakeRedis();
        const store = new ReadLogStore(redis);
        const later: StorySignature = { ...SIGNATURE, tokens: [...SIGNATURE.tokens, 'resolution'] };

        await store.save([{ key: 'cornell faculty vote', signature: SIGNATURE }], 1_000);
        await store.save([{ key: 'cornell faculty vote', signature: later }], 2_000);

        expect((await store.load()).about.get('cornell faculty vote')).toEqual(later);
    });

    it('skips a member it cannot read rather than failing the load', async () => {
        const { redis, about } = fakeRedis();
        const store = new ReadLogStore(redis);
        await store.save([{ key: 'cornell faculty vote', signature: SIGNATURE }], 1_000);
        about.set('not json', 1_500);
        about.set(JSON.stringify(['half', { tokens: ['a'] }]), 1_600);

        expect([...(await store.load()).about.keys()]).toEqual(['cornell faculty vote']);
    });
});
