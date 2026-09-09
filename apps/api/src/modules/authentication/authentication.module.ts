import { Registry } from 'injectkit';
import {
    Argon2idPasswordHashProvider,
    AuthenticationHandlerMap,
    AuthenticationSchemeHandler,
    AuthenticationSessionService,
    AuthenticationSessionServiceOptions,
    AuthenticatorFactorRepository,
    AuthenticatorFactorService,
    AuthenticatorFactorServiceOptions,
    EmailFactorRepository,
    EmailFactorService,
    EmailFactorServiceOptions,
    FidoFactorRepository,
    FidoFactorService,
    FidoFactorServiceOptions,
    HtmlRedirectProvider,
    JwtAuthenticationHandler,
    JwtAuthenticationIssuerMap,
    JwtProvider,
    MfaChallengeService,
    MfaChallengeServiceOptions,
    MfaOrchestrator,
    OidcActorEmailLookup,
    OidcFactorRepository,
    OidcFactorService,
    OidcFactorServiceOptions,
    OidcProviderConfig,
    OidcProviderRegistry,
    OidcProviderRegistryConfig,
    OtpProvider,
    OtpProviderMock,
    PasswordFactorRepository,
    PasswordFactorService,
    PasswordHashProvider,
    PasswordStrengthProvider,
    PhoneFactorRepository,
    PhoneFactorService,
    PhoneFactorServiceOptions,
    PkceProvider,
} from '@maroonedsoftware/authentication';
import { PolicyService } from '@maroonedsoftware/policies';
import { Duration } from 'luxon';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { Redis } from 'ioredis';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { DeadairPasswordFactorRepository } from './repositories/password.factor.repository.js';
import { AuthenticationService } from './authentication.service.js';
import { AuthenticationServiceOptions } from './authentication.options.js';
import { SessionActivityService } from './session.activity.service.js';
import { SessionEventRepository } from './repositories/session.event.repository.js';
import { LoginActivityRepository } from './repositories/login.activity.repository.js';
import { SessionsService } from './sessions.service.js';
import { DeadairEmailFactorRepository } from './repositories/email.factor.repository.js';
import { AuthenticationRegistrationService } from './authentication.registration.service.js';
import { DeadairJwtAuthenticationIssuer } from './issuers/jwt.authentication.issuer.js';
import { DeadairFidoFactorRepository } from './repositories/fido.factor.repository.js';
import { DeadairAuthenticatorFactorRepository } from './repositories/authenticator.factor.repository.js';
import { DeadairOidcFactorRepository } from './repositories/oidc.factor.repository.js';
import { DeadairOidcActorEmailLookup } from './oidc.actor.email.lookup.js';
import { CacheProvider } from '@maroonedsoftware/cache';
import { DeadairPhoneFactorRepository } from './repositories/phone.factor.repository.js';
import { ActorsRepository } from './repositories/actors.repository.js';
import { ResponseCookieJar } from './response.cookie.jar.js';
import { RequestCookieJar } from './request.cookie.jar.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { readSessionKey } from './session.key.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { SignInMailLimiter } from './sign.in.mail.limiter.js';

let otpDevBypassEnabled = false;

/**
 * What the authenticator app calls this station. The station's own name, and the software's when
 * the operator has cleared it: an issuer of `''` would leave the code unlabelled on the phone,
 * which is worse than a wrong-but-recognisable label.
 */
export function totpIssuer(config: AppConfig): string {
    const title = String(config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title)).trim();
    return title.length > 0 ? title : STREAM_DEFAULTS.title;
}

