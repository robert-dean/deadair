/**
 * A rhapsode refusal, as an error the station knows what to do with.
 *
 * ## Why this is a file rather than two lines at the call site
 *
 * Because this server answers with a REASON and the other speech plugins' servers do not. Both of
 * them read the status and pick between `auth` and `upstream`, which is all a bare HTTP code
 * supports. rhapsode sends `{ error: { code, message, retryable } }` on every refusal, and says why
 * the code is a field rather than something a client infers: "a caller that conflates them either
 * retries a permanent failure forever or discards work that would have succeeded on the next pass".
 *
 * That distinction is worth exactly as much here, because the station spends it. A `PluginError`
 * carrying `unavailable` leaves the segment's words on its row for the next pass; one carrying
 * `config` does not, and should not, because nothing about the next pass will be different. Getting
 * that pair backwards is either a break the station silently drops or a plugin retrying a typo
 * forever.
 *
 * The one thing NOT read across is `retryable` itself. The SDK derives retryability from the code it
 * is given, so honouring the flag would mean two sources for one decision; where the two disagree
 * the mapping below is deliberate, not an oversight — a 400 over a dial this plugin sent is the
 * operator's config to fix, and retrying it is what the flag would otherwise ask for.
 */

import { PluginError, tryJsonBody, type PluginErrorCode } from '@deadair/plugin-sdk';
import type { ErrorBody, ErrorDetail } from '@maroonedsoftware/rhapsode-sdk';

/**
 * What the station should do about each of rhapsode's reasons.
 *
 * Its protocol § 6 fixes the status each one is sent with, so this maps the CODE and leaves the
 * status to the fallback below: the code is the server's own word for what went wrong and survives
 * a proxy rewriting a status.
 */
const CODES: Readonly<Record<ErrorDetail['code'], PluginErrorCode>> = {
    // The request was wrong, and it is this plugin that built it out of the operator's table: an
    // unknown dial key, a variant this build does not have. Not retryable, and the form is where it
    // gets fixed.
    bad_request: 'config',
    // Both name something the operator typed that this server does not have. `not_found` would be
    // truer to the letter and useless in practice: it is the voices table that is wrong.
    unknown_engine: 'config',
    unknown_voice: 'config',
    // Asked for something real that this build cannot do — a format with no ffmpeg behind it, a
    // language the variant does not list.
    unsupported: 'unsupported',
    // The engine is there and the model is not, which is the whole of what `unavailable` means. The
    // code that keeps the segment's words on its row, so the next pass says the line that was
    // written rather than losing it to a card that was busy.
    model_unavailable: 'unavailable',
    oom: 'unavailable',
    // Every model slot is taken and this request is queued behind one. The station backs off rather
    // than hammering a server that has already said it is full.
    overloaded: 'rate_limited',
    // A management route without the token, or from an origin the server does not allow. Speech
    // routes are open, so reaching this at all means the server is stricter than this plugin expects.
    forbidden: 'auth',
    // An install or an unload arguing with itself. Not something `/speak` produces, mapped anyway so
    // the table is total.
    conflict: 'unavailable',
    internal: 'upstream',
};

/**
 * What to make of a refusal with no envelope in it.
 *
 * A proxy in front of the server, a server too broken to shape its own error, or a body that was not
 * JSON. The status is all there is, so this is the same judgement `plugins/kokoro` makes from the
 * same evidence.
 */
const codeForStatus = (status: number): PluginErrorCode => {
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate_limited';
    if (status === 503) return 'unavailable';
    return 'upstream';
};

/** What was being asked for, for a message an operator can act on without the logs beside it. */
export interface SpeakAttempt {
    engine: string;
    voice?: string;
    variant?: string;
}

/**
 * The error for a `/speak` that came back refused.
 *
 * Reads the body, because that is where the reason is, and cancels it either way: nobody else is
 * going to read it, and an error body is small enough that letting the socket go is the whole of the
 * cleanup.
 *
 * Never throws of its own accord. This runs on the failure path, and an error raised while working
 * out what an error meant would replace a server's own account of the problem with a parse failure.
 */
export async function speakFailure(response: Response, attempt: SpeakAttempt): Promise<PluginError> {
    const body = await tryJsonBody<ErrorBody>(response);
    const detail = detailOf(body);

    const asked = [
        `engine "${attempt.engine}"`,
        ...(attempt.voice === undefined ? [] : [`voice "${attempt.voice}"`]),
        ...(attempt.variant === undefined ? [] : [`variant "${attempt.variant}"`]),
    ].join(', ');

    // The server's own sentence, where there is one: it names the dial key, the missing format or
    // the voice it does not have, none of which the status carries.
    const said = detail === undefined ? '' : `: ${detail.message}`;

    return new PluginError(`rhapsode answered HTTP ${response.status} for ${asked}${said}`)
        .withCode(detail === undefined ? codeForStatus(response.status) : (codeFor(detail.code) ?? codeForStatus(response.status)))
        .withUpstreamStatus(response.status);
}

/**
 * One of the server's reasons, as this station's word for it.
 *
 * Takes a plain string rather than the contract's union, because this reads a body off the network:
 * the type says what a conforming server sends and is not a promise about what arrived. `undefined`
 * for anything not in the table, which is the server's own § 9 rule read from the other side — a
 * reader meeting a code from a newer contract must not lose the envelope over it, so the message
 * survives and only the classification falls back.
 */
const codeFor = (code: string): PluginErrorCode | undefined => (Object.hasOwn(CODES, code) ? CODES[code as ErrorDetail['code']] : undefined);

/** The reason, and the sentence beside it, if this really is an envelope. */
function detailOf(body: ErrorBody | undefined): { code: string; message: string } | undefined {
    const detail: unknown = body?.error;
    if (detail === null || typeof detail !== 'object') return undefined;

    const { code, message } = detail as { code?: unknown; message?: unknown };
    if (typeof message !== 'string' || message.trim().length === 0) return undefined;

    return { code: typeof code === 'string' ? code : '', message: message.trim() };
}
