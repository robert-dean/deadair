import { Injectable } from 'injectkit';
import {
    AuthenticationRegistration,
    AuthenticationRegistrationInput,
    AuthenticationRegistrationVerification,
    AuthenticationToken,
} from './types/authentication.types.js';
import {
    AuthenticationFactorMethod,
    AuthenticationSessionFactor,
    AuthenticationSessionService,
    AuthenticatorFactorService,
    EmailFactorService,
    EmailFactorServiceOptions,
    FidoFactorService,
    PasswordFactorService,
    PkceProvider,
} from '@maroonedsoftware/authentication';
import { ActorsRepository } from '#modules/authentication/repositories/actors.repository.js';
import { DateTime, Duration } from 'luxon';
import { parseAndValidate } from '@maroonedsoftware/zod';
import {
    AuthenticationFactorRegistration,
    AuthenticationFactorRegistrationResponse,
    AuthenticationFactorRegistrationVerification,
    AuthenticatorFactorRegistration,
    AuthenticatorFactorRegistrationResponse,
    AuthenticatorFactorRegistrationVerification,
    EmailFactorRegistration,
    EmailFactorRegistrationResponse,
    EmailFactorRegistrationVerification,
    FidoFactorRegistration,
    FidoFactorRegistrationResponse,
    FidoFactorRegistrationVerification,
    PasswordFactorRegistration,
    PasswordFactorRegistrationResponse,
} from './types/registration.types.js';
import { httpError, unauthorizedError } from '@maroonedsoftware/errors';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { CacheProvider } from '@maroonedsoftware/cache';
import { PolicyService } from '@maroonedsoftware/policies';
import { SessionActivityService } from './session.activity.service.js';
import { MailService } from '#modules/mail/mail.service.js';
import { SignInMailLimiter } from './sign.in.mail.limiter.js';
import { expirationMinutes } from '#modules/mail/mail.expiry.js';

type RegisterFactorHandler = (actorId: string, request: AuthenticationFactorRegistration) => Promise<AuthenticationFactorRegistrationResponse>;
type VerifyFactorRegistrationHandler = (
    actorId: string,
    request: AuthenticationFactorRegistrationVerification,
) => Promise<AuthenticationSessionFactor>;

type RegistrationPayload = {
    registrationId: string;
    actorId: string;
};

type FactorHandlers = {
    registerFactor?: RegisterFactorHandler;
    verifyFactorRegistration?: VerifyFactorRegistrationHandler;
};

@Injectable()
export class AuthenticationRegistrationService {
    private readonly factorHandlerMap: Map<AuthenticationFactorMethod, FactorHandlers>;

    constructor(
        private readonly sessionService: AuthenticationSessionService,
        private readonly actorsRepository: ActorsRepository,
        private readonly emailFactorService: EmailFactorService,
        private readonly emailFactorServiceOptions: EmailFactorServiceOptions,
        private readonly mailService: MailService,
        private readonly signInMailLimiter: SignInMailLimiter,
        private readonly passwordFactorService: PasswordFactorService,
        private readonly authenticatorFactorService: AuthenticatorFactorService,
        private readonly fidoFactorService: FidoFactorService,
        private readonly policyService: PolicyService,
        private readonly authorizationContext: AuthorizationContext,
        private readonly cacheProvider: CacheProvider,
        private readonly pkceProvider: PkceProvider,
        private readonly sessionActivity: SessionActivityService,
    ) {
        this.factorHandlerMap = new Map<AuthenticationFactorMethod, FactorHandlers>();
        this.factorHandlerMap.set('password', {
            registerFactor: (actorId: string, request: AuthenticationFactorRegistration) =>
                this.registerPasswordFactor(actorId, request as PasswordFactorRegistration),
        });
        this.factorHandlerMap.set('email', {
            registerFactor: (actorId: string, request: AuthenticationFactorRegistration) =>
                this.registerEmailFactor(actorId, request as EmailFactorRegistration),
            verifyFactorRegistration: (actorId: string, request: AuthenticationFactorRegistrationVerification) =>
                this.verifyEmailFactorRegistration(actorId, request as EmailFactorRegistrationVerification),
        });
        this.factorHandlerMap.set('authenticator', {
            registerFactor: (actorId: string, request: AuthenticationFactorRegistration) =>
                this.registerAuthenticatorFactor(actorId, request as AuthenticatorFactorRegistration),
            verifyFactorRegistration: (actorId: string, request: AuthenticationFactorRegistrationVerification) =>
                this.verifyAuthenticatorFactorRegistration(actorId, request as AuthenticatorFactorRegistrationVerification),
        });
        this.factorHandlerMap.set('fido', {
            registerFactor: (actorId: string, request: AuthenticationFactorRegistration) =>
                this.registerFidoFactor(actorId, request as FidoFactorRegistration),
            verifyFactorRegistration: (actorId: string, request: AuthenticationFactorRegistrationVerification) =>
                this.verifyFidoFactorRegistration(actorId, request as FidoFactorRegistrationVerification),
        });
    }

