import { SdkError } from '@deadair/sdk';

/**
 * Why the station could not be asked, or refused what it was asked, in the words a key has room for.
 *
 * Each one is fixed differently, which is the whole reason they are told apart: an address is checked,
 * a key is reissued, a read-only key is swapped for one that can act, and a busy address waits.
 */
export type Failure = 'unconfigured' | 'unreachable' | 'unauthorised' | 'forbidden' | 'rateLimited' | 'conflict' | 'failed';

/** Thrown for a command asked of a plugin that has no station to ask it of. */
export class NotConfigured extends Error {
    constructor() {
        super('No station is set up');
        this.name = 'NotConfigured';
    }
}

/**
 * What `fetch` rejects with when the connection could not be made. The console's list is the
 * browsers' spellings; Node says `fetch failed`, with the socket's own error as its cause.
 */
const NETWORK_FAILURE = /fetch failed|failed to fetch|networkerror|load failed|network request failed/i;

/**
 * Which failure an error is.
 *
 * The line between "the station said no" and "the station is not there" is the console's
 * (`apps/web/src/api/api.status.ts`): a 502, 503 or 504 is a proxy reporting nothing behind it, which
 * is what the station's edge answers while the API restarts, and a request that never became a
 * response at all is the same. A plain 500 is the station running and throwing, so it is not
 * connectivity. A request that hit the client's own deadline is a station that did not answer.
 */
export function classify(error: unknown): Failure {
    if (error instanceof NotConfigured) return 'unconfigured';
    if (error instanceof SdkError) {
        if (error.status === 401) return 'unauthorised';
        if (error.status === 403) return 'forbidden';
        if (error.status === 409) return 'conflict';
        if (error.status === 429) return 'rateLimited';
        return error.status >= 502 ? 'unreachable' : 'failed';
    }
    if (error instanceof Error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'unreachable';
        if (NETWORK_FAILURE.test(error.message)) return 'unreachable';
    }
    return 'failed';
}

/**
 * How long the station asked to be left alone, from a 429's `retry-after`, in milliseconds.
 *
 * Only the seconds form, which is the one the station's rate limiter sends. `undefined` for anything
 * else, so the caller falls back to its own backoff rather than trusting a date it has to parse.
 */
export function retryAfterMs(error: unknown): number | undefined {
    if (!(error instanceof SdkError) || error.status !== 429) return undefined;
    const seconds = Number(error.headers.get('retry-after'));
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

/** A failure as the key shows it (a word or two) and as a log line or the settings say it. */
export interface FailureWords {
    title: string;
    sentence: string;
}

const WORDS: Record<Failure, FailureWords> = {
    unconfigured: {
        title: 'Set up',
        sentence: "No station yet. Open this key's settings and enter the station's address and an API key.",
    },
    unreachable: {
        title: 'No station',
        sentence: 'The station did not answer. Check the address, and that the station is running.',
    },
    unauthorised: {
        title: 'Key refused',
        sentence: 'The station refused the API key. It may have been mistyped, revoked or left to expire.',
    },
    forbidden: {
        title: 'Not allowed',
        sentence: 'The station would not let this key do that. Skip and Stop need a key with Read and manage, issued by an admin.',
    },
    rateLimited: {
        title: 'Busy',
        sentence: 'The station asked for fewer requests. Something else at this address may be asking it a lot.',
    },
    conflict: {
        title: 'Refused',
        sentence: 'The station refused, because the request no longer matches what it is doing.',
    },
    failed: {
        title: 'Error',
        sentence: 'The station answered with an error. Its activity feed in the console says more.',
    },
};

export function describe(failure: Failure): FailureWords {
    return WORDS[failure];
}
