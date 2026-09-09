import { Injectable } from 'injectkit';
import { AuditSink, type AuthenticationAuditEvent } from '@maroonedsoftware/authentication';
import { Logger } from '@maroonedsoftware/logger';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { errorText } from '#modules/shared/error.text.js';
import { SessionEventRepository, SessionEventType } from './repositories/session.event.repository.js';
import { LoginActivityRepository } from './repositories/login.activity.repository.js';

/** Longest User-Agent we store, so a hostile header can't bloat a row. */
const MAX_USER_AGENT_LEN = 512;

/** Claims the login path stamps onto the session so later events can recover the original request. */
const LOGIN_IP_CLAIM = 'loginIp';
const LOGIN_USER_AGENT_CLAIM = 'loginUserAgent';

/** Read a string claim off a session payload, ignoring anything that isn't one. */
const stringClaim = (claims: Record<string, unknown>, key: string): string | null => {
    const value = claims[key];
    return typeof value === 'string' ? value : null;
};

/** The `data` shape every `session.*` event carries. */
type SessionEventData = { sessionToken: string; claims: Record<string, unknown> };

/**
 * Writes ServerKit's authentication audit events into `session_events` and
 * `login_failure_counters`.
 *
 * Replaces the five `AuthenticationSessionHooks` callbacks this app used to
 * register, which ServerKit v5 removed. One `record` switch does what five
 * closures did, and three things get better in the move:
 *
 * - **`validation_failed` no longer costs a lookup.** The event carries
 *   `actorId`, so the old `getSession` round-trip — which returned nothing in
 *   the common case where the session had already gone — is deleted.
 * - **A rotation is one event.** `session.rotated` fills the `step_up` event
 *   type, which nothing wrote before: the hooks reported a rotation as an
 *   unrelated `created` + `revoked` pair.
 * - **`revokeAllForSubject` reports its total**, so a bulk revocation is one row
 *   with a count rather than something to infer from N `revoked` rows.
 *
 * Registered **scoped**, so `authorizationContext` is this request's.
 *
 * Every write is best-effort: ServerKit swallows a sink failure and logs
 * `audit.sink_failed`, so a database blip cannot fail a login. Alert on that
 * event rather than assuming silence means health.
 */
@Injectable()
export class SessionAuditSink extends AuditSink {
    constructor(
        private readonly sessionEvents: SessionEventRepository,
        private readonly loginActivity: LoginActivityRepository,
        private readonly authorizationContext: AuthorizationContext,
        private readonly logger: Logger,
    ) {
        super();
    }

    async record(event: AuthenticationAuditEvent): Promise<void> {
        switch (event.type) {
            case 'session.created':
                return this.writeSessionEvent(event.actorId, event.data as SessionEventData, 'created');
            case 'session.refreshed':
                return this.writeSessionEvent(event.actorId, event.data as SessionEventData, 'refreshed');
            case 'session.revoked':
                return this.writeSessionEvent(event.actorId, event.data as SessionEventData, 'revoked', {
                    reason: (event.data as { reason: string }).reason,
                });
            case 'session.rotated':
                // A rotation is a privilege change, which is exactly what `step_up`
                // was declared for and nothing ever wrote.
                return this.writeSessionEvent(event.actorId, event.data as SessionEventData, 'step_up', {
                    previousSessionToken: (event.data as { previousSessionToken: string }).previousSessionToken,
                });
            case 'session.validation_failed':
                return this.writeValidationFailure(event.actorId, event.data as { sessionToken?: string; reason: string });
            case 'session.refresh_reuse_detected':
                return this.writeRefreshReuse(event.data as { familyId: string; jti: string });
            default:
                // Every other domain — password, MFA, recovery, API keys — is not
                // wired here yet. Ignoring an unrecognised type is deliberate: a
                // ServerKit minor may add one, and that must not throw.
                return;
        }
    }

    /** Insert one `session_events` row, preferring the request context captured at login. */
    private async writeSessionEvent(
        actorId: string | undefined,
        data: SessionEventData,
        eventType: SessionEventType,
        metadata: Record<string, unknown> | null = null,
    ): Promise<void> {
        if (!actorId) return;
        try {
            await this.sessionEvents.insert({
                sessionToken: data.sessionToken,
                actorId,
                eventType,
                // A revoke happens on a different request than the login, so the live
                // context describes the wrong caller. The claims stamped at login win.
                ip: stringClaim(data.claims, LOGIN_IP_CLAIM) ?? this.authorizationContext.request.ipAddress ?? null,
                userAgent: stringClaim(data.claims, LOGIN_USER_AGENT_CLAIM) ?? this.truncatedUserAgent(),
                metadata,
            });
        } catch (err) {
            this.logger.warn('auth: failed to record a session event', { error: errorText(err), eventType });
        }
    }

    /**
     * Record a token that did not resolve to a usable session.
     *
     * The event carries `actorId` wherever ServerKit knows one, which is every
     * case except a JWT that never decoded — so unlike the hook this replaces,
     * there is nothing to look up.
     */
    private async writeValidationFailure(actorId: string | undefined, data: { sessionToken?: string; reason: string }): Promise<void> {
        if (!actorId || !data.sessionToken) return;
        try {
            await this.sessionEvents.insert({
                sessionToken: data.sessionToken,
                actorId,
                eventType: 'validation_failed',
                ip: this.authorizationContext.request.ipAddress ?? null,
                userAgent: this.truncatedUserAgent(),
                metadata: { reason: data.reason },
            });
        } catch (err) {
            this.logger.warn('auth: failed to record a session validation failure', { error: errorText(err) });
        }
    }

    /**
     * Count a replayed refresh token alongside password and OTP failures.
     *
     * The family has already been revoked by the time this arrives, and each of
     * its sessions produced its own `session.revoked` row. This adds the
     * brute-force counter bump, keyed by family since there is no actor to blame.
     */
    private async writeRefreshReuse(data: { familyId: string; jti: string }): Promise<void> {
        const ip = this.authorizationContext.request.ipAddress;
        if (!ip) return;
        try {
            await this.loginActivity.upsertFailure({
                identifier: data.familyId,
                factorType: 'refresh',
                ip,
                actorId: null,
                lastReason: 'refresh_token_reuse',
            });
        } catch (err) {
            this.logger.warn('auth: failed to record a refresh-reuse failure', { error: errorText(err), ...data });
        }
    }

    private truncatedUserAgent(): string | null {
        const ua = this.authorizationContext.request.userAgent ?? null;
        return ua && ua.length > MAX_USER_AGENT_LEN ? ua.slice(0, MAX_USER_AGENT_LEN) : ua;
    }
}
