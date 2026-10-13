import { Injectable } from 'injectkit';
import { Redis } from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { httpError } from '@maroonedsoftware/errors';

/** Calls one address may make to the accept routes in {@link WINDOW_SECONDS}: a person who mistypes a few times. */
export const INVITATION_ACCEPTS_PER_ADDRESS = 30;
const WINDOW_SECONDS = 600;

/**
 * The bound on how often one address may call the three accept routes, which take no session.
 *
 * A token has 256 bits, so this is not what stops guessing one. It bounds the cost of the routes
 * themselves: the start checks a password's strength (zxcvbn and a breached-password lookup) and the
 * accept writes an account. Built as `PartyJoinLimiter` is, keyed on `clientAddress`, and a Redis
 * fault reads as a refusal for the reason that one gives.
 */
@Injectable()
export class InvitationAcceptLimiter {
    private readonly limiter: RateLimiterRedis;

    constructor(redis: Redis) {
        this.limiter = new RateLimiterRedis({
            storeClient: redis,
            keyPrefix: 'invitation-accept',
            points: INVITATION_ACCEPTS_PER_ADDRESS,
            duration: WINDOW_SECONDS,
        });
    }

    /** @throws {HttpError} 429 when this address has tried enough for now. */
    async consume(address: string): Promise<void> {
        try {
            await this.limiter.consume(address);
        } catch {
            throw httpError(429).withDetails({ message: 'Too many tries from this address. Try again in a few minutes.' });
        }
    }
}
