import { httpError, IsHttpError, unauthorizedError } from '@maroonedsoftware/errors';
import {
    AuthenticationFactor,
    AuthenticationFactorKind,
    AuthenticationFactorMethod,
    AuthenticationGrantType,
    AuthenticationLoginStart,
    AuthenticationLoginStartResponse,
    AuthenticationRequest,
    AuthenticationTokenIssued,
    AuthenticationTokenResponse,
    AuthenticatorAuthenticationRequest,
    BaseAuthenticationLoginStart,
    BaseAuthenticationRequest,
    ClientCredentialsAuthenticationRequest,
    EnrollmentRequiredResponse,
    FactorChallengeEmailStartResponse,
    FactorChallengeFidoStart,
    FactorChallengeFidoStartResponse,
    FactorChallengeStartRequest,
    FactorChallengeStartResponse,
    FidoAuthenticationLoginStart,
    FidoAuthenticationLoginStartResponse,
    FidoAuthenticationRequest,
    MfaRequiredResponse,
    OidcAuthenticationLoginStart,
    OidcAuthenticationRequest,
    OidcLoginCallback,
    OidcLoginStart,
    OidcLoginStartResponse,
    PasswordAuthenticationRequest,
    RefreshTokenAuthenticationRequest,
    StepUpStartRequest,
    StepUpStartResponse,
    StepUpStartResponseOutput,
} from '#modules/authentication/types/authentication.types.js';
import { Injectable } from 'injectkit';
import { parseAndValidate, parseAndValidateArray } from '@maroonedsoftware/zod';
import { AuthenticationServiceOptions } from './authentication.options.js';
import { ActorsRepository } from '#modules/authentication/repositories/actors.repository.js';
import {
    AuthenticationSessionFactor,
    AuthenticationSessionService,
    AuthenticatorFactorService,
    AuthMfaRequiredPolicyFactor,
    EmailFactorRepository,
    FidoFactorService,
    HtmlRedirectProvider,
    MfaChallengeService,
    MfaOrchestrator,
    OidcFactorService,
    PasswordFactorService,
    PasswordHashProvider,
    TargetActor,
} from '@maroonedsoftware/authentication';
import { DateTime } from 'luxon';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { SessionActivityService } from './session.activity.service.js';
import { RequestCookieJar } from './request.cookie.jar.js';
import { ResponseCookieJar } from './response.cookie.jar.js';

// Internal-handler unions: camelCase pre-transform shape (matches the `z.input` side of the
// `format(output=snake)` schemas). The public methods `requestToken` and `startFactorChallenge`
// run `parseAndValidate` to flip these to the snake_case wire shape.
type AuthenticationTokenInternal = AuthenticationTokenIssued | MfaRequiredResponse;
type FactorChallengeStartInternal = FactorChallengeFidoStartResponse | FactorChallengeEmailStartResponse;
type AuthenticateHandler = (request: BaseAuthenticationRequest) => Promise<AuthenticationTokenInternal>;
type StartLoginHandler = (request: BaseAuthenticationLoginStart) => Promise<AuthenticationLoginStartResponse>;

type AuthenticationHandlers = {
    authenticate: AuthenticateHandler;
    startLogin?: StartLoginHandler;
};

type ActorType = 'user' | 'system' | 'vendor';

// A fixed plaintext hashed once per process to give the unknown-email login path a real Argon2
// verify to run, so its timing matches a known-email verify (removes the user-enumeration side
// channel). AuthenticationService is request-scoped, so this is memoized at module scope rather
// than per instance — otherwise every unknown-email request would pay an extra hash and become
// its own, inverted timing oracle.
const DUMMY_VERIFY_PASSWORD = 'timing-equalization-dummy-password';
let dummyPasswordHashPromise: Promise<{ hash: string; salt: string }> | undefined;

