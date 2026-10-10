// The budget a listener's request search spends when it reaches the providers fresh: one account's
// and the station's, the account's first, and a refusal or a Redis fault both read as "not now".

import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { RequestSearchLimiter } from '../../../src/modules/requests/request.search.limiter.js';

/** Which bucket refuses, or throws as a Redis fault would, and every consume seen, as `prefix:key`. */
function stub(world: { refuse?: string; fault?: boolean } = {}) {
    const seen: string[] = [];
    vi.spyOn(RateLimiterRedis.prototype, 'consume').mockImplementation(async function (this: RateLimiterRedis, key: string | number) {
        seen.push(`${this.keyPrefix}:${key}`);
        if (world.fault === true) throw new Error('Stream isn\'t writeable and enableOfflineQueue options is false');
        if (this.keyPrefix === world.refuse) throw new RateLimiterRes(0, 1000);
        return new RateLimiterRes(1, 0);
    });
    return { limiter: new RequestSearchLimiter({} as never), seen };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('RequestSearchLimiter', () => {
    it("allows a search with both the account's allowance and the station's, and spends one of each", async () => {
        const { limiter, seen } = stub();

        expect(await limiter.allows('user:a-1')).toBe(true);
        expect(seen).toEqual(['request-provider-search:user:a-1', 'request-provider-search-station:station']);
    });

    it("refuses an account over its own budget without spending any of the station's", async () => {
        const { limiter, seen } = stub({ refuse: 'request-provider-search' });

        expect(await limiter.allows('user:a-1')).toBe(false);
        expect(seen).toEqual(['request-provider-search:user:a-1']);
    });

    it('refuses when the station is over its budget, whoever is asking', async () => {
        expect(await stub({ refuse: 'request-provider-search-station' }).limiter.allows('user:a-1')).toBe(false);
    });

    it('refuses when Redis cannot be reached, rather than letting every search through', async () => {
        expect(await stub({ fault: true }).limiter.allows('user:a-1')).toBe(false);
    });
});
