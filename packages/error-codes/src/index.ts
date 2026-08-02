/**
 * Stable, machine-readable error codes surfaced in the API's `details.code` field.
 *
 * Convention: codes are append-only. Never reuse or renumber a retired code — clients
 * may branch on these strings. To retire one, leave the entry with a `retired` comment
 * rather than deleting it, so the number is never handed out again.
 */
export const ErrorCodes = {
    // Identity / organization context (E100xx)
    INVALID_ORGANIZATION_CONTEXT: 'E10001',
    NO_ACTIVE_ORGANIZATION: 'E10002',
    PERSON_NOT_PROVISIONED: 'E10003',
    INVITATION_ALREADY_ACCEPTED: 'E10004',
    INVITATION_ALREADY_MEMBER: 'E10005',
    INVITATION_NOT_PENDING: 'E10006',
    INVITATION_EXPIRED: 'E10007',
    SESSION_NOT_OWNED_BY_CALLER: 'E10008',
    ONBOARDING_ADMIN_ALREADY_EXISTS: 'E10009',

    // Render / shows (E200xx)
    SHOW_NOT_FOUND: 'E20001',
    SHOW_SLUG_TAKEN: 'E20002',
    INVALID_SHOW_SLUG: 'E20003',
    INVALID_SHOW_KIND: 'E20004',
    INVALID_SCRIPT_FORMAT: 'E20005',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