/**
 * Whether a `refreshSession` rejection is a verdict on the *token* rather than on the
 * infrastructure behind it.
 *
 * The predicate is "an HttpError with a 4xx status", because that is the only signal the session
 * service gives us that is reliable in both directions. `AuthenticationSessionService.refreshSession`
 * raises 401 for every token-validity failure it recognises (invalid signature, malformed, expired,
 * wrong kind, replayed jti, revoked family, session gone), so a 4xx means "this token is dead and
 * will stay dead". Everything else is not about the token at all: a 5xx is the service telling us
 * its own dependency failed, and a non-HttpError (a driver-level throw from an exhausted DB pool, a
 * Redis socket error, a programming fault) never got far enough to judge the token. Treating those
 * as auth failures would delete a perfectly good 30-day cookie for every user who happened to
 * refresh during a blip, silently logging them all out for an infrastructure hiccup that resolved
 * in seconds. When we cannot tell, we keep the cookie: the cost of guessing wrong that way is one
 * more doomed 401 on the next boot, versus a forced re-login for the whole active user base.
 */
function isAuthSemanticRefreshRejection(error: unknown): boolean {
    return IsHttpError(error) && error.statusCode >= 400 && error.statusCode < 500;
}

@Injectable()
export class AuthenticationService {
    private readonly authenticateHandlerMap: Map<AuthenticationGrantType, AuthenticationHandlers>;

    constructor(
        private readonly options: AuthenticationServiceOptions,
        private readonly actorsRepository: ActorsRepository,
        private readonly sessionService: AuthenticationSessionService,
        private readonly emailFactorRepository: EmailFactorRepository,
        private readonly passwordFactorService: PasswordFactorService,
        private readonly passwordHashProvider: PasswordHashProvider,
        private readonly fidoFactorService: FidoFactorService,
        private readonly authenticatorFactorService: AuthenticatorFactorService,
        private readonly mfaChallengeService: MfaChallengeService,
        private readonly mfaOrchestrator: MfaOrchestrator,
        private readonly authorizationContext: AuthorizationContext,
        private readonly sessionActivity: SessionActivityService,
        private readonly htmlRedirectProvider: HtmlRedirectProvider,
        private readonly oidcFactorService: OidcFactorService,
        private readonly requestCookieJar: RequestCookieJar,
        private readonly responseCookieJar: ResponseCookieJar,
    ) {
        this.authenticateHandlerMap = new Map<AuthenticationGrantType, AuthenticationHandlers>();
        this.authenticateHandlerMap.set('client_credentials', {
            authenticate: (request: BaseAuthenticationRequest) => this.handleClientCredentials(request as ClientCredentialsAuthenticationRequest),
        });
        this.authenticateHandlerMap.set('password', {
            authenticate: (request: BaseAuthenticationRequest) => this.handlePassword(request as PasswordAuthenticationRequest),
        });
        this.authenticateHandlerMap.set('refresh_token', {
            authenticate: (request: BaseAuthenticationRequest) => this.handleRefreshToken(request as RefreshTokenAuthenticationRequest),
        });
        this.authenticateHandlerMap.set('fido', {
            authenticate: (request: BaseAuthenticationRequest) => this.handleFido(request as FidoAuthenticationRequest),
            startLogin: (request: BaseAuthenticationLoginStart) => this.handleFidoStartLogin(request as FidoAuthenticationLoginStart),
        });
        this.authenticateHandlerMap.set('authenticator', {
            authenticate: (request: BaseAuthenticationRequest) => this.handleAuthenticator(request as AuthenticatorAuthenticationRequest),
        });
        this.authenticateHandlerMap.set('oidc', {
            authenticate: (request: BaseAuthenticationRequest) => this.handleOidc(request),
            startLogin: (request: BaseAuthenticationLoginStart) => this.handleOidcStartLogin(request as OidcAuthenticationLoginStart),
        });
    }

    async requestToken(request: AuthenticationRequest): Promise<AuthenticationTokenResponse> {
        const handler = this.authenticateHandlerMap.get(request.grant_type);
        if (!handler) {
            throw httpError(400).withDetails({
                grantType: `Unsupported grant type ${request.grant_type}`,
            });
        }
        return await parseAndValidate(await handler.authenticate(request), AuthenticationTokenResponse);
    }

