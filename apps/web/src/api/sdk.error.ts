import { SdkError } from '@deadair/sdk';

/** The API's error envelope. `details` is keyed by request field. */
export interface ApiErrorBody {
    statusCode: number;
    message: string;
    details?: Record<string, string>;
}

/** Narrows an unknown rejection to the SDK's transport error, or undefined for anything else. */
export function sdkError(error: unknown): SdkError | undefined {
    return error instanceof SdkError ? error : undefined;
}

/**
 * Whether the server answered with a 4xx.
 *
 * The distinction this draws is between an answer and a failure to ask: a 4xx is the server's
 * verdict on the request, and repeating the same request gets the same verdict. Anything else —
 * a 5xx, or a `TypeError` from `fetch` when the network is down — leaves the question genuinely
 * unanswered. Both the retry policy and the refresh-cookie bootstrap turn on exactly this line,
 * so it is defined once here.
 */
export function isClientError(error: unknown): boolean {
    const status = sdkError(error)?.status;
    return status !== undefined && status >= 400 && status < 500;
}

/** The parsed error envelope, or undefined when the failure was not a structured API error. */
export function apiErrorBody(error: unknown): ApiErrorBody | undefined {
    const body = sdkError(error)?.body;
    if (typeof body !== 'object' || body === null) {
        return undefined;
    }
    return body as ApiErrorBody;
}

/** Field-keyed validation messages the caller can hand to `form.setErrors`. */
export function apiErrorDetails(error: unknown): Record<string, string> | undefined {
    const details = apiErrorBody(error)?.details;
    return details && Object.keys(details).length > 0 ? details : undefined;
}

/**
 * A human-readable message for an Alert, with a caller-supplied fallback.
 *
 * `details.message` first, because that is where the API puts the sentence it actually wrote:
 * `httpError(409).withDetails({ message: 'that lineup is on air…' })` leaves the envelope's own
 * `message` as the status phrase, so reading that alone turns every considered explanation the
 * server offers into the word "Conflict". Field-keyed validation details have no `message` key and
 * are unaffected; a body with neither falls through to the caller's fallback.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
    const body = apiErrorBody(error);
    for (const candidate of [body?.details?.message, body?.message]) {
        if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }
    return fallback;
}

/**
 * A parsed `WWW-Authenticate` challenge. The API sends `Bearer error="invalid_token"` on a dead
 * token and `Bearer error="mfa_required"` on a policy denial, so `error` is the field that
 * actually decides what the UI does; the rest are carried because the header may include them.
 */
export interface AuthChallenge {
    scheme: string;
    error?: string;
    errorDescription?: string;
    realm?: string;
    scope?: string;
}

/** `k="v"` or `k=v`, comma- or whitespace-separated, per RFC 9110 auth-param syntax. */
const AUTH_PARAM = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^\s,]+))/g;

/**
 * The challenge the server attached to a 401 or 403, or undefined when there was none.
 *
 * Cross-origin readability is not a concern: the API lists `WWW-Authenticate` in its CORS
 * `exposeHeaders`, and the SPA is same-origin anyway.
 */
export function authChallenge(error: unknown): AuthChallenge | undefined {
    const header = sdkError(error)?.headers.get('www-authenticate');
    if (!header) {
        return undefined;
    }
    // A bare `Bearer` with no parameters is a valid challenge, so the scheme is split off first
    // rather than requiring at least one `k=v` pair to match. Trimmed before the split so the
    // offset used to skip the scheme below lines up with the string it was measured against.
    const trimmed = header.trim();
    const [scheme = ''] = trimmed.split(/[\s,]/, 1);
    if (!scheme) {
        return undefined;
    }
    const challenge: AuthChallenge = { scheme };
    for (const match of trimmed.slice(scheme.length).matchAll(AUTH_PARAM)) {
        const key = match[1];
        // Quoted form first, then the bare one; exactly one of the two alternatives can match.
        const value = match[2] ?? match[3];
        if (key === undefined || value === undefined) {
            continue;
        }
        switch (key.toLowerCase()) {
            case 'error':
                challenge.error = value;
                break;
            case 'error_description':
                challenge.errorDescription = value;
                break;
            case 'realm':
                challenge.realm = value;
                break;
            case 'scope':
                challenge.scope = value;
                break;
        }
    }
    return challenge;
}

/**
 * Whether the access token is dead. Any 401 counts, challenge or not: the header is the server
 * explaining itself, not the thing that makes the token invalid, and a proxy may well strip it.
 */
export function isInvalidToken(error: unknown): boolean {
    return sdkError(error)?.status === 401;
}

/**
 * Whether the caller is authenticated but needs a second factor for this route.
 *
 * Distinct from the `result === 'mfa_required'` discriminant on a **200** token response, which is
 * a sign-in that stopped at a challenge. This one is a 403 on an already-established session.
 */
export function isStepUpRequired(error: unknown): boolean {
    return sdkError(error)?.status === 403 && authChallenge(error)?.error === 'mfa_required';
}

/** Whether the caller is authenticated but lacks the permission this route wants. */
export function isInsufficientScope(error: unknown): boolean {
    return sdkError(error)?.status === 403 && authChallenge(error)?.error === 'insufficient_scope';
}

/** What a step-up denial asks for, as the policy package spells it. */
export interface StepUpRequirement {
    /** ISO-8601 duration, e.g. `PT5M`. */
    within: string;
    acceptableMethods?: string[];
    acceptableKinds?: string[];
    excludeMethods?: string[];
}

/**
 * The requirement behind a 403 that asks for a recent strong factor, or undefined for any other
 * failure.
 *
 * Distinct from {@link isStepUpRequired}, which reads the `mfa_required` challenge header the
 * MFA-satisfied policy sends. This one is the recent-factor policy: `denyStepUp` renders the
 * requirement into the error body under `details.kind: 'step_up_required'`, and it is the one the
 * factor routes raise once a strong factor exists, so the console can re-verify and try again.
 */
export function stepUpRequirement(error: unknown): StepUpRequirement | undefined {
    if (sdkError(error)?.status !== 403) {
        return undefined;
    }
    const details = apiErrorBody(error)?.details as { kind?: unknown; stepUp?: unknown } | undefined;
    if (details?.kind !== 'step_up_required' || typeof details.stepUp !== 'object' || details.stepUp === null) {
        return undefined;
    }
    return details.stepUp as StepUpRequirement;
}
