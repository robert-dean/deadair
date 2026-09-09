import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { AuthenticationSession, AuthenticationSessionService } from '@maroonedsoftware/authentication';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { LoginActivityRepository } from './repositories/login.activity.repository.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * The logger takes a message first and structured meta second, console-style.
 * These call sites used to pass `({ err }, 'message')`, pino-style, which put an
 * object where the message goes: every one of them landed in the log as
 * `[object Object]` with the sentence discarded.
 */

const MAX_USER_AGENT_LEN = 512;
const LOGIN_IP_CLAIM = 'loginIp';
const LOGIN_USER_AGENT_CLAIM = 'loginUserAgent';

export type RecordLoginInput = {
    actorId: string;
    sessionToken: string;
    factorType: string;
    factorId?: string | null;
    mfaSatisfied: boolean;
};

export type RecordFactorFailureInput = {
    identifier: string;
    factorType: 'password' | 'email' | 'phone' | 'authenticator' | 'fido' | 'oidc' | 'refresh';
    actorId?: string | null;
    lastReason?: string | null;
};

export type ListedSession = {
    sessionToken: string;
    actorId: string;
    issuedAt: string;
    expiresAt: string;
    lastAccessedAt: string;
    factors: {
        method: string;
        methodId: string;
        kind: string;
        issuedAt: string;
        authenticatedAt: string;
    }[];
    ip: string | null;
    userAgent: string | null;
    organizationId: string | null;
    isCurrent: boolean;
};

const stringClaim = (claims: Record<string, unknown>, key: string): string | null => {
    const v = claims[key];
    return typeof v === 'string' ? v : null;
};

@Injectable()
export class SessionActivityService {
    constructor(
        private readonly loginActivity: LoginActivityRepository,
        private readonly sessionService: AuthenticationSessionService,
        private readonly authorizationContext: AuthorizationContext,
        private readonly logger: Logger,
    ) {}

    // Claims to attach when calling sessionService.createSession so the request's
    // IP and User-Agent ride along with the session. SessionAuditSink reads them
    // back off the session blob: a revoke happens on a different request, where
    // the live context describes the wrong caller.
    buildLoginContextClaims(): Record<string, unknown> {
        const ip = this.authorizationContext.request.ipAddress ?? null;
        const ua = this.authorizationContext.request.userAgent ?? null;
        const truncatedUa = ua && ua.length > MAX_USER_AGENT_LEN ? ua.slice(0, MAX_USER_AGENT_LEN) : ua;
        return {
            ...(ip ? { [LOGIN_IP_CLAIM]: ip } : {}),
            ...(truncatedUa ? { [LOGIN_USER_AGENT_CLAIM]: truncatedUa } : {}),
        };
    }

    async recordLoginSuccess(input: RecordLoginInput): Promise<void> {
        try {
            await this.loginActivity.insertLogin({
                actorId: input.actorId,
                factorType: input.factorType,
                factorId: input.factorId ?? null,
                sessionToken: input.sessionToken,
                ip: this.authorizationContext.request.ipAddress ?? null,
                userAgent: this.truncatedUserAgent(),
                mfaSatisfied: input.mfaSatisfied,
            });
        } catch (err) {
            this.logger.warn('auth: failed to record a login success', { error: errorText(err) });
        }
    }

    async recordFactorFailure(input: RecordFactorFailureInput): Promise<void> {
        const ip = this.authorizationContext.request.ipAddress;
        if (!ip) {
            // IP is part of the counter PK; without it we can't bucket the failure.
            // This only happens for internal/test invocations that bypass the auth
            // middleware — log and drop rather than throw, since failure tracking is
            // diagnostic, not the operation's core responsibility.
            return;
        }
        try {
            await this.loginActivity.upsertFailure({
                identifier: input.identifier,
                factorType: input.factorType,
                ip,
                actorId: input.actorId ?? null,
                lastReason: input.lastReason ?? null,
            });
        } catch (err) {
            this.logger.warn('auth: failed to record a factor failure', { error: errorText(err) });
        }
    }

    // ---- Listing / admin ----

    async listSessionsForActor(actorId: string, currentSessionToken?: string): Promise<ListedSession[]> {
        const sessions = await this.sessionService.getSessionsForSubject(actorId);
        return sessions.map(s => this.toListedSession(s, currentSessionToken));
    }

    async listLoginsForActor(actorId: string, options: { limit: number; offset: number }) {
        return this.loginActivity.listLoginsForActor(actorId, options.limit, options.offset);
    }

    async revokeSession(sessionToken: string): Promise<void> {
        await this.sessionService.deleteSession(sessionToken, 'logout');
    }

    async revokeAllOtherSessions(actorId: string, keepSessionToken: string): Promise<number> {
        const sessions = await this.sessionService.getSessionsForSubject(actorId);
        const targets = sessions.filter(s => s.sessionToken !== keepSessionToken);
        await Promise.all(targets.map(s => this.sessionService.deleteSession(s.sessionToken, 'logout')));
        return targets.length;
    }

    // ---- Helpers ----

    private toListedSession(session: AuthenticationSession, currentSessionToken?: string): ListedSession {
        return {
            sessionToken: session.sessionToken,
            actorId: session.subject,
            issuedAt: session.issuedAt.toISO() ?? '',
            expiresAt: session.expiresAt.toISO() ?? '',
            lastAccessedAt: session.lastAccessedAt.toISO() ?? '',
            factors: session.factors.map(f => ({
                method: f.method,
                methodId: f.methodId,
                kind: f.kind,
                issuedAt: f.issuedAt.toISO() ?? '',
                authenticatedAt: f.authenticatedAt.toISO() ?? '',
            })),
            ip: stringClaim(session.claims, LOGIN_IP_CLAIM),
            userAgent: stringClaim(session.claims, LOGIN_USER_AGENT_CLAIM),
            organizationId: stringClaim(session.claims, 'organizationId'),
            isCurrent: currentSessionToken === session.sessionToken,
        };
    }

    private truncatedUserAgent(): string | null {
        const ua = this.authorizationContext.request.userAgent;
        if (!ua) return null;
        return ua.length > MAX_USER_AGENT_LEN ? ua.slice(0, MAX_USER_AGENT_LEN) : ua;
    }
}
