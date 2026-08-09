import { Container, Registry } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { StreamService } from '#modules/stream/stream.service.js';
import { AudienceWatch } from './audience.watch.js';
import { LiquidsoapEndpoint } from './liquidsoap.endpoint.js';
import { PlayoutControlClient } from './liquidsoap.control.js';
import { CompositeTrackResolver, TrackResolver } from './playout.capability.js';
import { resolvePlayoutBaseUrl } from './playout.urls.js';
import { PluginTrackResolver } from './providers/plugin.resolver.js';
import { SegmentTrackResolver } from './providers/segment.resolver.js';
import { PlayoutPusher } from './playout.pusher.js';
import { PlayoutService } from './playout.service.js';
import { Rundown } from './rundown.js';

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

        // The resolver chain. Every provider answers for its own tracks through
        // `resolveStreamUrl`, including the ones whose audio reaches the player by
        // way of a station-side helper; the station answers for its own segments.
        // Each link guards on the item's `pluginId`, so the ITEM decides who speaks
        // for it rather than a mode set somewhere — which is what lets one running
        // order hold a Spotify track and an ident and air both.
        //
        // The segment link is exactly the second one the original comment here
        // anticipated: a source deadair serves itself rather than through a plugin.
        registry.register(PluginTrackResolver).useClass(PluginTrackResolver).asSingleton();
        registry
            .register(SegmentTrackResolver)
            .useFactory(container => new SegmentTrackResolver(container, resolvePlayoutBaseUrl(config), container.get(Logger)))
            .asSingleton();
        registry
            .register(TrackResolver)
            .useFactory(container => new CompositeTrackResolver([container.get(PluginTrackResolver), container.get(SegmentTrackResolver)]))
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

        // The root container, for the same reason DirectorModule hands one over: this
        // resolver is a singleton reached through Rundown, so it may have been built by
        // a job or request scope that is long disposed. See `SegmentTrackResolver.root`.
        container.get(SegmentTrackResolver).useRootContainer(container);

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
