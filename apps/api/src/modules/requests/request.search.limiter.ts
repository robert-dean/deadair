import { Injectable } from 'injectkit';
import { Redis } from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';

/**
 * How many request searches one account may send on to the providers, and in how long.
 *
 * A searched term the providers were not already asked about in the last minute costs one point. A
 * listener app debounces its search box, so a person sends one term each time their typing settles:
 * a dozen while they hunt for one record is a lot. Twenty a minute is room for that twice over.
 */
export const REQUEST_PROVIDER_POINTS_PER_CALLER = 20;

/**
 * How many the whole station may send on, whoever is asking, in the same window.
 *
 * The per-account budget alone does not bound the providers: six accounts get six budgets. This is
 * two a second, a fifth of what one plugin's outbound fetches are allowed (`PLUGIN_FETCH_REQUESTS_PER_WINDOW`),
 * so listeners searching can never crowd out the director's own provider calls or trip the invoker's
 * quarantine for everybody.
 */
export const REQUEST_PROVIDER_POINTS_PER_STATION = 120;

const WINDOW_SECONDS = 60;

/**
 * The bound on how often a listener's request search may reach the music providers.
 *
 * The global per-caller limiter in `setup.middleware.ts` does not answer this. It allows 100 requests
 * per 5 seconds per address, and every one of those carrying a fresh term misses the one-minute cache
 * in `RequestProviderSearch` and asks every provider in turn, each with its own timeout, each a step
 * toward the invoker quarantining that provider for the whole station. One script with one account
 * could keep the station's providers quarantined.
 *
 * Keyed on the ACCOUNT, not the address: the search needs a signed-in caller, and an API key or a
 * connected app acts as the account that made it, so every key one person holds shares one budget.
 *
 * A refusal is not a 429. The search still answers, with the library alone, which is what a person
 * typing too fast would rather have than an error, and what a script gets nothing out of. A Redis
 * fault reads as a refusal too, the opposite of `rateLimitMiddleware`'s fail-open choice and for the
 * same reason `SignInMailLimiter` makes it: that one gates the whole API, this one gates an extra.
 */
@Injectable()
export class RequestSearchLimiter {
    private readonly perCaller: RateLimiterRedis;
    private readonly perStation: RateLimiterRedis;

    constructor(redis: Redis) {
        this.perCaller = new RateLimiterRedis({
            storeClient: redis,
            keyPrefix: 'request-provider-search',
            points: REQUEST_PROVIDER_POINTS_PER_CALLER,
            duration: WINDOW_SECONDS,
        });
        this.perStation = new RateLimiterRedis({
            storeClient: redis,
            keyPrefix: 'request-provider-search-station',
            points: REQUEST_PROVIDER_POINTS_PER_STATION,
            duration: WINDOW_SECONDS,
        });
    }

    /**
     * Spend one of `callerKey`'s allowance and one of the station's, and say whether both had one.
     *
     * The account's first, so a caller already over their own budget spends none of the station's.
     */
    async allows(callerKey: string): Promise<boolean> {
        try {
            await this.perCaller.consume(callerKey);
            await this.perStation.consume('station');
            return true;
        } catch {
            return false;
        }
    }
}