    async startLogin(request: AuthenticationLoginStart): Promise<AuthenticationLoginStartResponse> {
        const handler = this.authenticateHandlerMap.get(request.grant_type);
        if (!handler || !handler.startLogin) {
            throw httpError(400).withDetails({
                grantType: `Unsupported grant type ${request.grant_type}`,
            });
        }
        return await parseAndValidate(await handler.startLogin(request), AuthenticationLoginStartResponse);
    }

    async listFactors(): Promise<AuthenticationFactor[]> {
        const { actorId } = this.authorizationContext.requireAuthentication();

        const factors = await this.actorsRepository.listFactors(actorId, true);

        return await parseAndValidateArray(factors, AuthenticationFactor);
    }

    // The `default` arm is load-bearing rather than defensive. This switch answered `fido` alone and
    // fell off the end for the other two, and the `undefined` that produced went into the RESPONSE
    // `parseAndValidate` below — which reported `400 {"_root":"Expected object"}`, the same shape a
    // malformed REQUEST body gets. So a well-formed email challenge, the one input that gets past
    // request validation and into the hole, looked exactly like a client sending nothing, and the
    // reported bug was a day spent in the body parser and the middleware chain. An unimplemented
    // method has to say so in its own status.
    async startFactorChallenge(request: FactorChallengeStartRequest): Promise<FactorChallengeStartResponse> {
        const internal = await (async (): Promise<FactorChallengeStartInternal> => {
            switch (request.method) {
                case 'fido':
                    return this.startFidoFactorChallenge(request);
                default:
                    throw httpError(501).withDetails({ method: `${request.method} factor challenges are not implemented` });
            }
        })();
        return await parseAndValidate(internal, FactorChallengeStartResponse);
    }

    // Mint a fresh MFA challenge for the *already-authenticated* current session so the SPA
    // can satisfy a `step_up_required` policy denial. Filters eligible factors against the
    // inbound StepUpRequirement hint (acceptableMethods/Kinds/excludeMethods). When no
    // enrolled factor matches, returns `result: 'enrollment_required'` so the SPA can drive
    // the user into factor enrollment instead of handling an HTTP error.
    async startStepUpChallenge(request: StepUpStartRequest): Promise<StepUpStartResponseOutput> {
        const { actorId } = this.authorizationContext.requireAuthentication();
        const actorCtx = this.authorizationContext.actor;
        if (actorCtx.kind !== 'user') {
            throw httpError(403).withDetails({ message: 'step-up is only available for human actors' });
        }
        const sessionFactors = actorCtx.factors;
        if (sessionFactors.length === 0) {
            // Defensive — requireAuthentication should have caught this.
            throw unauthorizedError('Bearer error="invalid_token"');
        }
        // The most-recent session factor stands in as the "primary" for the new challenge —
        // step-up is just "verify a fresh factor in addition to whatever proved the session".
        const primaryFactor = sessionFactors.reduce((latest, current) => (current.authenticatedAt > latest.authenticatedAt ? current : latest));

        const enrolledRaw = await this.actorsRepository.listFactors(actorId, true);
        const enrolled = enrolledRaw.map(f => ({
            method: f.method as AuthenticationFactorMethod,
            methodId: f.methodId,
            kind: f.kind as AuthenticationFactorKind,
            label: f.label ?? null,
        }));
        const matchesHint = (method: AuthenticationFactorMethod, kind: AuthenticationFactorKind): boolean => {
            if (request.acceptableMethods && !request.acceptableMethods.includes(method)) return false;
            if (request.acceptableKinds && !request.acceptableKinds.includes(kind)) return false;
            if (request.excludeMethods && request.excludeMethods.includes(method)) return false;
            return true;
        };
        const eligible = enrolled.filter(f => matchesHint(f.method, f.kind));
        if (eligible.length === 0) {
            const enrollment: EnrollmentRequiredResponse = { result: 'enrollment_required' };
            return await parseAndValidate(enrollment, StepUpStartResponse);
        }

        const actor: TargetActor<ActorType> = {
            kind: actorCtx.kind as ActorType,
            actorId,
        };

        const challenge = await this.mfaChallengeService.issue({
            actor,
            primaryFactor,
            eligibleFactors: eligible.map(f => ({
                method: f.method,
                methodId: f.methodId,
                kind: f.kind,
                ...(f.label ? { label: f.label } : {}),
            })),
        });

        const internal: MfaRequiredResponse = {
            result: 'mfa_required',
            challengeId: challenge.challengeId,
            expiresAt: challenge.expiresAt,
            factors: eligible.map(f => ({
                method: f.method,
                methodId: f.methodId,
                kind: f.kind,
                ...(f.label ? { label: f.label } : {}),
            })),
        };
        return await parseAndValidate(internal, StepUpStartResponse);
    }

