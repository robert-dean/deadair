import { SdkError } from '@deadair/sdk';

/** The API's error envelope. `details` is keyed by request field. */
export interface ApiErrorBody {
    statusCode: number;
    message: string;
    details?: Record<string, string>;
}

/** The parsed error envelope, or undefined when the failure was not a structured API error. */
export function apiErrorBody(error: unknown): ApiErrorBody | undefined {
    if (!(error instanceof SdkError)) {
        return undefined;
    }
    if (typeof error.body !== 'object' || error.body === null) {
        return undefined;
    }
    return error.body as ApiErrorBody;
}

/** Field-keyed validation messages the caller can hand to `form.setErrors`. */
export function apiErrorDetails(error: unknown): Record<string, string> | undefined {
    const details = apiErrorBody(error)?.details;
    return details && Object.keys(details).length > 0 ? details : undefined;
}

/** A human-readable message for an Alert, with a caller-supplied fallback. */
export function apiErrorMessage(error: unknown, fallback: string): string {
    const message = apiErrorBody(error)?.message;
    return typeof message === 'string' && message.length > 0 ? message : fallback;
}
