import { Injectable } from 'injectkit';
import { Redis } from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { httpError } from '@maroonedsoftware/errors';

/**
 * How many messages one address may be asked for, and how often.
 *
 * `/auth/login/start` takes no session and sends mail to whatever address it is handed, so without
 * a bound on it anybody who knows an operator's address can fill their inbox from a shell loop —
 * and every request that lands costs the station an SMTP connection with a ten-second budget on it.
 * The global per-caller limiter in `setup.middleware.ts` does not answer this: it is 100 requests
 * per 5 seconds keyed on the CALLER, which is generous enough to sustain a steady drip, and a
 * distributed caller sidesteps it entirely while the victim is a single fixed address.
 *
 * Enrolment (`POST /auth/factors/register` for an email factor) shares the bucket, and having a
 * session does not exempt it: the caller is known there, but the ADDRESS is still whatever was
 * typed, so an operator can aim the station's mail at a stranger just as easily.
 *
 * Five in thirty seconds, then five minutes off, matching the password limiter beside it. Enough
 * for somebody pressing "send it again" because the first did not arrive, and not enough to be
 * worth aiming at anybody.
 */
const POINTS = 5;
const DURATION_SECONDS = 30;
const BLOCK_SECONDS = 300;

/**
 * The bound on how often one email address can be made to receive a message from the station.
 *
 * Keyed on the ADDRESS rather than on the caller, which is the whole point: the caller is whoever
 * is asking and may be a different one each time, while the address is the thing being harmed.
 * Normalised the same way the factor lookup normalises it, so `Someone@Example.com ` and
 * `someone@example.com` share a bucket rather than being two.
 *
 * Consumed BEFORE the factor is looked up, so a known and an unknown address cost the same number
 * of points — a limiter that only counted real addresses would answer "is this a real account"
 * through its own 429, which is the enumeration oracle the synthetic challenge id exists to close.
 */
@Injectable()
export class SignInMailLimiter {
    private readonly limiter: RateLimiterRedis;

    constructor(redis: Redis) {
        this.limiter = new RateLimiterRedis({
            storeClient: redis,
            keyPrefix: 'signin-mail',
            points: POINTS,
            duration: DURATION_SECONDS,
            blockDuration: BLOCK_SECONDS,
        });
    }

    /**
     * Spend one of this address's allowance.
     *
     * @throws {HttpError} 429 when the address has had enough for now.
     */
    async consume(email: string): Promise<void> {
        try {
            await this.limiter.consume(email.trim().toLowerCase());
        } catch {
            // Every rejection here is treated as "too many", including a Redis outage, which is the
            // opposite of the fail-open choice `rateLimitMiddleware` makes and is deliberate: that
            // one gates the whole API and failing closed would take the station down, while this
            // one gates a single endpoint whose failure mode is somebody else's mailbox.
            throw httpError(429).withDetails({ email: 'Too many verification emails have been requested for that address. Try again shortly.' });
        }
    }
}