    private handleClientCredentials(_request: ClientCredentialsAuthenticationRequest): Promise<AuthenticationTokenInternal> {
        throw httpError(501);
    }

    private async handlePassword(request: PasswordAuthenticationRequest): Promise<AuthenticationTokenInternal> {
        const ctx = await this.verifyPasswordAndResolveActor(request.username, request.password);
        return await this.issueOrChallenge(ctx);
    }

    private async handleOidc(request: BaseAuthenticationRequest): Promise<AuthenticationTokenInternal> {
        const { challenge_id } = request as OidcAuthenticationRequest;
        const exchange = await this.oidcFactorService.redeemAuthenticatedExchange(challenge_id);
        if (!exchange) {
            throw unauthorizedError('Bearer error="invalid_grant"');
        }

        const actor = await this.actorsRepository.get(exchange.actorId, true);
        if (!actor) {
            throw unauthorizedError('Bearer error="invalid_grant"');
        }

        const now = DateTime.utc();
        return await this.issueOrChallenge({
            actor: {
                kind: actor.type as ActorType,
                actorId: exchange.actorId,
            },
            primaryFactor: {
                issuedAt: now,
                authenticatedAt: now,
                method: 'oidc',
                methodId: exchange.factorId,
                kind: 'possession',
            },
        });
    }

    private async verifyPasswordAndResolveActor(
        username: string,
        password: string,
    ): Promise<{ actor: TargetActor<ActorType>; primaryFactor: AuthenticationSessionFactor }> {
        const factor = await this.emailFactorRepository.findFactor(username);
        if (!factor || !factor.active) {
            // Burn an equivalent Argon2 verify so an unknown/inactive email takes the same wall
            // time as a real password check — otherwise the early return leaks account existence
            // through response timing.
            await this.burnPasswordVerify(password);
            await this.sessionActivity.recordFactorFailure({
                identifier: username,
                factorType: 'password',
                actorId: factor?.actorId ?? null,
                lastReason: factor ? 'inactive_account' : 'unknown_email',
            });
            throw unauthorizedError('Bearer error="invalid_grant"');
        }

        let passwordFactor;
        try {
            passwordFactor = await this.passwordFactorService.verifyPassword(factor.actorId, password);
        } catch (err) {
            await this.sessionActivity.recordFactorFailure({
                identifier: username,
                factorType: 'password',
                actorId: factor.actorId,
                lastReason: 'invalid_password',
            });
            throw err;
        }

        const actor = await this.actorsRepository.get(factor.actorId, true);
        if (!actor) {
            await this.sessionActivity.recordFactorFailure({
                identifier: username,
                factorType: 'password',
                actorId: factor.actorId,
                lastReason: 'actor_missing',
            });
            throw unauthorizedError('Bearer error="invalid_grant"');
        }

        const now = DateTime.utc();
        return {
            actor: {
                kind: actor.type as ActorType,
                actorId: factor.actorId,
            },
            primaryFactor: {
                issuedAt: now,
                authenticatedAt: now,
                method: 'password',
                methodId: passwordFactor.id,
                kind: 'knowledge',
            },
        };
    }

