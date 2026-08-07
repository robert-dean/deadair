import { AuthenticationFactorRouter } from './authentication.factor.router.js';
import { AuthenticationRouter } from './authentication.router.js';
import { AuthenticationSessionsRouter } from './authentication.sessions.router.js';
import { ArtRouter } from './art.router.js';
import { CatalogRouter } from './catalog.router.js';
import { PlaylistsRouter } from './playlists.router.js';
import { PlayoutRouter } from './playout.router.js';
import { PluginsRouter } from './plugins.router.js';
import { OnboardingRouter } from './onboarding.router.js';

export const routers = [
    AuthenticationRouter,
    AuthenticationFactorRouter,
    AuthenticationSessionsRouter,
    ArtRouter,
    CatalogRouter,
    PlaylistsRouter,
    PlayoutRouter,
    PluginsRouter,
    OnboardingRouter,
];
