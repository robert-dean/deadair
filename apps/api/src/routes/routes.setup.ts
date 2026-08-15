import { AuthenticationFactorRouter } from './authentication.factor.router.js';
import { AuthenticationRouter } from './authentication.router.js';
import { AuthenticationSessionsRouter } from './authentication.sessions.router.js';
import { ActivityRouter } from './activity.router.js';
import { ArtRouter } from './art.router.js';
import { CatalogRouter } from './catalog.router.js';
import { ChartsRouter } from './charts.router.js';
import { NewsRouter } from './news.router.js';
import { HealthRouter } from './health.router.js';
import { DirectorRouter } from './director.router.js';
import { PlaylistsRouter } from './playlists.router.js';
import { NowplayingRouter } from './nowplaying.router.js';
import { PersonasRouter } from './personas.router.js';
import { PlayoutRouter } from './playout.router.js';
import { PluginsRouter } from './plugins.router.js';
import { RenderRouter } from './render.router.js';
import { SettingsRouter } from './settings.router.js';
import { OnboardingRouter } from './onboarding.router.js';

export const routers = [
    HealthRouter,
    AuthenticationRouter,
    AuthenticationFactorRouter,
    AuthenticationSessionsRouter,
    ArtRouter,
    ActivityRouter,
    CatalogRouter,
    ChartsRouter,
    NewsRouter,
    PlaylistsRouter,
    PlayoutRouter,
    NowplayingRouter,
    DirectorRouter,
    RenderRouter,
    PersonasRouter,
    PluginsRouter,
    SettingsRouter,
    OnboardingRouter,
];