    private async issueOrChallenge(ctx: {
        actor: TargetActor<ActorType>;
        primaryFactor: AuthenticationSessionFactor;
    }): Promise<AuthenticationTokenInternal> {
        const enrolled = await this.actorsRepository.listFactors(ctx.actor.actorId, true);
        // The repository selects method/kind as raw SQL literals; cast through the validated
        // factor union since Kysely widens them to `string`. Labels travel into the orchestrator
        // so the challenge payload carries them straight back out without a side lookup.
        const availableFactors: AuthMfaRequiredPolicyFactor[] = enrolled.map(f => ({
            method: f.method,
            methodId: f.methodId,
            kind: f.kind,
            ...(f.label ? { label: f.label } : {}),
        })) as AuthMfaRequiredPolicyFactor[];

        const result = await this.mfaOrchestrator.issueOrChallenge(ctx.actor, ctx.primaryFactor, availableFactors);

        if (result.kind === 'allow') {
            return await this.issueTokenFor(result.actor, result.primaryFactor);
        }

        return {
            result: 'mfa_required',
            challengeId: result.challenge.challengeId,
            expiresAt: result.challenge.expiresAt,
            factors: result.challenge.eligibleFactors.map(f => ({
                method: f.method,
                methodId: f.methodId,
                kind: f.kind,
                ...(f.label ? { label: f.label } : {}),
            })),
        };
    }

    private async issueTokenFor(
        actor: TargetActor<ActorType>,
        factors: AuthenticationSessionFactor | AuthenticationSessionFactor[],
    ): Promise<AuthenticationTokenInternal> {
        const factorList = Array.isArray(factors) ? factors : [factors];
        const mfaSatisfied = factorList.length > 1;
        const claims = {
            actorType: actor.kind,
            ...this.sessionActivity.buildLoginContextClaims(),
        };

        // When the caller is already authenticated this is an MFA step-up, not a fresh
        // login: rotate the existing session so the elevated factors bind to a brand-new
        // sessionToken and the pre-elevation token is revoked. rotateSession carries the
        // existing factors and familyId forward; updateSession upserts the freshly verified
        // secondary factor onto the rotated session.
        const currentSessionToken = this.authorizationContext.actor.kind === 'user' ? this.authorizationContext.actor.sessionToken : null;

        if (currentSessionToken && mfaSatisfied) {
            const rotated = await this.sessionService.rotateSession(currentSessionToken, claims);
            const secondary = factorList[factorList.length - 1];
            if (secondary) {
                await this.sessionService.updateSession(rotated.session.sessionToken, actor.actorId, undefined, undefined, secondary);
            }
            return {
                result: 'token',
                accessToken: rotated.accessToken,
                refreshToken: rotated.refreshToken,
                expiresIn: rotated.expiresIn,
                tokenType: rotated.tokenType,
                scope: rotated.scope,
            };
        }

        const session = await this.sessionService.createSession(actor.actorId, claims, factors);
        const token = await this.sessionService.issueTokenForSession(session.sessionToken);
        const primary = factorList[0];
        if (primary) {
            await this.sessionActivity.recordLoginSuccess({
                actorId: actor.actorId,
                sessionToken: session.sessionToken,
                factorType: primary.method,
                factorId: primary.methodId,
                mfaSatisfied,
            });
        }
        return {
            result: 'token',
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            expiresIn: token.expiresIn,
            tokenType: token.tokenType,
            scope: token.scope,
        };
    }