    private getRegistrationKey(key: string) {
        return `authentication:registration:${key}`;
    }

    private async lookupRegistration(registrationId: string) {
        const response = await this.cacheProvider.get(this.getRegistrationKey(registrationId));
        return response ? (JSON.parse(response) as RegistrationPayload) : undefined;
    }

    private async lookupRegistrationByValue(actorId: string, method: AuthenticationFactorMethod) {
        const registrationId = await this.cacheProvider.get(this.getRegistrationKey(`${actorId}:${method}`));
        return registrationId ? await this.lookupRegistration(registrationId) : undefined;
    }

    private async cacheRegistration(actorId: string, registrationId: string, method: AuthenticationFactorMethod, expiration: Duration) {
        const payload: RegistrationPayload = {
            registrationId,
            actorId,
        };
        await this.cacheProvider.set(this.getRegistrationKey(registrationId), JSON.stringify(payload), expiration);
        await this.cacheProvider.set(this.getRegistrationKey(`${actorId}:${method}`), registrationId, expiration);
    }

    private async deleteRegistration(actorId: string, registrationId: string, method: AuthenticationFactorMethod) {
        await this.cacheProvider.delete(this.getRegistrationKey(registrationId));
        await this.cacheProvider.delete(this.getRegistrationKey(`${actorId}:${method}`));
    }

    // Creates a login without the email round-trip — the account is trusted because
    // the caller has already established it may exist (onboarding proves no admin is
    // present yet). Deliberately grants nothing: the caller owns whatever platform
    // role the new actor should hold, and mints it against the returned actor id.
    async bootstrapLogin(request: Required<AuthenticationRegistrationInput>) {
        await this.passwordFactorService.ensurePasswordStrength(request.password);

        const actor = await this.actorsRepository.create('user');

        await this.emailFactorService.createFactor(actor.id, request.email);

        await this.passwordFactorService.createPasswordFactor(actor.id, request.password);

        return actor;
    }

    /**
     * Register a whole login: an address, optionally a password, and the code that confirms the
     * address is real.
     *
     * Asserts mail is configured for the reason {@link registerEmailFactor} does — a registration
     * cached against a send that then failed hands the same undelivered code back for ten minutes —
     * but unlike that one it still SUPPRESSES the send on a repeat, and the difference is the route
     * rather than an inconsistency. This one takes no session, so a repeat is somebody typing an
     * address that is not theirs, and one message per address per registration window is a tighter
     * bound than any limiter. Enrolment is behind a session and has a "send it again" button, so it
     * resends and pays for that with the address limiter instead.
     */
    async registerLogin(request: AuthenticationRegistrationInput): Promise<AuthenticationRegistration> {
        this.mailService.assertConfigured();

        if (request.password) {
            await this.passwordFactorService.ensurePasswordStrength(request.password);
        }

        const result = await this.emailFactorService.registerEmailFactor(request.email, 'code');

        if (request.password) {
            await this.passwordFactorService.registerPasswordFactor(request.password, result.registrationId);
        }

        // Only on a first registration. `registerEmailFactor` is idempotent for the life of the
        // pending registration and hands back the SAME code on a repeat, so a second send would be
        // a second copy of a code the person already has — and a resend they did not ask for is how
        // an unauthenticated endpoint becomes somebody else's mail bomb.
        if (!result.alreadyRegistered) {
            await this.mailService.send({
                to: request.email,
                template: 'VerifyEmail',
                data: { code: result.code, minutes: expirationMinutes(this.emailFactorServiceOptions.otpExpiration) },
            });
        }

        return await parseAndValidate(
            {
                registrationId: result.registrationId,
                expiresAt: result.expiresAt,
            },
            AuthenticationRegistration,
        );
    }

