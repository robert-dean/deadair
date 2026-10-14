import { DateTime } from 'luxon';
import { Injectable } from 'injectkit';
import { signRequestBody } from '@maroonedsoftware/servercore';
import { causeText } from '#modules/shared/error.text.js';
import type { EventEnvelope } from './event.envelope.js';

/**
 * How long a destination has to answer, from connecting to its status line.
 *
 * Short on purpose. What sits at the other end is a home automation hub or a workflow tool on the
 * LAN, which answers in milliseconds or is down; nothing here is a slow upload. The job that calls
 * this retries, so a receiver that was briefly busy is asked again rather than waited on.
 */
export const WEBHOOK_TIMEOUT_MS = 5_000;

/**
 * The headers a delivery carries. They name the TRANSPORT, which is a webhook, rather than the
 * feature, and carry no vendor's prefix.
 */
export const WEBHOOK_HEADERS = {
    id: 'Deadair-Webhook-Id',
    timestamp: 'Deadair-Webhook-Timestamp',
    signature: 'Deadair-Webhook-Signature',
} as const;

/**
 * Ahead of the hex HMAC, so the scheme can change later without a receiver mistaking one form for
 * another. A ServerKit receiver passes the same value as `SignatureOptions.prefix`.
 */
export const WEBHOOK_SIGNATURE_PREFIX = 'v1=';

/** Who the station says it is, as `PodcastFetchService` does, so a receiver's log names the caller. */
const USER_AGENT = 'deadair/1.0 (+https://deadair.radio)';

/** The 4xx answers that mean "not now" rather than "never". Every 5xx means "not now" too. */
const RETRYABLE_CLIENT_STATUSES = new Set([408, 429]);

/**
 * Why an address cannot be a destination, or nothing when it can.
 *
 * Deliberately NOT a private-address check. The address is an instruction from somebody holding
 * `platform.manage`, the standing `fromConfig` hosts already have, and the receiver this exists for
 * (a home automation hub) lives on the LAN. What keeps a public address from steering the station
 * onto the LAN is that redirects are never followed; see {@link WebhookSender.send}.
 *
 * Credentials in the URL are refused because they would be written into every delivery log line
 * that names the address; a receiver that wants a token takes it in the path or the query.
 */
export function webhookUrlProblem(address: string): string | undefined {
    let url: URL;
    try {
        url = new URL(address);
    } catch {
        return 'is not a web address';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        return `uses ${url.protocol.replace(/:$/, '')}, and only http and https can receive events`;
    if (url.username !== '' || url.password !== '') return 'carries a username or password; put a token in the path or the query instead';
    return undefined;
}

/** Whether a status means the receiver may take it if asked again. */
export const retryableStatus = (status: number): boolean => status >= 500 || RETRYABLE_CLIENT_STATUSES.has(status);

/**
 * How the sender reaches the network and reads the clock, which a test replaces.
 *
 * A class rather than constructor defaults so injectkit can register it, as `PodcastFetchOptions` is.
 */
export class WebhookSenderOptions {
    constructor(
        readonly fetch: typeof globalThis.fetch = globalThis.fetch,
        readonly now: () => DateTime = () => DateTime.now(),
        readonly timeoutMs: number = WEBHOOK_TIMEOUT_MS,
    ) {}
}

/** Where one webhook goes and what it is signed with. */
export interface WebhookTarget {
    url: string;
    secret: string;
}

/**
 * What one attempt came to.
 *
 * `error` is the station's own sentence, never the receiver's response body: a body is somebody
 * else's text, and this is shown in the console and kept in the delivery log.
 */
export type WebhookDelivery =
    | { outcome: 'delivered'; httpStatus: number; durationMs: number }
    | { outcome: 'failed'; retryable: boolean; httpStatus?: number; durationMs: number; error: string };

/**
 * Sends one event to one webhook, once.
 *
 * ## One attempt, and the caller decides about the next
 *
 * Retrying belongs to the job that calls this, because only it knows how long the event stays true.
 * So this never throws for anything the receiver did: every answer is an outcome, and `retryable`
 * says which of them are worth asking again.
 *
 * ## Signed with the scheme a ServerKit receiver verifies
 *
 * `signRequestBody` signs `"<unix seconds>.<body>"` and the seconds travel in their own header, which
 * gives a receiver a replay window. The body is serialized ONCE and those bytes are both signed and
 * sent, because re-serializing after signing is the classic way to send a signature for a body nobody
 * received.
 *
 * ## A redirect is a failure, and is never followed
 *
 * The destination is the operator's address and is allowed to be on the LAN, so following a redirect
 * would let whatever answers at a PUBLIC address point the station at any machine beside it. A
 * receiver that moved is a misconfiguration the operator fixes by saving the new address; the
 * delivery log says which status came back.
 */
@Injectable()
export class WebhookSender {
    constructor(private readonly options: WebhookSenderOptions) {}

    async send(target: WebhookTarget, envelope: EventEnvelope, signal?: AbortSignal): Promise<WebhookDelivery> {
        const problem = webhookUrlProblem(target.url);
        if (problem !== undefined) return { outcome: 'failed', retryable: false, durationMs: 0, error: `The address ${problem}.` };

        const body = JSON.stringify(envelope);
        const { signature, timestamp } = signRequestBody({
            secret: target.secret,
            body,
            timestamp: this.options.now(),
            prefix: WEBHOOK_SIGNATURE_PREFIX,
        });

        const deadline = AbortSignal.timeout(this.options.timeoutMs);
        const started = performance.now();
        let response: Response;
        try {
            response = await this.options.fetch(target.url, {
                method: 'POST',
                body,
                redirect: 'manual',
                signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': USER_AGENT,
                    [WEBHOOK_HEADERS.id]: envelope.id,
                    [WEBHOOK_HEADERS.timestamp]: timestamp!,
                    [WEBHOOK_HEADERS.signature]: signature,
                },
            });
        } catch (error) {
            const durationMs = elapsedSince(started);
            if (deadline.aborted)
                return { outcome: 'failed', retryable: true, durationMs, error: `No answer within ${this.options.timeoutMs / 1000}s.` };
            if (signal?.aborted === true)
                return { outcome: 'failed', retryable: true, durationMs, error: 'Stopped before the destination answered.' };
            return { outcome: 'failed', retryable: true, durationMs, error: `Could not reach the destination (${causeText(error)}).` };
        }

        const durationMs = elapsedSince(started);
        // Nobody reads it: what a receiver says back is its own business, and holding the socket open
        // until it finishes talking would let a chatty one cost a worker its time.
        await response.body?.cancel().catch(() => undefined);

        const httpStatus = response.status;
        if (httpStatus >= 200 && httpStatus < 300) return { outcome: 'delivered', httpStatus, durationMs };
        if (httpStatus >= 300 && httpStatus < 400) {
            return {
                outcome: 'failed',
                retryable: false,
                httpStatus,
                durationMs,
                error: `Answered with a redirect (${httpStatus}), which is not followed. Save the address it moved to.`,
            };
        }
        return { outcome: 'failed', retryable: retryableStatus(httpStatus), httpStatus, durationMs, error: `Answered ${httpStatus}.` };
    }
}

const elapsedSince = (started: number): number => Math.round(performance.now() - started);