    private async handleRefreshToken(request: RefreshTokenAuthenticationRequest): Promise<AuthenticationTokenInternal> {
        // Delegate to the session service's refresh grant so the refresh token is single-use:
        // it consumes the presented jti, rotates to a fresh access/refresh pair, verifies
        // kind === 'refresh' + expiry, and — on replay of an already-consumed jti — revokes the
        // whole token family and fires onRefreshReuseDetected. Do NOT reimplement this with
        // lookupSessionFromJwt + issueTokenForSession: that path skips jti consumption and
        // rotation, leaving refresh tokens indefinitely replayable.
        //
        // A browser client holds the refresh token only as the httpOnly cookie, so it sends no
        // body token; refreshCookieMiddleware stashed the presented cookie in the RequestCookieJar.
        const bodyToken = request.refresh_token;
        const refreshToken = bodyToken ?? this.requestCookieJar.getRefreshToken();
        if (!refreshToken) {
            throw unauthorizedError('Bearer error="invalid_request"');
        }
        // Which half presented the token decides whether the cookie is implicated at all. An API
        // client posting a stale token in the body says nothing about the browser cookie sitting
        // alongside it, so clearing on that path would log the browser out over someone else's
        // dead token.
        const presentedByCookie = bodyToken === undefined;
        try {
            await this.revokeIfSubjectIsGone(refreshToken);
            const token = await this.sessionService.refreshSession(refreshToken);
            return {
                result: 'token',
                accessToken: token.accessToken,
                refreshToken: token.refreshToken,
                expiresIn: token.expiresIn,
                tokenType: token.tokenType,
                scope: token.scope,
            };
        } catch (error) {
            // Only when the cookie itself presented a token the session service judged dead
            // (expired, replayed, part of a revoked family) do we drop it: otherwise the browser
            // keeps presenting it on every boot until the 30-day cookie expires, paying a doomed
            // 401 each time. See isAuthSemanticRefreshRejection for why a 5xx or a non-HTTP throw
            // deliberately leaves the cookie in place. refreshCookieMiddleware drains this flag
            // even on the error path.
            if (presentedByCookie && isAuthSemanticRefreshRejection(error)) {
                this.responseCookieJar.clearRefreshToken();
            }
            throw error;
        }
    }

    /**
     * Refuses to refresh a session whose subject no longer exists in Postgres.
     *
     * Sessions live in Redis and actors live in Postgres, so the two can diverge — a database
     * rebuild wipes the actors while the browser's refresh cookie and its Redis session survive
     * intact. `refreshSession` consults only the cache, so left alone it happily mints a fresh
     * access token for a deleted user; every downstream permission check then finds no tuples and
     * answers 403, and the audit hook fails its foreign key on the way past. Revoke the session
     * instead, and let the 401 route the client to a real login.
     *
     * The lookup is read-only (no jti consumption, no rotation), so a token this rejects is left
     * exactly as `refreshSession` would have found it. Anything the lookup itself refuses is not
     * this method's verdict to render: fall through and let the refresh grant judge it, so replay
     * detection and family revocation stay in one place.
     */
    private async revokeIfSubjectIsGone(refreshToken: string): Promise<void> {
        const lookup = await this.sessionService.lookupSessionFromJwt(refreshToken, true).catch(() => undefined);
        if (!lookup) return;

        const { session } = lookup;
        if (await this.actorsRepository.existsActive(session.subject)) return;

        await this.sessionService.deleteSession(session.sessionToken, 'expiry');
        throw unauthorizedError('Bearer error="invalid_grant"').withInternalDetails({
            message: `refresh rejected: session ${session.sessionToken} names missing or inactive actor ${session.subject}`,
        });
    }

    private async handleFido(request: FidoAuthenticationRequest): Promise<AuthenticationTokenInternal> {
        // MFA second-factor: the orchestrator looks up the pending MFA challenge, runs the
        // FIDO verifier with the wire-supplied challengeId, and asserts the verified factor
        // is on the eligible list before redeeming.
        if (request.mfa_challenge_id) {
            const result = await this.mfaOrchestrator.completeMfa<ActorType>(request.mfa_challenge_id, {
                method: 'fido',
                challengeId: request.challenge_id,
                credential: request.credential,
            });
            return await this.issueTokenFor(result.actor, [result.primaryFactor, result.secondaryFactor]);
        }

        const result = await this.fidoFactorService.verifyFidoAuthorizationChallenge(request.challenge_id, request.credential);

        const now = DateTime.utc();
        const proofFactor: AuthenticationSessionFactor = {
            issuedAt: now,
            authenticatedAt: now,
            method: 'fido',
            methodId: result.id,
            kind: 'possession',
        };

        return await this.issueTokenFor({ kind: 'user', actorId: result.actorId }, proofFactor);
    }

