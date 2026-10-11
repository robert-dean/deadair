import { Injectable } from 'injectkit';
import { Redis } from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { httpError } from '@maroonedsoftware/errors';

/** Joins one address may make in {@link WINDOW_SECONDS}: a phone that reloads, a few guests on one wifi. */
export const PARTY_JOINS_PER_ADDRESS = 20;
const WINDOW_SECONDS = 600;

/**
 * The bound on how often one address may join a party.
 *
 * Every join creates an actor, so the route that mints guests is the one place a script could fill the
 * actors table. The pass's own guest cap bounds a party; this bounds a caller. Keyed on the caller's
 * address as the rate limiter resolves it (`clientAddress`), so a station behind a tunnel that has not
 * set `REAL_IP_FROM` sees every guest as one address, which the per-address figure is generous enough
 * to live with for a room. A Redis fault reads as a refusal, as `SignInMailLimiter` makes it: this
 * gates one endpoint, not the API.
 */
@Injectable()
export class PartyJoinLimiter {
    private readonly limiter: RateLimiterRedis;

    constructor(redis: Redis) {
        this.limiter = new RateLimiterRedis({
            storeClient: redis,
            keyPrefix: 'party-join',
            points: PARTY_JOINS_PER_ADDRESS,
            duration: WINDOW_SECONDS,
        });
    }

    /** @throws {HttpError} 429 when this address has joined enough for now. */
    async consume(address: string): Promise<void> {
        try {
            await this.limiter.consume(address);
        } catch {
            throw httpError(429).withDetails({ message: 'Too many joins from this address. Try again in a few minutes.' });
        }
    }
}
