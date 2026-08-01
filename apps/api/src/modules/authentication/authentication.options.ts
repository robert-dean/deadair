/**
 * Configuration values for the authentication module, registered as a DI token.
 *
 * Lives in its own module (rather than alongside `AuthenticationService`) so that
 * services which only need the options — e.g. `ReferrersService`, `InvitationsService` —
 * can inject it without importing `authentication.service.js`, whose transitive
 * `PersonsService` dependency would otherwise close an import cycle.
 */
export class AuthenticationServiceOptions {
    constructor(
        public readonly appBaseUrl: string = 'http://localhost:3000',
        public readonly authenticationFidoRpId: string = 'localhost',
        public readonly authenticationFidoRpOrigin: string = 'http://localhost:3000',
        // Where the SPA is served from. Different from `appBaseUrl` (the API host) when the
        // frontend runs on a separate origin in development.
        public readonly spaBaseUrl: string = 'http://localhost:3000',
    ) {}
}