    async verifyLoginRegistration(request: AuthenticationRegistrationVerification) {
        const factors: AuthenticationSessionFactor[] = [];

        const actor = await this.actorsRepository.create('user');

        const result = await this.emailFactorService.createEmailFactorFromRegistration(actor.id, request.registrationId, request.code);

        factors.push({
            issuedAt: DateTime.utc(),
            authenticatedAt: DateTime.utc(),
            method: 'email',
            methodId: result.id,
            kind: 'possession',
        });

        const pendingPasswordRegistration = await this.passwordFactorService.hasPendingRegistration(request.registrationId);
        if (pendingPasswordRegistration) {
            const passwordFactor = await this.passwordFactorService.createPasswordFactorFromRegistration(actor.id, request.registrationId);
            factors.push({
                issuedAt: DateTime.utc(),
                authenticatedAt: DateTime.utc(),
                method: 'password',
                methodId: passwordFactor.id,
                kind: 'knowledge',
            });
        }

        const session = await this.sessionService.createSession(
            actor.id,
            { actorType: 'user', ...this.sessionActivity.buildLoginContextClaims() },
            factors,
        );

        const authToken = await this.sessionService.issueTokenForSession(session.sessionToken);

        const primary = factors[0];
        if (primary) {
            await this.sessionActivity.recordLoginSuccess({
                actorId: actor.id,
                sessionToken: session.sessionToken,
                factorType: primary.method,
                factorId: primary.methodId,
                mfaSatisfied: factors.length > 1,
            });
        }

        return await parseAndValidate(authToken, AuthenticationToken);
    }

    async registerFactor(request: AuthenticationFactorRegistration): Promise<AuthenticationFactorRegistrationResponse> {
        const { actorId } = this.authorizationContext.requireAuthentication();

        await this.assertRecentStrongFactorIfAnyEnrolled(actorId);

        const handler = this.factorHandlerMap.get(request.method);
        if (!handler || !handler.registerFactor) {
            throw httpError(400).withDetails({
                method: `Unsupported method ${request.method}`,
            });
        }
        return await parseAndValidate(await handler.registerFactor(actorId, request), AuthenticationFactorRegistrationResponse);
    }

    /**
     * Removes one of the caller's own factors. Only `authenticator` is answered today.
     *
     * Behind the same gate as enrolment: once a strong factor exists, taking one away is as much
     * a change to how the account is protected as adding one, and it is the change a stolen
     * session would want to make. Removing the last authenticator simply turns the sign-in
     * challenge off for the account, which the `mfa.required` rule handles on its own.
     *
     * The step-up denial is thrown as the policy renders it (403, `details.kind:
     * 'step_up_required'`), so the console can open its re-verify dialog and try again.
     */
    async removeFactor(method: AuthenticationFactorMethod, methodId: string): Promise<void> {
        const { actorId } = this.authorizationContext.requireAuthentication();

        if (method !== 'authenticator') {
            throw httpError(400).withDetails({
                method: `Unsupported method ${method}`,
            });
        }

        await this.assertRecentStrongFactorIfAnyEnrolled(actorId);

        // Scoped to the caller: the repository answers only this actor's rows, so somebody else's
        // factor id is indistinguishable from one that never existed.
        const factor = await this.authenticatorFactorService.getFactor(actorId, methodId).catch(() => undefined);
        if (!factor || !factor.active) {
            throw httpError(404).withDetails({
                methodId: 'No such factor',
            });
        }

        await this.authenticatorFactorService.deleteFactor(actorId, methodId);
    }

    // Email, password, and oidc are the bootstrap factors — a login can have only these at
    // registration without ever proving a stronger factor, so we can't require a recent
    // strong-factor verification before binding the first one (chicken-and-egg). Email is
    // `kind: 'possession'` in the session taxonomy but treated as weak here because email control
    // alone is the threat we're hardening against. OIDC is similar: the Google session is the
    // assertion, the SPA can't re-prove it inline without bouncing through the IdP, so it stays
    // bootstrap-tier. Once any non-bootstrap factor is enrolled, every subsequent bind or removal
    // requires recent re-verification by something other than email/password/oidc.
    private async assertRecentStrongFactorIfAnyEnrolled(actorId: string): Promise<void> {
        const factors = await this.actorsRepository.listFactors(actorId, true);
        const isBootstrap = (method: string): boolean => method === 'email' || method === 'password' || method === 'oidc';
        if (!factors.every(factor => isBootstrap(factor.method))) {
            await this.policyService.assert('auth.session.recent.factor', {
                within: Duration.fromDurationLike({ minutes: 5 }),
                excludeMethods: ['email', 'password', 'oidc'],
            });
        }
    }

