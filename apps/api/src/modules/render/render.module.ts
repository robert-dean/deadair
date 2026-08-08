import { join } from 'node:path';
import { Container, Registry } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { RenderService } from './render.service.js';
import { SegmentLibrary } from './segment.library.js';
import { SegmentRepository } from './segment.repository.js';
import { SegmentStore } from './segment.store.js';
import { SpeechService } from './speech.service.js';

/** Where segment audio is written when `SEGMENT_DIR` is unset. Alongside `media/art`, and gitignored with it. */
const DEFAULT_SEGMENT_DIR = './media/segments';

/** Where an operator drops audio for the station to take in, when `SEGMENT_LIBRARY_DIR` is unset. */
const DEFAULT_LIBRARY_DIR = join(DEFAULT_SEGMENT_DIR, 'inbox');

/**
 * Segments: the things the station plays that are not records.
 *
 * Registered after PlaylistsModule and before PlayoutModule, because the playout module's resolver
 * answers for a committed segment by reading a row and a file from here, and nothing in this module
 * reaches back into playout or the director. It owns no loop and starts nothing on the request
 * path; the one thing it does at boot is look in the inbox.
 *
 * ## What this module is, and what it is not yet
 *
 * Today a segment is audio somebody recorded and dropped in a directory, and everything here is the
 * bookkeeping around that: a row, a content-addressed copy of the bytes, and a way to hand them to
 * whoever asks. The name is `render` rather than `library` because of what it becomes rather than
 * what it is: `segments.state` already carries `planned | rendering | ready | failed`, which is the
 * seam a text-to-speech renderer drops into without any of the rest of the station having to change
 * its mind about what a segment is. See `docs/todo/dj-voice.md`.
 *
 * That renderer is now here: `SpeechService` speaks through whichever plugin declares the `speech`
 * capability, and `RenderSegmentJob` walks a row from `planned` to `ready`. Which is why this module
 * is registered after `PluginsModule` — its renderer reaches into the plugin registry — and why it
 * still starts nothing: a render happens because a job was sent, never because time passed.
 *
 * ## The one rule the rest of the station depends on
 *
 * **A segment that is not `ready` is skipped, never waited for.** The director reads the row before
 * committing anything, and a segment it cannot air is passed over as though the lineup did not hold
 * it. That is what keeps a renderer that is slow, broken or not yet built from ever costing the
 * station silence, and it is why `state` is a column here rather than something inferred from
 * whether the file exists.
 */
export const RenderModule: ServerKitModule = {
    name: 'Render',
    setup: async (registry: Registry, config: AppConfig) => {
        // Singleton: it is a directory root and nothing else, so a per-request copy would be a
        // per-request re-read of the same string. Same registration as ArtStore, whose layout and
        // path-safety rules this follows.
        const libraryDir = config.get('SEGMENT_LIBRARY_DIR', DEFAULT_LIBRARY_DIR);
        registry
            .register(SegmentStore)
            .useFactory(() => new SegmentStore(config.get('SEGMENT_DIR', DEFAULT_SEGMENT_DIR)))
            .asSingleton();

        // Scoped, like every other repository: per-request on the request path, per-run inside the
        // scope the boot scan opens.
        registry.register(SegmentRepository).useClass(SegmentRepository).asScoped();

        // Scoped with the repository it writes through. The inbox path is a constructor argument
        // rather than a config lookup of its own, so the class stays testable against a temp
        // directory with no container and no AppConfig.
        registry
            .register(SegmentLibrary)
            .useFactory(
                container => new SegmentLibrary(container.get(SegmentStore), container.get(SegmentRepository), libraryDir, container.get(Logger)),
            )
            .asScoped();

        // Scoped with the repositories and the plugin registry it reads. It owns no loop and holds
        // no state between calls: everything about one render lives in the call, and the stream it
        // drains belongs to the plugin instance rather than to this.
        registry.register(SpeechService).useClass(SpeechService).asScoped();

        registry.register(RenderService).useClass(RenderService).asScoped();
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        const logger = container.get(Logger);

        // In `ready` rather than `setup`: nothing the first request does depends on the inbox
        // having been read, and a directory of audio is a filesystem walk plus a row per file. An
        // operator who drops something in later asks for a scan; this is only so a station that was
        // set up while it was down comes up knowing what it has.
        const scope = container.createScopedContainer();
        try {
            await scope.get(SegmentLibrary).scan();
        } catch (error) {
            // A station with no idents is a station that plays records, which is what it did
            // yesterday. Not a reason to refuse to boot.
            logger.warn(`render: could not scan the segment inbox (${error instanceof Error ? error.message : String(error)})`);
        } finally {
            await scope.disposeAsync();
        }
    },
};