    private async handleAuthenticator(request: AuthenticatorAuthenticationRequest): Promise<AuthenticationTokenInternal> {
        // Pre-check eligibility against the cached MFA challenge before invoking the
        // factor service. Mirrors the Bearer-error convention used elsewhere in this
        // flow, and prevents a leaked challenge id from being used to probe arbitrary
        // method_ids through the validateFactor side effect (rate limits, audit events).
        const mfa = await this.mfaChallengeService.peek(request.mfa_challenge_id);
        if (!mfa) {
            throw unauthorizedError('Bearer error="invalid_challenge"');
        }
        const eligible = mfa.eligibleFactors.some(f => f.method === 'authenticator' && f.methodId === request.method_id);
        if (!eligible) {
            throw unauthorizedError('Bearer error="invalid_factor"');
        }

        const result = await this.mfaOrchestrator.completeMfa<ActorType>(request.mfa_challenge_id, {
            method: 'authenticator',
            methodId: request.method_id,
            code: request.code,
        });
        return await this.issueTokenFor(result.actor, [result.primaryFactor, result.secondaryFactor]);
    }

    private async handleOidcStartLogin(request: OidcAuthenticationLoginStart): Promise<AuthenticationLoginStartResponse> {
        const { url, state, expiresAt } = await this.oidcFactorService.beginAuthorization({
            provider: request.provider,
            intent: 'sign-in',
        });

        return await parseAndValidate(
            {
                grant_type: 'oidc',
                challengeId: state,
                authorize_url: url.toString(),
                state,
                expires_at: expiresAt,
            },
            AuthenticationLoginStartResponse,
        );
    }

    private async startFidoFactorChallenge(request: FactorChallengeFidoStart): Promise<FactorChallengeStartInternal> {
        const mfa = await this.mfaChallengeService.peek(request.mfa_challenge_id);
        if (!mfa) {
            throw unauthorizedError('Bearer error="invalid_challenge"');
        }
        const fidoFactor = mfa.eligibleFactors.find(f => f.method === 'fido');
        if (!fidoFactor) {
            throw httpError(404).withDetails({ method: 'fido factor not enrolled' });
        }

        // We scope the WebAuthn allowlist to the specific credential the MFA challenge offered
        // — the SPA mustn't be able to discover other credentials by trying different ids.
        const challenge = await this.fidoFactorService.createFidoAuthorizationChallenge(mfa.actor.actorId, fidoFactor.methodId, {
            rpId: this.options.authenticationFidoRpId,
            rpOrigin: this.options.authenticationFidoRpOrigin,
        });

        return {
            method: 'fido',
            fidoChallengeId: challenge.challengeId,
            assertion: challenge.assertion,
            expiresAt: challenge.expiresAt,
        };
    }

    // Runs a real Argon2 verify against a fixed dummy hash so an unknown-email password login
    // takes the same time as a genuine one. The hash is computed once per process (see the
    // module-level memo) and reused, matching the single-verify cost of the real path.
    private async burnPasswordVerify(password: string): Promise<void> {
        dummyPasswordHashPromise ??= this.passwordHashProvider.hash(DUMMY_VERIFY_PASSWORD);
        const { hash, salt } = await dummyPasswordHashPromise;
        // The boolean result is discarded — we only need the constant-time verify to run.
        await this.passwordHashProvider.verify(password, hash, salt).catch(() => undefined);
    }

    private async handleFidoStartLogin(request: FidoAuthenticationLoginStart): Promise<FidoAuthenticationLoginStartResponse> {
        const factor = await this.emailFactorRepository.findFactor(request.email);
        if (!factor || !factor.active) {
            throw httpError(400);
        }

        const challenge = await this.fidoFactorService.createFidoAuthorizationChallenge(factor.actorId, undefined, {
            rpId: this.options.authenticationFidoRpId,
            rpOrigin: this.options.authenticationFidoRpOrigin,
        });

        return {
            grant_type: 'fido',
            challengeId: challenge.challengeId,
            expiresAt: challenge.expiresAt,
            assertion: challenge.assertion,
        };
    }