    async verifyFactorRegistration(request: AuthenticationFactorRegistrationVerification) {
        const { actorId, sessionToken } = this.authorizationContext.requireAuthentication();
        const actorType = this.authorizationContext.actor.kind;
        const handler = this.factorHandlerMap.get(request.method);
        if (!handler || !handler.verifyFactorRegistration) {
            throw httpError(400).withDetails({
                method: `Unsupported method ${request.method}`,
            });
        }

        const factor = await handler.verifyFactorRegistration(actorId, request);

        const session = await this.sessionService.createOrUpdateSession(sessionToken, actorId, { actorType }, factor);

        const authToken = await this.sessionService.issueTokenForSession(session.sessionToken);

        return await parseAndValidate(authToken, AuthenticationToken);
    }

    private async registerPasswordFactor(actorId: string, request: PasswordFactorRegistration): Promise<PasswordFactorRegistrationResponse> {
        const passwordFactor = await this.passwordFactorService.createPasswordFactor(actorId, request.value);
        return {
            method: 'password',
            needsReset: passwordFactor.needsReset,
        };
    }

    /**
     * Begin binding an email address to the account: cache a pending registration and mail the code
     * that proves the operator can read the inbox.
     *
     * Shaped like `handleCodeStartLogin` rather than like its own thing, because the three things
     * that path does in front of the send are the three this one needs and did not have. This was
     * the last email path written before the station could send at all.
     *
     * **The address is rate-limited first.** Enrolment takes a session where `/auth/login/start`
     * does not, so the caller is known — but the address is not, and the harm is to whoever owns
     * the one that gets typed. An operator can name any address, so a shell loop against this route
     * fills a stranger's inbox exactly as well as one against the anonymous route does.
     *
     * **Then mail is asserted configured, BEFORE anything is issued.** `registerEmailFactor`
     * upstream is idempotent for the length of the registration: a second call inside the window
     * returns the FIRST call's code and reports `alreadyRegistered`. So a send that failed after
     * the registration was cached cannot be retried into a delivery — every later attempt hands
     * back the same code that was never sent. Asserting first is what keeps a station with no mail
     * server from writing a ten-minute dead registration on the operator's first attempt, which is
     * the attempt they make just before they go and configure one.
     *
     * **And the send is unconditional**, where it used to be skipped on `alreadyRegistered`. That
     * flag is upstream's hint for suppressing a duplicate "we just emailed you" notification, and
     * reading it as "do not send" makes the console's "Send it again" answer 200 and do nothing —
     * silence being the one answer somebody waiting on a code cannot tell from success. The code
     * that goes out is the same code, which is the point: the challenge is idempotent, so a resend
     * is a second copy of one message rather than a second credential. `handleCodeStartLogin`
     * ignores the same flag for the same reason, and the limiter above is what bounds the resend.
     */
    private async registerEmailFactor(actorId: string, request: EmailFactorRegistration): Promise<EmailFactorRegistrationResponse> {
        await this.signInMailLimiter.consume(request.value);
        this.mailService.assertConfigured();

        const registration = await this.lookupRegistrationByValue(actorId, 'email');

        const result = await this.emailFactorService.registerEmailFactor(request.value, 'code', registration?.registrationId);

        await this.cacheRegistration(actorId, result.registrationId, 'email', result.expiresAt.diffNow());

        // Stored on every attempt rather than only on a fresh registration. The cache is keyed by
        // the CHALLENGE and holds the registration id, so a second attempt from a second tab adds
        // its own verifier beside the first rather than overwriting it, and both resolve to the
        // same registration. Skipping this on a repeat was what left that second tab holding a
        // verifier the API had never been told about.
        await this.pkceProvider.storeChallenge(request.codeChallenge, result.registrationId, result.expiresAt.diffNow());

        // Send kept last, after the cache writes: it is the one step here with no undo, so
        // anything that can still fail goes in front of it. A registration cached and then not
        // delivered is a ten-minute wait the operator can end by asking again; a delivered code
        // whose registration failed to cache is a code that verifies against nothing.
        await this.mailService.send({
            to: request.value,
            template: 'VerifyEmail',
            data: { code: result.code, minutes: expirationMinutes(this.emailFactorServiceOptions.otpExpiration) },
        });

        return {
            method: 'email',
            registrationId: result.registrationId,
            expiresAt: result.expiresAt,
            issuedAt: result.issuedAt,
        };
    }

