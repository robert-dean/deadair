import type { RateLimiterAbstract, RateLimiterCompatibleAbstract, RateLimiterRes } from 'rate-limiter-flexible';

/** What a key is prefixed with when there is no request to name a caller, which is never on the sign-in path. */
export const UNKNOWN_CLIENT = 'unknown';

/**
 * The password limiter, keyed by account AND by the caller asking.
 *
 * `PasswordFactorService` consumes one point per attempt under the actor's id, and five wrong answers
 * in thirty seconds block that key for five minutes. Keyed by the account alone, that is a lockout
 * anybody can cause: five guesses from anywhere on the internet kept the operator out of their own
 * station for as long as somebody cared to keep guessing, from an address the operator never saw. So
 * every key is prefixed here with the address the request came from, and a guesser locks out only
 * themselves.
 *
 * **Read at call time, not at construction.** The address arrives through `client`, which the module
 * points at the request's `AuthorizationContext`. That is overridden per request by the authorization
 * context middleware, which runs before any route, so reading it when the limiter is CALLED is what
 * guarantees it names this request rather than whatever the scope held when the factory ran.
 *
 * The library's own base class is implemented rather than extended: its runtime getters throw, and
 * TypeScript declares them as plain properties, so an accessor overriding one does not compile.
 * Nothing checks `instanceof`; `PasswordFactorService` only calls the methods.
 *
 * The address is the one the rate limiter middleware keys on (`clientAddress` under `TRUST_PROXY`),
 * never the raw socket peer: behind the edge that peer is nginx, and keying on it would put the whole
 * internet back in one bucket, which is the account-wide lockout again with extra steps.
 */
export class PasswordRateLimiter implements RateLimiterCompatibleAbstract {
    constructor(
        private readonly limiter: RateLimiterAbstract,
        private readonly client: () => string | undefined,
    ) {}

    /** The key as stored: the caller's address, then the key the library asked about. */
    keyFor(key: string | number): string {
        const client = this.client()?.trim();
        return `${client === undefined || client.length === 0 ? UNKNOWN_CLIENT : client}:${key}`;
    }

    get keyPrefix(): string {
        return this.limiter.keyPrefix;
    }

    get blockDuration(): number {
        return this.limiter.blockDuration;
    }

    set blockDuration(value: number) {
        this.limiter.blockDuration = value;
    }

    get execEvenly(): boolean {
        return this.limiter.execEvenly;
    }

    set execEvenly(value: boolean) {
        this.limiter.execEvenly = value;
    }

    consume(key: string | number, points?: number, options?: { [key: string]: unknown }): Promise<RateLimiterRes> {
        return this.limiter.consume(this.keyFor(key), points, options);
    }

    penalty(key: string | number, points?: number, options?: { [key: string]: unknown }): Promise<RateLimiterRes> {
        return this.limiter.penalty(this.keyFor(key), points, options);
    }

    reward(key: string | number, points?: number, options?: { [key: string]: unknown }): Promise<RateLimiterRes> {
        return this.limiter.reward(this.keyFor(key), points, options);
    }

    get(key: string | number, options?: { [key: string]: unknown }): Promise<RateLimiterRes | null> {
        return this.limiter.get(this.keyFor(key), options);
    }

    set(key: string | number, points: number, secDuration: number, options?: { [key: string]: unknown }): Promise<RateLimiterRes> {
        return this.limiter.set(this.keyFor(key), points, secDuration, options);
    }

    block(key: string | number, secDuration: number, options?: { [key: string]: unknown }): Promise<RateLimiterRes> {
        return this.limiter.block(this.keyFor(key), secDuration, options);
    }

    delete(key: string | number, options?: { [key: string]: unknown }): Promise<boolean> {
        return this.limiter.delete(this.keyFor(key), options);
    }
}
