/**
 * An ElevenLabs refusal, as an error the station knows what to do with.
 *
 * `plugins/rhapsode/src/rhapsode.errors.ts` for a hosted service. ElevenLabs answers a refusal with
 * `{ detail: { status, message } }`, and the `status` is a reason the HTTP code does not carry: a
 * 401 is a bad key OR an empty quota, and the station has to treat those two very differently.
 *
 * ## Why an empty quota is `forbidden`
 *
 * Because every other choice costs more than the break. `upstream` is retryable, so three of them
 * in a row quarantine a plugin whose key is fine and whose month is simply spent; `auth` sends the
 * operator to re-enter a key that is not wrong. `forbidden` is not retryable and says what it is:
 * this account may not do this right now. The message names the quota, so the operator reading the
 * plugin's status knows to buy characters rather than debug.
 */

import { PluginError, tryJsonBody, type PluginErrorCode } from '@deadair/plugin-sdk';

/**
 * What the station should do about each of ElevenLabs' reasons.
 *
 * Only the ones the text-to-speech route is documented or observed to send. Anything else falls
 * back to the status, so a reason added after this was written loses its classification and keeps
 * its message.
 */
const CODES: Readonly<Record<string, PluginErrorCode>> = {
    invalid_api_key: 'auth',
    missing_permissions: 'auth',
    quota_exceeded: 'forbidden',
    // A voice the row names and the account does not have. The voices table is what is wrong, so the
    // operator should hear about it rather than the station retrying a typo.
    voice_not_found: 'not_found',
    // A plan-limited voice or format: a professional clone, or `mp3_44100_192` on a free tier.
    voice_not_allowed: 'forbidden',
    detected_unusual_activity: 'forbidden',
    too_many_concurrent_requests: 'rate_limited',
    system_busy: 'rate_limited',
};

/** What to make of a refusal with no reason in it. */
const codeForStatus = (status: number): PluginErrorCode => {
    if (status === 401 || status === 403) return 'auth';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limited';
    if (status === 503) return 'unavailable';
    return 'upstream';
};

/** What was being asked for, for a message an operator can act on without the logs beside it. */
export interface SpeakAttempt {
    voice: string;
    model: string;
}

/**
 * The error for a speech request that came back refused.
 *
 * Reads the body, because that is where the reason is, which also releases it. Never throws of its
 * own accord: an error raised while working out what an error meant would replace the service's own
 * account of the problem with a parse failure.
 */
export async function speakFailure(response: Response, attempt: SpeakAttempt): Promise<PluginError> {
    const detail = detailOf(await tryJsonBody<unknown>(response).catch(() => undefined));
    const said = detail?.message === undefined ? '' : `: ${detail.message}`;

    return new PluginError(`elevenlabs answered HTTP ${response.status} for voice "${attempt.voice}" on ${attempt.model}${said}`)
        .withCode(codeFor(detail?.status) ?? codeForStatus(response.status))
        .withUpstreamStatus(response.status);
}

const codeFor = (status: string | undefined): PluginErrorCode | undefined =>
    status !== undefined && Object.hasOwn(CODES, status) ? CODES[status] : undefined;

/**
 * The reason and its sentence, if the body carries them.
 *
 * `detail` is an object on a refusal the service shaped and an ARRAY on a 422 from its request
 * validator, which names the field rather than a reason; that one keeps its first message and
 * classifies by status.
 */
function detailOf(body: unknown): { status?: string; message?: string } | undefined {
    if (body === null || typeof body !== 'object') return undefined;

    const detail: unknown = (body as { detail?: unknown }).detail;
    if (typeof detail === 'string') return { message: detail };
    if (Array.isArray(detail)) {
        const first: unknown = detail[0];
        const message = first !== null && typeof first === 'object' ? (first as { msg?: unknown }).msg : undefined;
        return typeof message === 'string' ? { message } : undefined;
    }
    if (detail === null || typeof detail !== 'object') return undefined;

    const { status, message } = detail as { status?: unknown; message?: unknown };
    return {
        ...(typeof status === 'string' ? { status } : {}),
        ...(typeof message === 'string' && message.trim().length > 0 ? { message: message.trim() } : {}),
    };
}
