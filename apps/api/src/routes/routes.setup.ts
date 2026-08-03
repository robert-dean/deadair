import { AuthenticationFactorRouter } from './authentication.factor.router.js';
import { AuthenticationRouter } from './authentication.router.js';
import { AuthenticationSessionsRouter } from './authentication.sessions.router.js';
import { MusicRouter } from './music.router.js';
import { PluginsRouter } from './plugins.router.js';
import { OnboardingRouter } from './onboarding.router.js';

export const routers = [
    AuthenticationRouter,
    AuthenticationFactorRouter,
    AuthenticationSessionsRouter,
    MusicRouter,
    PluginsRouter,
    OnboardingRouter,
];
