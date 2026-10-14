import { Container, Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Redis } from 'ioredis';
import { RequestAiredWatch } from './request.aired.watch.js';
import { RequestAudioWatch } from './request.audio.watch.js';
import { RequestDesk } from './request.desk.js';
import { RequestPlacements } from './request.placements.js';
import { RequestsRepository } from './requests.repository.js';
import { RequestProviderSearch } from './request.provider.search.js';
import { RequestSearchLimiter } from './request.search.limiter.js';
import { RequestsService } from './requests.service.js';
import { PartyJoinLimiter } from './party.join.limiter.js';
import { PartyPassRepository } from './party.passes.repository.js';
import { PartyService } from './party.service.js';

/**
 * Listener requests: a record somebody asked for, from a listener app or a chat platform.
 *
 * After `DirectorModule`, which places a request, and `NowPlayingModule` and `PlayoutModule`, which
 * say whether the station is on air and when a record is heard. Before `MessagingModule`, whose
 * `/request` command calls the desk here. See `docs/internals/messaging.md` § "Requests".
 *
 * Two listeners, started in `ready`: the rundown's aired edge, and a record's audio arriving, which
 * offers the waiting requests again at once. The rest of the retrying is a cron, which the job broker
 * owns.
 */
export const RequestsModule: ServerKitModule = {
    name: 'Requests',
    setup: async (registry: Registry, _: AppConfig) => {
        registry.register(RequestsRepository).useClass(RequestsRepository).asScoped();
        registry.register(RequestDesk).useClass(RequestDesk).asScoped();
        // A singleton, since the desk is scoped and the turn it holds has to outlive every scope that places.
        registry.register(RequestPlacements).useClass(RequestPlacements).asSingleton();
        // A singleton over the one Redis client, as `SignInMailLimiter` is: the budget is shared by every
        // request, and a scoped limiter would build two Redis-backed limiters per search to say so.
        registry
            .register(RequestSearchLimiter)
            .useFactory(container => new RequestSearchLimiter(container.get(Redis)))
            .asSingleton();
        registry.register(RequestProviderSearch).useClass(RequestProviderSearch).asScoped();
        registry.register(RequestsService).useClass(RequestsService).asScoped();
        registry.register(RequestAiredWatch).useClass(RequestAiredWatch).asSingleton();
        registry.register(RequestAudioWatch).useClass(RequestAudioWatch).asSingleton();
        // A party: the pass guests join with, and the limiter on joining, a singleton over the one
        // Redis client for the reason the search limiter is one.
        registry.register(PartyPassRepository).useClass(PartyPassRepository).asScoped();
        registry
            .register(PartyJoinLimiter)
            .useFactory(container => new PartyJoinLimiter(container.get(Redis)))
            .asSingleton();
        registry.register(PartyService).useClass(PartyService).asScoped();
        // `RequestsTickJob` is registered by `JobsModule`, which walks `JobMappings`, like every job.
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        container.get(RequestAiredWatch).start();
        container.get(RequestAudioWatch).start();
    },

    shutdown: async (container: Container) => {
        container.get(RequestAudioWatch).stop();
        container.get(RequestAiredWatch).stop();
    },
};
