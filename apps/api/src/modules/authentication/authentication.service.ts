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
    CodeAuthenticationLoginStart,
    CodeAuthenticationRequest,
    EnrollmentRequiredResponse,
    FactorChallengeEmailStart,
    FactorChallengeEmailStartResponse,
    FactorChallengeFidoStart,
    FactorChallengeFidoStartResponse,
    FactorChallengeStartRequest,
    FactorChallengeStartResponse,
    FidoAuthenticationLoginStart,
    FidoAuthenticationLoginStartResponse,
    FidoAuthenticationRequest,
    LinkAuthenticationLoginStart,
    LinkAuthenticationRequest,
    MfaRequiredResponse,
    OidcAuthenticationLoginStart,
    OidcAuthenticationRequest,
    OidcLoginCallback,
    OidcProviderSummary,
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
import { PermissionsService } from '#modules/permissions/permissions.service.js';
import { PLATFORM_NAMESPACE, PLATFORM_OBJECT_ID } from '#modules/permissions/platform.roles.js';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { OidcSignInRefused } from './oidc.sign.in.refused.js';
import { allowlistAdmits, resolveSigninAllowlist, resolveSigninProviders } from './signin.settings.js';
import { safeRedirectPath } from './redirect.after.js';
import {
    AuthenticationSession,
    AuthenticationSessionFactor,
    AuthenticationSessionService,
    AuthenticatorFactorService,
    AuthMfaRequiredPolicyFactor,
    EmailFactorRepository,
    EmailFactorService,
    EmailFactorServiceOptions,
    FidoFactorService,
    HtmlRedirectProvider,
    MfaChallengeService,
    MfaOrchestrator,
    OidcFactorService,
    PasswordFactorService,
    PasswordHashProvider,
    PkceProvider,
    TargetActor,
} from '@maroonedsoftware/authentication';
import { randomBytes } from 'node:crypto';
import { DateTime, Duration } from 'luxon';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { SessionActivityService } from './session.activity.service.js';
import { RequestCookieJar } from './request.cookie.jar.js';
import { ResponseCookieJar } from './response.cookie.jar.js';
import { MailService } from '#modules/mail/mail.service.js';
import { expirationMinutes } from '#modules/mail/mail.expiry.js';
import { SignInMailLimiter } from './sign.in.mail.limiter.js';

// Internal-handler unions: camelCase pre-transform shape (matches the `z.input` side of the
// `format(output=snake)` schemas). The public methods `requestToken` and `startFactorChallenge`
// run `parseAndValidate` to flip these to the snake_case wire shape.
type AuthenticationTokenInternal = AuthenticationTokenIssued | MfaRequiredResponse;