    private async registerAuthenticatorFactor(
        actorId: string,
        request: AuthenticatorFactorRegistration,
    ): Promise<AuthenticatorFactorRegistrationResponse> {
        const result = await this.authenticatorFactorService.registerAuthenticatorFactor(actorId, request.label);

        await this.pkceProvider.storeChallenge(request.codeChallenge, result.registrationId, result.expiresAt.diffNow());
        if (!result.alreadyRegistered) {
            await this.cacheRegistration(actorId, result.registrationId, 'authenticator', result.expiresAt.diffNow());
        }

        return {
            method: 'authenticator',
            registrationId: result.registrationId,
            secret: result.secret,
            uri: result.uri,
            qrCode: result.qrCode,
            expiresAt: result.expiresAt,
            issuedAt: result.issuedAt,
        };
    }

    private async registerFidoFactor(actorId: string, request: FidoFactorRegistration): Promise<FidoFactorRegistrationResponse> {
        const result = await this.fidoFactorService.registerFidoFactor(actorId, {
            userName: actorId,
            userDisplayName: actorId,
            label: request.label,
        });

        return {
            method: 'fido',
            registrationId: result.registrationId,
            expiresAt: result.expiresAt,
            issuedAt: result.issuedAt,
            attestation: result.attestation,
        };
    }

    private async checkRegistration(registrationId: string, actorId: string, codeVerifier?: string) {
        if (codeVerifier) {
            const verifier = await this.pkceProvider.getVerifier(codeVerifier);
            if (!verifier) {
                throw unauthorizedError('Bearer error="invalid_pkce"');
            } else if (registrationId !== verifier) {
                throw httpError(400)
                    .withDetails({
                        registrationId: 'Invalid registration ID',
                    })
                    .withInternalDetails({
                        message: `The registration ID does not match the expected value: ${registrationId} !== ${verifier}`,
                    });
            }
        }

        const registration = await this.lookupRegistration(registrationId);
        if (!registration) {
            throw httpError(400).withDetails({
                registrationId: 'Invalid registration ID',
            });
        }

        if (registration.actorId !== actorId) {
            throw httpError(400)
                .withDetails({
                    registrationId: 'Invalid registration ID',
                })
                .withInternalDetails({
                    message: `The registration ${registrationId} actor ${registration.actorId} does not match the expected value: ${actorId}`,
                });
        }
    }

    private async verifyEmailFactorRegistration(actorId: string, request: EmailFactorRegistrationVerification): Promise<AuthenticationSessionFactor> {
        await this.checkRegistration(request.registrationId, actorId, request.codeVerifier);

        const result = await this.emailFactorService.createEmailFactorFromRegistration(actorId, request.registrationId, request.code);

        await this.pkceProvider.deleteVerifier(request.codeVerifier);
        await this.deleteRegistration(actorId, request.registrationId, 'email');

        return {
            issuedAt: DateTime.utc(),
            authenticatedAt: DateTime.utc(),
            method: 'email',
            methodId: result.id,
            kind: 'possession',
        };
    }

    private async verifyAuthenticatorFactorRegistration(
        actorId: string,
        request: AuthenticatorFactorRegistrationVerification,
    ): Promise<AuthenticationSessionFactor> {
        await this.checkRegistration(request.registrationId, actorId, request.codeVerifier);

        const result = await this.authenticatorFactorService.createAuthenticatorFactorFromRegistration(actorId, request.registrationId, request.code);

        await this.pkceProvider.deleteVerifier(request.codeVerifier);
        await this.deleteRegistration(actorId, request.registrationId, 'authenticator');

        return {
            issuedAt: DateTime.utc(),
            authenticatedAt: DateTime.utc(),
            method: 'authenticator',
            methodId: result.id,
            kind: 'possession',
        };
    }

    private async verifyFidoFactorRegistration(actorId: string, request: FidoFactorRegistrationVerification): Promise<AuthenticationSessionFactor> {
        const result = await this.fidoFactorService.createFidoFactorFromRegistration(actorId, request.registrationId, request.credential);

        return {
            issuedAt: DateTime.utc(),
            authenticatedAt: DateTime.utc(),
            method: 'fido',
            methodId: result.id,
            kind: 'possession',
        };
    }
}