    async startOidcLogin(request: OidcLoginStart): Promise<OidcLoginStartResponse> {
        const { url, state, expiresAt } = await this.oidcFactorService.beginAuthorization({
            provider: request.provider,
            intent: 'sign-in',
            redirectAfter: request.redirect_after,
        });

        return await parseAndValidate(
            {
                authorize_url: url.toString(),
                state,
                expires_at: expiresAt,
            },
            OidcLoginStartResponse,
        );
    }

    // Returns the redirect HTML plus the resolved `actorId` (when the callback
    // succeeded) so the route can run post-auth side effects — notably the
    // OIDC-avatar capture — without `AuthenticationService` importing identity
    // services (which would form an import cycle via ReferrersService).
    async handleOidcCallback(query: OidcLoginCallback): Promise<string> {
        try {
            const result = await this.oidcFactorService.completeAuthorization({ params: query });

            const identity =
                result.kind === 'new-user'
                    ? await this.provisionOidcNewUser(result.authorizationId, result.profile)
                    : { actorId: result.actorId, factorId: result.factorId, isNewUser: false };

            const exchangeId = await this.oidcFactorService.stashAuthenticatedExchange({
                actorId: identity.actorId,
                factorId: identity.factorId,
                isNewUser: identity.isNewUser,
            });

            const target = new URL(result.redirectAfter ?? `${this.options.spaBaseUrl}/auth/callback`);
            target.searchParams.set('token', `oidc:${exchangeId}`);
            if (identity.isNewUser) target.searchParams.set('is_new_user', 'true');

            const { html } = this.htmlRedirectProvider.getRedirectHtml(target);

            // Capture the IdP avatar (e.g. Google's `picture`) for an already-existing
            // person — covers account-linking and returning-user sign-in, where the
            // person predates the picture. New users have no person yet (no-op); their
            // avatar is captured at onboarding in `createPerson`. Done here (not in
            // AuthenticationService) to avoid an identity↔authentication import cycle;
            // best-effort so it never blocks the sign-in redirect.
            // if (identity.actorId) {
            //     try {
            //         await this.actorsRepository.ensureOidcAvatar(identity.actorId);
            //     } catch {
            //         /* avatar capture is best-effort */
            //     }
            // }

            return html;
        } catch (err) {
            const code = query.error ?? (err instanceof Error ? err.message : 'oidc_failed');
            await this.sessionActivity.recordFactorFailure({
                identifier: query.state ?? code,
                factorType: 'oidc',
                lastReason: code,
            });
            // We don't know the SPA's redirect_after here — the state record may already be gone
            // (expired/missing) or never existed (IdP rejected before we could read it). Fall back
            // to the configured SPA base URL so the user lands on the demo's callback page with
            // an actionable error rather than raw 4xx JSON on the API host.
            const target = new URL(`${this.options.spaBaseUrl}/auth/callback`);
            target.searchParams.set('error', code);
            if (query.error_description) target.searchParams.set('error_description', query.error_description);
            const { html } = this.htmlRedirectProvider.getRedirectHtml(target);
            return html;
        }
    }

    private async provisionOidcNewUser(
        authorizationId: string,
        profile: { email?: string; emailVerified?: boolean },
    ): Promise<{ actorId: string; factorId: string; isNewUser: true }> {
        const actor = await this.actorsRepository.create('user');

        // The IdP already verified the email; we mirror that into our email-factor table so
        // future flows that look up by email (auto-link, magic link) can find this account.
        // We skip if the IdP didn't return a verified email — better to leave the user
        // OIDC-only than to claim ownership of an unverified address.
        if (profile.email && profile.emailVerified) {
            try {
                await this.emailFactorRepository.createFactor(actor.id, profile.email);
            } catch {
                // Unique-constraint collision: another account already owns this email.
                // The package's auto-link path should have caught this; if we still got
                // here it means the email factor was added between begin/complete. Bail
                // out rather than silently creating an orphaned account.
                throw httpError(409);
            }
        }

        const factor = await this.oidcFactorService.createFactorFromAuthorization(actor.id, authorizationId);
        return { actorId: actor.id, factorId: factor.id, isNewUser: true };
    }
}
