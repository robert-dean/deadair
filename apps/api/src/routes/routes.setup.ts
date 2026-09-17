import { AuthenticationFactorRouter } from './authentication.factor.router.js';
import { AuthenticationRouter } from './authentication.router.js';
import { AuthenticationSessionsRouter } from './authentication.sessions.router.js';
import { AuthenticationApikeysRouter } from './authentication.apikeys.router.js';
import { ActivityRouter } from './activity.router.js';
import { HistoryRouter } from './history.router.js';
import { ArtBreaksRouter } from './art.breaks.router.js';
import { ArtRouter } from './art.router.js';
import { CatalogRouter } from './catalog.router.js';
import { ChartsRouter } from './charts.router.js';
import { NewsRouter } from './news.router.js';
import { NarrationsRouter } from './narrations.router.js';
import { PodcastsRouter } from './podcasts.router.js';
import { HealthRouter } from './health.router.js';
import { ClockRouter } from './clock.router.js';
import { DirectorRouter } from './director.router.js';
import { PlaylistsRouter } from './playlists.router.js';
import { NowplayingRouter } from './nowplaying.router.js';
import { PersonasRouter } from './personas.router.js';
import { PersonasAuditionsRouter } from './personas.auditions.router.js';
import { ProductionsRouter } from './productions.router.js';
import { PlayoutRouter } from './playout.router.js';
import { PluginsRouter } from './plugins.router.js';
import { RenderRouter } from './render.router.js';
import { ScheduleRouter } from './schedule.router.js';
import { SettingsRouter } from './settings.router.js';
import { TopicsRouter } from './topics.router.js';
import { StationRouter } from './station.router.js';
import { TracesRouter } from './traces.router.js';
import { LogsRouter } from './logs.router.js';
import { StreamRouter } from './stream.router.js';
import { StorageRouter } from './storage.router.js';
import { OnboardingRouter } from './onboarding.router.js';

export const routers = [
    HealthRouter,
    AuthenticationRouter,
    AuthenticationFactorRouter,
    AuthenticationSessionsRouter,
    AuthenticationApikeysRouter,
    // BEFORE `ArtRouter`, and that is load-bearing rather than alphabetical: `/art/breaks` also
    // matches `/art/{id}` and `/art/breaks/{kind}` matches `/art/{id}/{filename}`. Koa matches in
    // the order routers are registered, so with these the other way round every one of these
    // operations answers 400 from the uuid check on the route above it, and never runs. See
    // `art.breaks.ck` and the test that pins it.
    ArtBreaksRouter,
    ArtRouter,
    ActivityRouter,
    HistoryRouter,
    CatalogRouter,
    ChartsRouter,
    NewsRouter,
    PodcastsRouter,
    NarrationsRouter,
    PlaylistsRouter,
    PlayoutRouter,
    NowplayingRouter,
    DirectorRouter,
    ClockRouter,
    RenderRouter,
    PersonasRouter,
    PersonasAuditionsRouter,
    ScheduleRouter,
    ProductionsRouter,
    PluginsRouter,
    TopicsRouter,
    StationRouter,
    TracesRouter,
    LogsRouter,
    StreamRouter,
    SettingsRouter,
    StorageRouter,
    OnboardingRouter,
];
