import { readFile } from 'node:fs/promises';
import { Container, Registry } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { StationAttentionService } from './station.attention.service.js';
import { StationCheckupService } from './station.checkup.service.js';
import { TracesService } from './traces.service.js';
import { LogsService } from './logs.service.js';
import { BundledChangelog, parseChangelog } from './station.changelog.js';
import { StationReleasesService } from './station.releases.service.js';
import { ReleaseWatch } from './station.release.watch.js';
import { BuildRevision } from '#modules/shared/build.revision.js';

/**
 * Where the changelog is read from when `CHANGELOG_PATH` is unset: the repository's own, relative to
 * `apps/api`, which is the working directory in the dev tree and in the image alike. The image sets
 * the variable anyway, on the convention its other shipped files follow.
 */
const DEFAULT_CHANGELOG_PATH = '../../CHANGELOG.md';

/**
 * The station about itself, composed across everything else.
 *
 * What needs somebody, the machinery underneath it, and what changed in each release. It owns no
 * table and writes nothing, and the one thing it starts is the release check below. The whole of it
 * is that facts an operator needs together are scattered across the five pages that own them, and an
 * operator has to already be on a page to find out that page has something wrong on it.
 *
 * ## Last, because it reads everything
 *
 * Registered after `ProductionsModule` and before `DataConnectionsModule`. It resolves playout, the
 * director's console service, the catalog and the plugin host, so it has to sit below all of them —
 * and since shutdown walks this list forwards too, sitting at the end means nothing else is torn
 * down against it. Nothing resolves this module, which is what makes that position free.
 *
 * ## It is not a health check
 *
 * The same line `silence.diagnosis.ts` draws, and for the same reason: several of the states this
 * composes describe a perfectly healthy process doing what it was told. Only faults reach the list,
 * and the wording of the ones it did not work out for itself belongs to whoever did.
 */
export const StationModule: ServerKitModule = {
    name: 'Station',
    setup: async (registry: Registry, config: AppConfig) => {
        // Scoped, like every other request-path service: it opens no loop and holds nothing between
        // requests, and the repositories under it are scoped already.
        registry.register(StationAttentionService).useClass(StationAttentionService).asScoped();
        // Scoped for the same reason, even though the heartbeat map it reads is a singleton: what
        // makes a service scoped here is the repositories under it, not the facts it reports.
        registry.register(StationCheckupService).useClass(StationCheckupService).asScoped();
        // Scoped like the other two, though it reads neither a repository nor a singleton: it scans
        // files. What decides the lifetime here is that it is a request-path service and nothing
        // else, which is the same answer the two above give for different reasons.
        registry.register(TracesService).useClass(TracesService).asScoped();
        // Scoped on the same answer `TracesService` gives above: it reads files rather than a
        // repository or a singleton, so nothing forces a lifetime on it, and being a request-path
        // service is the whole of the reason. The `RotatingLogStore` it also reads is NOT injected —
        // it comes from the process-wide holder, which is what keeps this module free of a
        // registration `PluginsModule` owns.
        registry.register(LogsService).useClass(LogsService).asScoped();

        // Read here, once, rather than per request: the file is part of the build and cannot change
        // while the process runs. A build that carries none answers an empty list, which the
        // contract's absent `current` already says, rather than failing a boot over a page of notes.
        const changelog = new BundledChangelog(await readChangelog(String(config.get('CHANGELOG_PATH', DEFAULT_CHANGELOG_PATH))));
        registry.register(BundledChangelog).useValue(changelog);
        // A singleton, and the one thing in this module that is: it holds the last answer GitHub gave
        // between the hourly job that refreshes it and the requests that read it. It reads the switch
        // through the live config on every call, so an operator's change applies without a restart.
        registry
            .register(ReleaseWatch)
            .useFactory(container => new ReleaseWatch(config, changelog, container.get(BuildRevision), container.get(Logger)))
            .asSingleton();
        // Scoped on the same answer as the rest: a request-path service holding nothing of its own.
        registry.register(StationReleasesService).useClass(StationReleasesService).asScoped();
    },

    // The first check, so a station that has just started knows within seconds rather than at the
    // next hourly run. Deliberately not awaited: the request can take its whole timeout on a station
    // with no internet, and the hooks after this one should not wait on GitHub. It cannot reject,
    // because the watch swallows every failure itself, which is the whole of its contract.
    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        void container.get(ReleaseWatch).check();
    },
};

async function readChangelog(path: string) {
    try {
        return parseChangelog(await readFile(path, 'utf8'));
    } catch {
        return [];
    }
}