/** The factor methods the wire contract admits — deliberately narrower than ServerKit's union. */
type MfaChallengeFactorMethod = MfaRequiredResponse['factors'][number]['method'];
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
        private readonly emailFactorService: EmailFactorService,
        private readonly pkceProvider: PkceProvider,
        private readonly signInMailLimiter: SignInMailLimiter,
        private readonly emailFactorServiceOptions: EmailFactorServiceOptions,
        private readonly mailService: MailService,
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
        private readonly permissionsService: PermissionsService,
        private readonly config: AppConfig,
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
        this.authenticateHandlerMap.set('link', {
            authenticate: (request: BaseAuthenticationRequest) => this.handleLink(request as LinkAuthenticationRequest),
            startLogin: (request: BaseAuthenticationLoginStart) => this.handleLinkStartLogin(request as LinkAuthenticationLoginStart),
        });
        this.authenticateHandlerMap.set('code', {
            authenticate: (request: BaseAuthenticationRequest) => this.handleCode(request as CodeAuthenticationRequest),
            startLogin: (request: BaseAuthenticationLoginStart) => this.handleCodeStartLogin(request as CodeAuthenticationLoginStart),
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
                case 'email':
                    return this.startEmailFactorChallenge(request);
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
            // ServerKit v5 widened AuthenticationFactorMethod with 'apikey', which is a
            // machine credential rather than an enrolled factor. It can never reach an
            // MFA challenge, and the wire contract has no arm for it, so narrow here
            // rather than widening the contract to a value the SPA must never see.
            factors: result.challenge.eligibleFactors
                .filter((f): f is typeof f & { method: MfaChallengeFactorMethod } => f.method !== 'apikey')
                .map(f => ({
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
            const token = await this.sessionService.refreshSession(refreshToken, undefined, session => this.refuseIfSubjectIsGone(session));
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
     * Runs as `refreshSession`'s guard: after the token has been verified and its `jti` claimed, and
     * before anything is minted, so replay detection and family revocation stay in the session
     * service and this sees only a session that grant has already accepted. It used to peek the
     * token first with `lookupSessionFromJwt`, which since @maroonedsoftware/authentication 6
     * refuses a refresh token outright; the peek would have failed on every call, been swallowed,
     * and silently stopped checking anything.
     */
    private async refuseIfSubjectIsGone(session: AuthenticationSession): Promise<void> {
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

    /**
     * Start a passwordless sign-in by emailing a link.
     *
     * The link goes to the console rather than to a route here, and carries the challenge id beside
     * the token. Both halves are needed: the token is the one-time secret and the challenge id is
     * what it is bound to, which is what makes a link that crosses devices work — somebody opening
     * their mail on a phone and finishing on a laptop has no per-device verifier to resolve it from.
     */
    private async handleLinkStartLogin(request: LinkAuthenticationLoginStart): Promise<AuthenticationLoginStartResponse> {
        await this.signInMailLimiter.consume(request.email);
        this.mailService.assertConfigured();

        const factor = await this.emailFactorRepository.findFactor(request.email);
        if (!factor || !factor.active) {
            return this.unknownAddressAnswer('link', this.emailFactorServiceOptions.magiclinkExpiration);
        }

        const challenge = await this.emailFactorService.issueEmailChallenge(factor.actorId, factor.id, 'magiclink');

        const link = new URL(`${this.spaBaseUrl()}/auth/callback`);
        link.searchParams.set('token', challenge.code);
        link.searchParams.set('challenge_id', challenge.challengeId);

        await this.mailService.send({
            to: request.email,
            template: 'SignInLink',
            data: { link: link.toString(), minutes: expirationMinutes(this.emailFactorServiceOptions.magiclinkExpiration) },
        });

        return { grant_type: 'link', challengeId: challenge.challengeId, expiresAt: challenge.expiresAt };
    }

    /**
     * Start a passwordless sign-in by emailing a code.
     *
     * The caller's PKCE `code_challenge` is stashed against the email challenge id, so the code
     * that arrives can only be spent by the device that asked for it. That is the difference
     * between this and the link: a code is short enough to read aloud down a phone line, so it
     * needs a second thing the caller has, where a 43-character link token is the secret itself.
     */
    private async handleCodeStartLogin(request: CodeAuthenticationLoginStart): Promise<AuthenticationLoginStartResponse> {
        await this.signInMailLimiter.consume(request.email);
        this.mailService.assertConfigured();

        const factor = await this.emailFactorRepository.findFactor(request.email);
        if (!factor || !factor.active) {
            // The client-supplied `code_challenge` is dropped rather than stashed: there is nothing
            // to bind it to, and storing it would leave a Redis key whose presence answers the same
            // question this branch exists to refuse.
            return this.unknownAddressAnswer('code', this.emailFactorServiceOptions.otpExpiration);
        }

        const challenge = await this.emailFactorService.issueEmailChallenge(factor.actorId, factor.id, 'code');

        await this.pkceProvider.storeChallenge(request.code_challenge, challenge.challengeId, this.emailFactorServiceOptions.otpExpiration);

        await this.mailService.send({
            to: request.email,
            template: 'SignInCode',
            data: { code: challenge.code, minutes: expirationMinutes(this.emailFactorServiceOptions.otpExpiration) },
        });

        return { grant_type: 'code', challengeId: challenge.challengeId, expiresAt: challenge.expiresAt };
    }

    /**
     * What `/auth/login/start` answers for an address with no active account.
     *
     * Indistinguishable from the real answer, on purpose. The id is the same 32 random bytes the
     * factor service mints, and the expiry is computed from now rather than echoed from a stored
     * challenge — echoing is a second oracle, because a pending challenge's expiry is in the past
     * relative to `now + TTL` and two requests would tell the two apart.
     *
     * This route is unauthenticated and takes an arbitrary address, so without this it is a public
     * "does this person have an account here" endpoint.
     */
    private unknownAddressAnswer(grantType: 'link' | 'code', expiration: Duration): AuthenticationLoginStartResponse {
        return {
            grant_type: grantType,
            challengeId: randomBytes(32).toString('base64url'),
            expiresAt: DateTime.utc().plus(expiration),
        };
    }

    /**
     * Finish a magic-link sign-in.
     *
     * The token is the one-time bearer and the challenge id is what binds it, so a link lifted out
     * of a forwarded message without the id it was issued with is useless. No PKCE, deliberately:
     * email links cross devices constantly, and a stashed verifier would not be on the machine that
     * finishes.
     */
    private async handleLink(request: LinkAuthenticationRequest): Promise<AuthenticationTokenInternal> {
        // `'magiclink'` is the method the challenge must have been issued under. Without it, a
        // six-digit OTP issued for the code flow could be redeemed through this route, which takes
        // an arbitrary `link` string and so would accept five guesses at six digits.
        const verified = await this.emailFactorService.verifyEmailChallenge(request.challenge_id, request.link, 'magiclink');

        const now = DateTime.utc();
        // Through `issueOrChallenge`, so an account with an authenticator enrolled still has to
        // produce it: a link proves the inbox, which is one factor and not two. The policy already
        // declines to offer the same email factor as its own second step.
        return await this.issueOrChallenge({
            actor: { kind: 'user', actorId: verified.actorId },
            primaryFactor: { issuedAt: now, authenticatedAt: now, method: 'email', methodId: verified.id, kind: 'possession' },
        });
    }

    /**
     * Where the console lives, refused rather than guessed at when nothing set it.
     *
     * An unset `SPA_BASE_URL` would make `new URL()` throw on a relative path, which surfaces as a
     * 500 with no explanation halfway through a sign-in. Said plainly here instead, and internally
     * so the operator reads it in the log rather than an anonymous caller reading it in a response.
     */
    private spaBaseUrl(): string {
        const base = this.options.spaBaseUrl.trim();
        if (base.length === 0) {
            throw httpError(500).withInternalDetails({ spaBaseUrl: 'SPA_BASE_URL is not set, so a sign-in link cannot be addressed' });
        }
        return base.replace(/\/$/, '');
    }

    /**
     * The one-time code grant, which serves two flows that share nothing but a six-digit field.
     *
     * With `mfa_challenge_id` it completes a pending MFA round: the password (or whatever was
     * primary) is already proved, and the code proves the inbox. With `code_verifier` it IS the
     * sign-in — no password at all — and PKCE is what binds the code back to the device that asked
     * for it. Exactly one of the two, because they are different claims about who is asking and a
     * request carrying both is a request that has answered neither.
     */
    private async handleCode(request: CodeAuthenticationRequest): Promise<AuthenticationTokenInternal> {
        const hasMfa = request.mfa_challenge_id !== undefined;
        const hasPkce = request.code_verifier !== undefined;
        if (hasMfa === hasPkce) {
            throw httpError(400).withDetails({ binding: 'exactly one of code_verifier or mfa_challenge_id must be set' });
        }
        if (hasMfa && request.challenge_id === undefined) {
            // The MFA arm has no verifier to resolve the email challenge from, so the caller has to
            // name it — it is the id `POST /auth/factors/start` just answered with.
            throw httpError(400).withDetails({ binding: 'challenge_id is required when mfa_challenge_id is set' });
        }

        return hasMfa ? await this.completeMfaWithCode(request) : await this.signInWithCode(request);
    }

    /** The second half of a sign-in that stopped at `mfa_required`, satisfied by an emailed code. */
    private async completeMfaWithCode(request: CodeAuthenticationRequest): Promise<AuthenticationTokenInternal> {
        const mfaChallengeId = request.mfa_challenge_id!;
        const challengeId = request.challenge_id!;

        // Eligibility is checked here rather than left to the orchestrator, for the reason
        // `handleAuthenticator` states and one more. `completeMfa` verifies the proof BEFORE it
        // checks the factor against the challenge's eligible list, and verifying an email challenge
        // consumes it — so a challenge id from one round could be spent against another round that
        // never offered email, burning the operator's code on a request that then fails anyway.
        const mfa = await this.mfaChallengeService.peek(mfaChallengeId);
        if (!mfa) {
            throw unauthorizedError('Bearer error="invalid_challenge"');
        }
        if (!mfa.eligibleFactors.some(f => f.method === 'email')) {
            throw unauthorizedError('Bearer error="invalid_factor"');
        }

        try {
            const result = await this.mfaOrchestrator.completeMfa<ActorType>(mfaChallengeId, {
                method: 'email',
                challengeId,
                code: request.code,
                // The method the challenge must have been issued under. Without it a magic-link
                // token issued for a passwordless sign-in could be redeemed here as if it were an
                // MFA code — a different flow, a different proof, and a 30-minute window rather
                // than a 10-minute one.
                issueMethod: 'code',
            });
            return await this.issueTokenFor(result.actor, [result.primaryFactor, result.secondaryFactor]);
        } catch (error) {
            await this.recordEmailFactorFailure(mfa.actor.actorId, error);
            throw error;
        }
    }

    /** A whole sign-in on an emailed code, with PKCE standing in for a password. */
    private async signInWithCode(request: CodeAuthenticationRequest): Promise<AuthenticationTokenInternal> {
        const codeVerifier = request.code_verifier!;

        // The verifier resolves to the challenge id stashed at `/auth/login/start`, which is what
        // proves this request comes from the device that asked for the code. A `challenge_id` in
        // the body is ignored here on purpose: honouring it would let anyone who intercepted a code
        // complete the sign-in from their own device.
        const challengeId = await this.pkceProvider.getVerifier(codeVerifier);
        if (!challengeId) {
            throw unauthorizedError('Bearer error="invalid_grant"');
        }

        let verified;
        try {
            verified = await this.emailFactorService.verifyEmailChallenge(challengeId, request.code, 'code');
        } catch (error) {
            await this.recordEmailFactorFailure(undefined, error);
            throw error;
        }

        await this.pkceProvider.deleteVerifier(codeVerifier);

        const now = DateTime.utc();
        // Through `issueOrChallenge` rather than straight to a token: an emailed code is a PRIMARY
        // factor here, so an account with an authenticator enrolled still has to produce it. The
        // policy already declines to offer the same email factor as its own second step.
        return await this.issueOrChallenge({
            actor: { kind: 'user', actorId: verified.actorId },
            primaryFactor: { issuedAt: now, authenticatedAt: now, method: 'email', methodId: verified.id, kind: 'possession' },
        });
    }

    /**
     * Record a refused code the way the password path records a refused password.
     *
     * Only the verdicts that are about the CODE. A 503 from an unconfigured mailer or a driver
     * throw is not somebody failing a factor, and counting it as one would fill the operator's
     * activity feed with their own infrastructure.
     */
    private async recordEmailFactorFailure(actorId: string | undefined, error: unknown): Promise<void> {
        if (!IsHttpError(error) || error.statusCode >= 500) return;
        await this.sessionActivity.recordFactorFailure({
            identifier: actorId ?? 'unknown',
            factorType: 'email',
            actorId: actorId ?? null,
            lastReason: error.statusCode === 429 ? 'too_many_attempts' : 'invalid_code',
        });
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
        const redirectAfter = safeRedirectPath(request.redirect_after);
        const { url, state, expiresAt } = await this.oidcFactorService.beginAuthorization({
            provider: request.provider,
            intent: 'sign-in',
            ...(redirectAfter === undefined ? {} : { redirectAfter }),
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

    /**
     * Issue and deliver the one-time code for an email factor on a pending MFA round.
     *
     * Always a code, never a magic link. A link token is 43 base64url characters and the `code`
     * grant that redeems an MFA challenge takes `code(min=6, max=10)`, so a link cannot complete a
     * round even if one were sent — which is why `issueMethod` came off the contract rather than
     * being defaulted here.
     */
    private async startEmailFactorChallenge(request: FactorChallengeEmailStart): Promise<FactorChallengeStartInternal> {
        const mfa = await this.mfaChallengeService.peek(request.mfa_challenge_id);
        if (!mfa) {
            throw unauthorizedError('Bearer error="invalid_challenge"');
        }
        const emailFactor = mfa.eligibleFactors.find(f => f.method === 'email');
        if (!emailFactor) {
            throw httpError(404).withDetails({ method: 'email factor not enrolled' });
        }

        // Before issuing, not after. `issueEmailChallenge` is idempotent per actor, factor and
        // method for the life of the challenge, so a code issued and then not delivered leaves the
        // operator waiting ten minutes for a message that is never coming while every retry hands
        // back the same unsent code. Refusing first leaves nothing behind to get stuck on.
        this.mailService.assertConfigured();

        const issued = await this.mfaOrchestrator.issueFactorChallenge(request.mfa_challenge_id, {
            method: 'email',
            methodId: emailFactor.methodId,
            issueMethod: 'code',
        });
        if (issued.method !== 'email') {
            throw httpError(500).withInternalDetails({ method: `orchestrator answered ${issued.method} for an email challenge` });
        }

        // Sent on every call, including one the orchestrator reports as `alreadyIssued`. That flag
        // means the code is unchanged, not that it arrived — and the caller here is the operator
        // pressing "send it again" because it did not. Re-sending an identical code costs them a
        // duplicate in the inbox; suppressing it costs them the sign-in. This is safe to repeat in
        // a way registration is not: the round is already bound to a challenge somebody proved a
        // password against, so it cannot be aimed at an address by a stranger.
        await this.mailService.send({
            to: issued.emailAddress,
            template: 'SignInCode',
            data: { code: issued.code, minutes: expirationMinutes(this.emailFactorServiceOptions.otpExpiration) },
        });

        return {
            method: 'email',
            emailChallengeId: issued.challengeId,
            expiresAt: issued.expiresAt,
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

    /**
     * The identity providers the sign-in page offers, by name and button, in the operator's order.
     *
     * Read from the same list and through the same resolver the registry's source uses, so a row
     * the station cannot sign in through is not offered as a button either. Secrets are never read
     * here: a button needs a name and a label.
     */
    async listOidcProviders(): Promise<OidcProviderSummary[]> {
        return resolveSigninProviders(this.config, () => '').map(provider => ({ name: provider.name, label: provider.label }));
    }

    /**
     * Where an identity provider sends the browser back to. Completes the authorization, resolves
     * it to an account, and answers an HTML page that hands the console a one-time exchange id.
     *
     * An identity already linked to an account, or one the library auto-linked because the provider
     * vouched for an address an account already holds, signs in as that account. Anything else is a
     * NEW account, which {@link provisionOidcNewUser} creates only for an address the allowlist
     * names. Every refusal lands the browser on the console's callback page with a code and a
     * sentence, never on raw JSON from the API, and never with an exception's own message in the URL.
     */
    async handleOidcCallback(query: OidcLoginCallback): Promise<string> {
        try {
            const result = await this.oidcFactorService.completeAuthorization({ params: query });

            // A link started from Security by somebody already signed in: the identity is now on
            // their account, and there is nothing to sign in. Back to Security, which says so.
            if (result.intent === 'link') {
                const linked = new URL(`${this.options.spaBaseUrl}/settings/security`);
                linked.searchParams.set('linked', result.profile.provider);
                return this.htmlRedirectProvider.getRedirectHtml(linked).html;
            }

            const identity =
                result.kind === 'new-user'
                    ? await this.provisionOidcNewUser(result.authorizationId, result.profile, result.emailConflict !== undefined)
                    : { actorId: result.actorId, factorId: result.factorId, isNewUser: false };

            const exchangeId = await this.oidcFactorService.stashAuthenticatedExchange({
                actorId: identity.actorId,
                factorId: identity.factorId,
                isNewUser: identity.isNewUser,
            });

            const target = new URL(`${this.options.spaBaseUrl}/auth/callback`);
            target.searchParams.set('token', `oidc:${exchangeId}`);
            // A path, checked again here although it was checked when the sign-in began, because the
            // state that carried it came back through somebody else's server.
            const redirect = safeRedirectPath(result.redirectAfter);
            if (redirect !== undefined) target.searchParams.set('redirect', redirect);
            if (identity.isNewUser) target.searchParams.set('is_new_user', 'true');

            return this.htmlRedirectProvider.getRedirectHtml(target).html;
        } catch (err) {
            const refusal = err instanceof OidcSignInRefused ? err : isLinkTaken(err) ? new OidcSignInRefused('already_linked') : undefined;
            const code = refusal?.code ?? (query.error ? 'provider_error' : 'oidc_failed');
            await this.sessionActivity.recordFactorFailure({
                identifier: query.state ?? code,
                factorType: 'oidc',
                lastReason: query.error ?? (err instanceof Error ? err.message : code),
            });
            // We don't know the SPA's redirect_after here — the state record may already be gone
            // (expired/missing) or never existed (IdP rejected before we could read it). Fall back
            // to the configured SPA base URL so the user lands on the console's callback page with
            // an actionable error rather than raw 4xx JSON on the API host.
            // Only a link can find the identity taken, and the person linking is signed in: they
            // go back to Security rather than to a sign-in page telling them they are not.
            if (refusal?.code === 'already_linked') {
                const security = new URL(`${this.options.spaBaseUrl}/settings/security`);
                security.searchParams.set('link_error', refusal.code);
                return this.htmlRedirectProvider.getRedirectHtml(security).html;
            }
            const target = new URL(`${this.options.spaBaseUrl}/auth/callback`);
            target.searchParams.set('error', code);
            const description =
                refusal?.description ?? query.error_description ?? 'Could not finish signing you in through that provider. Try again.';
            target.searchParams.set('error_description', description);
            return this.htmlRedirectProvider.getRedirectHtml(target).html;
        }
    }

    /**
     * An account for somebody signing in through a provider for the first time, if they may have one.
     *
     * Two refusals come first, before anything is written. `emailConflict` means an account with
     * this address exists but the provider does not call the address verified: creating a second
     * account would shadow the first, and linking to it would hand it over on the provider's word
     * alone. Then the allowlist (`signin.allowlist`), checked against the address only when the
     * provider vouches for it, since an unverified address is whatever the person typed there.
     *
     * An admitted identity gets an account holding the `listener` role and nothing more: it can
     * hear the station and read the console, and an administrator decides the rest. Its verified
     * address becomes an email factor too, so a later auto-link or emailed sign-in finds it.
     */
    private async provisionOidcNewUser(
        authorizationId: string,
        profile: { email?: string; emailVerified?: boolean },
        emailConflict: boolean,
    ): Promise<{ actorId: string; factorId: string; isNewUser: true }> {
        if (emailConflict) throw new OidcSignInRefused('email_unverified');

        const verifiedEmail = profile.emailVerified === true ? profile.email : undefined;
        if (!allowlistAdmits(resolveSigninAllowlist(this.config), verifiedEmail)) throw new OidcSignInRefused('not_allowed');

        const actor = await this.actorsRepository.create('user');

        if (verifiedEmail) {
            try {
                await this.emailFactorRepository.createFactor(actor.id, verifiedEmail);
            } catch {
                // Unique-constraint collision: another account already owns this email.
                // The package's auto-link path should have caught this; if we still got
                // here it means the email factor was added between begin/complete. Bail
                // out rather than silently creating an orphaned account.
                throw httpError(409);
            }
        }

        const factor = await this.oidcFactorService.createFactorFromAuthorization(actor.id, authorizationId);

        // The one role a newcomer gets. `createdBy` is the new account itself, as onboarding's grant
        // is: nobody signed in performed it.
        await this.permissionsService.writeDirect(
            [
                {
                    object: { namespace: PLATFORM_NAMESPACE, id: PLATFORM_OBJECT_ID },
                    relation: 'listener',
                    subject: { kind: 'concrete', namespace: 'user', id: actor.id },
                },
            ],
            actor.id,
        );

        return { actorId: actor.id, factorId: factor.id, isNewUser: true };
    }
}

/**
 * The library's answer to linking an identity that already belongs to another account: a 409 whose
 * details name the provider. Told apart from this file's own 409 (an email factor collision) by
 * those details.
 */
function isLinkTaken(error: unknown): boolean {
    return IsHttpError(error) && error.statusCode === 409 && typeof error.details?.['provider'] === 'string';
}