export const AuthenticationModule: ServerKitModule = {
    name: 'Authentication',
    setup: async (registry: Registry, config: AppConfig) => {
        registry.register(AuthenticationSchemeHandler).useClass(AuthenticationSchemeHandler).asScoped();

        registry.register(AuthenticationHandlerMap).useMap(AuthenticationHandlerMap).set('bearer', JwtAuthenticationHandler);

        registry.register(JwtAuthenticationHandler).useClass(JwtAuthenticationHandler).asScoped();

        registry.register(JwtAuthenticationIssuerMap).useMap(JwtAuthenticationIssuerMap).set('deadair', DeadairJwtAuthenticationIssuer);

        registry.register(DeadairJwtAuthenticationIssuer).useClass(DeadairJwtAuthenticationIssuer).asScoped();

        // Checked here rather than in the scoped factory below, for `CryptoModule`'s reason: an
        // unset key is `''`, which signs nothing and fails at whichever request first tries to mint
        // a session, as a library error naming no variable. A session nobody can sign is not a
        // degraded server, it is one nobody can log into.
        const sessionKey = readSessionKey(String(config.get('AUTHENTICATION_SESSION_JWT_PRIVATE_KEY', '')));
        if (sessionKey.length === 0) {
            throw new Error('AUTHENTICATION_SESSION_JWT_PRIVATE_KEY is not set. Every session token is signed with it, so nobody could sign in.');
        }

        registry
            .register(JwtProvider)
            .useFactory(container => {
                return new JwtProvider(container.get(Logger), sessionKey);
            })
            .asScoped();

        // Read through the shared reader rather than as a boolean, and here it is a security fix
        // rather than a tidy-up: dotenv values are strings like every other layer's, so
        // `OTP_DEV_BYPASS=false` in a `.env` was TRUTHY and switched the bypass on. The positive
        // NODE_ENV allowlist below is what kept that from being exploitable outside development —
        // it is the second lock, and it was doing the first lock's job.
        const otpDevBypass = settingIsOn(config, 'OTP_DEV_BYPASS', false);
        // Positive allowlist: the OTP bypass (accepts any submitted code) may ONLY run under an
        // explicit development environment. An unset/'staging'/'test' NODE_ENV must not silently
        // enable it — only 'development' does.
        if (otpDevBypass && process.env.NODE_ENV !== 'development') {
            throw new Error(`OTP_DEV_BYPASS may only be enabled when NODE_ENV=development (got ${process.env.NODE_ENV ?? 'undefined'})`);
        }
        otpDevBypassEnabled = otpDevBypass;
        registry
            .register(OtpProvider)
            .useClass(otpDevBypass ? OtpProviderMock : OtpProvider)
            .asSingleton();

        registry.register(SessionEventRepository).useClass(SessionEventRepository).asScoped();
        registry.register(LoginActivityRepository).useClass(LoginActivityRepository).asScoped();
        registry.register(SessionActivityService).useClass(SessionActivityService).asScoped();
        registry.register(SessionsService).useClass(SessionsService).asScoped();

        registry
            .register(AuthenticationSessionServiceOptions)
            .useFactory(container => {
                // Hooks delegate to the scoped SessionActivityService so each request's
                // hook closure captures the per-request authorization context (IP, UA).
                // The service swallows DB errors internally — hook failures must not
                // break the auth flow.
                return new AuthenticationSessionServiceOptions('deadair', 'deadair', Duration.fromMillis(1000 * 60 * 60 * 24 * 30), undefined, {
                    onSessionCreated: session => container.get(SessionActivityService).onSessionCreated(session),
                    onSessionRefreshed: session => container.get(SessionActivityService).onSessionRefreshed(session),
                    onSessionRevoked: (session, meta) => container.get(SessionActivityService).onSessionRevoked(session, meta),
                    onValidationFailed: (token, meta) => container.get(SessionActivityService).onValidationFailed(token, meta),
                    onRefreshReuseDetected: meta => container.get(SessionActivityService).onRefreshReuseDetected(meta),
                });
            })
            .asScoped();
        registry.register(AuthenticationSessionService).useClass(AuthenticationSessionService).asScoped();

        registry.register(PasswordStrengthProvider).useClass(PasswordStrengthProvider).asSingleton();
        registry.register(PasswordHashProvider).useClass(Argon2idPasswordHashProvider).asSingleton();

        registry.register(PasswordFactorRepository).useClass(DeadairPasswordFactorRepository).asScoped();
        registry
            .register(PasswordFactorService)
            .useFactory(container => {
                const rateLimiter = new RateLimiterRedis({
                    storeClient: container.get(Redis),
                    points: 5,
                    duration: 30,
                    blockDuration: 300,
                });
                return new PasswordFactorService(
                    container.get(PasswordFactorRepository),
                    rateLimiter,
                    container.get(PasswordStrengthProvider),
                    container.get(PasswordHashProvider),
                    container.get(PolicyService),
                    container.get(CacheProvider),
                );
            })
            .asScoped();

        registry
            .register(EmailFactorServiceOptions)
            .useFactory(() => {
                return new EmailFactorServiceOptions();
            })
            .asScoped();

        registry.register(EmailFactorRepository).useClass(DeadairEmailFactorRepository).asScoped();
        registry.register(EmailFactorService).useClass(EmailFactorService).asScoped();

        registry.register(PhoneFactorServiceOptions).useFactory(() => new PhoneFactorServiceOptions());
        registry.register(PhoneFactorRepository).useClass(DeadairPhoneFactorRepository).asScoped();
        registry.register(PhoneFactorService).useClass(PhoneFactorService).asScoped();

        registry.register(PkceProvider).useClass(PkceProvider).asScoped();
        // Keyed on the address rather than the caller, which is what the global per-caller limiter
        // in `setup.middleware.ts` cannot do: `/auth/login/start` takes no session and mails
        // whatever address it is handed, so the thing worth bounding is how often one inbox can be
        // made to receive.
        registry.register(SignInMailLimiter).useFactory(container => new SignInMailLimiter(container.get(Redis))).asSingleton();
        registry.register(HtmlRedirectProvider).useClass(HtmlRedirectProvider).asScoped();

        registry.register(FidoFactorRepository).useClass(DeadairFidoFactorRepository).asScoped();
        registry
            .register(FidoFactorServiceOptions)
            .useFactory(() => new FidoFactorServiceOptions(Duration.fromMillis(60_000), 'deadair', 'deadair', 'deadair'))
            .asScoped();
        registry.register(FidoFactorService).useClass(FidoFactorService).asScoped();

        registry.register(AuthenticatorFactorRepository).useClass(DeadairAuthenticatorFactorRepository).asScoped();
        // The issuer is what the authenticator app shows beside the code, so it is the station's
        // own name rather than the software's. Read at resolve time, because the factory is
        // scoped and `deadair.settings` is a live layer of `AppConfig` (no scope needed, see
        // `apps/api/CLAUDE.md`). A rename relabels only enrollments made after it: the name is
        // baked into the `otpauth://` URI the phone scanned, and nothing here can reach the phone.
        registry
            .register(AuthenticatorFactorServiceOptions)
            .useFactory(() => new AuthenticatorFactorServiceOptions(totpIssuer(config)))
            .asScoped();
        registry.register(AuthenticatorFactorService).useClass(AuthenticatorFactorService).asScoped();

        const spaBaseUrl = config.get('SPA_BASE_URL', '');

        registry
            .register(AuthenticationServiceOptions)
            .useFactory(() => new AuthenticationServiceOptions(config.get('APP_BASE_URL', ''), 'deadair', 'https://deadair.com', spaBaseUrl))
            .asScoped();

        registry
            .register(MfaChallengeServiceOptions)
            .useFactory(() => new MfaChallengeServiceOptions())
            .asScoped();
        registry.register(MfaChallengeService).useClass(MfaChallengeService).asScoped();
        registry.register(MfaOrchestrator).useClass(MfaOrchestrator).asScoped();

        registry
            .register(OidcProviderRegistryConfig)
            .useFactory(() => {
                const providers: OidcProviderConfig[] = [];
                const googleClientId = config.get('GOOGLE_OIDC_CLIENT_ID', '');
                const googleClientSecret = config.get('GOOGLE_OIDC_CLIENT_SECRET', '');
                if (googleClientId && googleClientSecret) {
                    // GOOGLE_OIDC_ISSUER lets local dev point this provider at a mock IdP
                    // (e.g. http://localhost:3080/google via docker/mock-oidc) without
                    // adding a separate provider name. Unset in production → real Google.
                    const googleIssuer = config.get('GOOGLE_OIDC_ISSUER', 'https://accounts.google.com');
                    const googleIssuerUrl = new URL(googleIssuer);
                    providers.push({
                        name: 'google',
                        issuer: googleIssuerUrl,
                        clientId: googleClientId,
                        clientSecret: googleClientSecret,
                        scopes: ['openid', 'email', 'profile'],
                        redirectUri: new URL(`${config.get('APP_BASE_URL', '')}/auth/login/oidc/callback`),
                        // Only opt into insecure discovery when the issuer is explicitly http —
                        // i.e. the dev-only mock IdP. Real Google stays https-only.
                        allowInsecureIssuer: googleIssuerUrl.protocol === 'http:',
                    });
                }
                return new OidcProviderRegistryConfig(providers);
            })
            .asSingleton();
        registry.register(OidcProviderRegistry).useClass(OidcProviderRegistry).asSingleton();
        registry.register(OidcFactorRepository).useClass(DeadairOidcFactorRepository).asScoped();
        registry.register(OidcActorEmailLookup).useClass(DeadairOidcActorEmailLookup).asScoped();
        registry
            .register(OidcFactorServiceOptions)
            .useFactory(() => new OidcFactorServiceOptions(Duration.fromObject({ minutes: 10 }), Duration.fromObject({ minutes: 15 })))
            .asScoped();
        registry.register(OidcFactorService).useClass(OidcFactorService).asScoped();

        registry.register(AuthenticationService).useClass(AuthenticationService).asScoped();
        registry.register(AuthenticationRegistrationService).useClass(AuthenticationRegistrationService).asScoped();

        registry.register(ActorsRepository).useClass(ActorsRepository).asScoped();
        registry.register(ResponseCookieJar).useClass(ResponseCookieJar).asScoped();
        registry.register(RequestCookieJar).useClass(RequestCookieJar).asScoped();
    },
    start: async container => {
        if (otpDevBypassEnabled) {
            container.get(Logger).warn('OTP_DEV_BYPASS is enabled — any submitted OTP code will be accepted. Do NOT enable in production.');
        }
    },
};
