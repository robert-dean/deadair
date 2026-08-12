import { Container, Registry } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { StreamService } from '#modules/stream/stream.service.js';
import { TrackAudioRepository } from './audio/track.audio.repository.js';
import { TrackAudioService } from './audio/track.audio.service.js';
import { TrackStore } from './audio/track.store.js';
import { AudienceWatch } from './audience.watch.js';
import { LiquidsoapEndpoint } from './liquidsoap.endpoint.js';
import { PlayoutControlClient } from './liquidsoap.control.js';
import { CompositeTrackResolver, TrackResolver } from './playout.capability.js';
import { resolvePlayoutBaseUrl } from './playout.urls.js';
import { PluginTrackResolver } from './providers/plugin.resolver.js';
import { TrackAudioResolver } from './providers/track.audio.resolver.js';
import { SegmentTrackResolver } from './providers/segment.resolver.js';
import { PlayoutPusher } from './playout.pusher.js';
import { PlayoutService } from './playout.service.js';
import { Rundown } from './rundown.js';

/**
 * Where the station's own copies of records are written when `TRACKS_DIR` is unset. Beside
 * `media/art`, and gitignored with it.
 *
 * A path the process needs rather than a decision an operator makes from the console, which is why it
 * is env and `playout.trackCache` is a setting.
 */
const DEFAULT_TRACKS_DIR = './media/tracks';

/**
 * The station's transport: the running order, and the loop that drains it into
 * Liquidsoap.
 *
 * Registered after PluginsModule and PlaylistsModule because the resolver
 * reaches into the plugin registry and invoker for a track's stream URL.
 *
 * Almost everything here is a singleton, and not for convenience: the rundown IS
 * the station's running order, so a per-request copy would hand every caller a
 * different (empty) view of what is on air, and the pusher's reconcile loop
 * would have nothing to drain.
 */
export const PlayoutModule: ServerKitModule = {
    name: 'Playout',
    setup: async (registry: Registry, config: AppConfig) => {
        registry.register(LiquidsoapEndpoint).useClass(LiquidsoapEndpoint).asSingleton();
        registry.register(PlayoutControlClient).useClass(PlayoutControlClient).asSingleton();

        // Where a record's audio comes from: the files, the rows saying what is in them, and the one
        // service that fetches from a provider when neither has it.
        //
        // Singleton for the store, because it is a directory root and nothing else, so a per-request
        // copy would be a per-request re-read of the same string. Scoped for the repository, like
        // every other one: per-request on the request path, per-run inside a job.
        registry
            .register(TrackStore)
            .useFactory(() => new TrackStore(config.get('TRACKS_DIR', DEFAULT_TRACKS_DIR)))
            .asSingleton();
        registry.register(TrackAudioRepository).useClass(TrackAudioRepository).asScoped();

        // Asking a provider for a stream URL. Registered here rather than as part of the chain below,
        // because it is no longer IN the chain: since the player is only ever handed the app's own URL,
        // the only caller left is `TrackAudioService`, which fetches the bytes itself.
        registry.register(PluginTrackResolver).useClass(PluginTrackResolver).asSingleton();

        // SINGLETON, and that is load-bearing rather than incidental: it de-duplicates fetches in an
        // in-process map and holds a few just-fetched records in memory for a station keeping nothing
        // on disk. A scoped copy would hold neither, so two requests for one record would download it
        // twice and every warm would be thrown away the moment its job finished. It takes the root
        // container and opens its own scope per call for the repository, like the resolvers do.
        registry
            .register(TrackAudioService)
            .useFactory(
                container =>
                    new TrackAudioService(container, container.get(TrackStore), container.get(PluginTrackResolver), config, container.get(Logger)),
            )
            .asSingleton();

        // The resolver chain, which is now two links and no longer a fallback ladder.
        //
        // `TrackAudioResolver` answers for every catalog record with `/playout/audio/{sourceId}` —
        // this app, this machine — whether or not the bytes are here yet, because the route behind that
        // URL fetches them if they are not. **The player never sees a provider URL.** That is what
        // retired the third link: a provider URL is fetchable only from wherever it was minted for, so
        // a chain that sometimes handed one over and sometimes did not was deciding, silently and per
        // deployment, whether the URL would work at all.
        //
        // `SegmentTrackResolver` still answers for the station's own segments, and still guards on the
        // item's `pluginId`. It is second because a segment id is no `track_sources` binding, so the
        // first link declines it on a lookup rather than on a mode set somewhere.
        registry
            .register(SegmentTrackResolver)
            .useFactory(container => new SegmentTrackResolver(container, resolvePlayoutBaseUrl(config), container.get(Logger)))
            .asSingleton();
        registry
            .register(TrackAudioResolver)
            .useFactory(container => new TrackAudioResolver(container, resolvePlayoutBaseUrl(config), container.get(Logger)))
            .asSingleton();
        registry
            .register(TrackResolver)
            .useFactory(container => new CompositeTrackResolver([container.get(TrackAudioResolver), container.get(SegmentTrackResolver)]))
            .asSingleton();

        registry.register(Rundown).useClass(Rundown).asSingleton();
        registry.register(PlayoutPusher).useClass(PlayoutPusher).asSingleton();

        // Singleton because it IS the station's reading of its audience: a per-request
        // copy would poll Icecast once per call and answer from a window of its own.
        registry.register(AudienceWatch).useClass(AudienceWatch).asSingleton();

        // Scoped, unlike the rest: it is the request-facing surface, and it only
        // holds references to the singletons above.
        registry.register(PlayoutService).useClass(PlayoutService).asScoped();
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        const logger = container.get(Logger);

        // The bridge secret, read once from the settings StreamModule.ready has already
        // seeded and written into radio.env. Pushed into the endpoint rather than read
        // per call: the reconcile loop runs every couple of seconds, and the secret sits
        // behind a scoped repository.
        const scope = container.createScopedContainer();
        try {
            const { playoutBridgeSecret } = await scope.get(StreamService).settings();
            if (!playoutBridgeSecret) {
                logger.warn('playout: no bridge secret; nothing can be handed to liquidsoap until one is seeded');
            }
            container.get(LiquidsoapEndpoint).useSecret(playoutBridgeSecret ?? '');
        } finally {
            await scope.disposeAsync();
        }

        // Starts whether or not the stream is up: with nothing answering, the loop
        // simply probes and stays quiet, and a stack started later is picked up on
        // its own.
        container.get(PlayoutPusher).start();

        // Started here rather than in StreamModule, next to the loop that will be held
        // on its reading: the mount it watches was pushed into the stats client by
        // StreamModule.ready, which has already run.
        container.get(AudienceWatch).start();
    },

    shutdown: async (container: Container) => {
        container.get(PlayoutPusher).stop();
        container.get(AudienceWatch).stop();
    },
};
