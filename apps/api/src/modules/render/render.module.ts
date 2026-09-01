import { join } from 'node:path';
import { Container, Registry } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AnalysisService } from '#modules/analysis/analysis.service.js';
import { MixerService } from './mixer.service.js';
import { PadLibrary } from './pad.library.js';
import { AudioUrlSigner } from '#modules/playout/audio.url.signer.js';
import { PadRepository } from './pad.repository.js';
import { PadSetRepository } from './pad.set.repository.js';
import { DEFAULT_PRONUNCIATIONS } from './pronunciation.lexicon.js';
import { PronunciationRepository } from './pronunciation.repository.js';
import { RenderService } from './render.service.js';
import { SegmentLibrary } from './segment.library.js';
import { ScriptHistoryRepository } from './script.history.repository.js';
import { ScriptRatingsRepository } from './script.ratings.repository.js';
import { SegmentRepository } from './segment.repository.js';
import { SegmentStore } from './segment.store.js';
import { SpeechGate } from './speech.gate.js';
import { SpeechService } from './speech.service.js';
import { VoiceSampleStore } from './voice.sample.store.js';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';

/** Where segment audio is written when `SEGMENT_DIR` is unset. Alongside `media/art`, and gitignored with it. */
const DEFAULT_SEGMENT_DIR = './media/segments';

/** Where an operator drops audio for the station to take in, when `SEGMENT_LIBRARY_DIR` is unset. */
const DEFAULT_LIBRARY_DIR = join(DEFAULT_SEGMENT_DIR, 'inbox');

/**
 * The soundboard library on disk, when `PAD_LIBRARY_DIR` is unset.
 *
 * **The directory itself and not an `inbox/` inside it**, which is what this was for one commit and
 * what the segment shelf beside it still is. Two reasons it does not carry over. `media/segments/`
 * needs the extra level because it ALSO holds the content store, where `media/pads/` holds nothing
 * else — pad bytes land in the segment store. And the container has never had one
 * (`docker/rootfs/.../storage-env` sets `$DEADAIR_MEDIA/pads` and tells the operator to back that
 * up), so the level was dev-only drift of exactly the kind the image rules exist to prevent.
 *
 * Its own root rather than a subdirectory of the segment inbox, which would otherwise read as a
 * segment KIND called `pads` and put the whole rack on the shelf the planner chooses idents from.
 * The same reason the voice samples sit beside the segment store rather than inside it: separate
 * roots make "this is not that" a filesystem fact instead of a convention.
 *
 * The BYTES still land in the segment store, because a content-addressed store is about identity
 * rather than about what the file is for. **Which is what makes THIS directory the one to back up**
 * — the store copy is rewritten from here by every boot scan and is disposable, and nothing anywhere
 * can reproduce what is here. So it is not a drop point that happens to be kept: it is the library,
 * written by an operator dropping files AND by the console (`PadLibrary.ingest`), and
 * `docs/todo/backup-and-restore.md` is the design that rests on that. In the container it sits with
 * the bulk rather than with the authored half, because a library of beds is gigabytes.
 */
const DEFAULT_PAD_LIBRARY_DIR = './media/pads';

/**
 * Where the station's OWN soundboard ships, when `PAD_ASSETS_DIR` is unset.
 *
 * Tracked in the repository rather than under `media/`, because it is part of the build rather than
 * something an operator gave the station — which is the same reason `stream/` is tracked and
 * `media/segments/` is not. It is copied into the library once, on a station that has never held a
 * pad, and never read again.
 *
 * Empty today. `docs/decisions/pad-licensing.md` is why: everything this repository redistributes
 * has to be CC0, attribution-requiring audio is refused rather than credited, and sourcing verified
 * public-domain audio properly is a research task nobody has done yet.
 */
const DEFAULT_PAD_ASSETS_DIR = '../../assets/pads';

/**
 * Where rendered voice previews are cached, when `VOICE_SAMPLE_DIR` is unset.
 *
 * Beside the segment store and deliberately not inside it: a sample is not a segment, and the one
 * thing that must never happen is a preview finding its way into the library the planner chooses
 * from. Separate roots make that a filesystem fact rather than a convention.
 */
const DEFAULT_SAMPLE_DIR = './media/voice-samples';

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

        // The record of what the station wrote, as opposed to what it currently says. Scoped with
        // the repository beside it, and registered here rather than in the director because the
        // rows describe segments: the director writes it, the way it writes segments themselves.
        registry.register(ScriptHistoryRepository).useClass(ScriptHistoryRepository).asScoped();
        registry.register(ScriptRatingsRepository).useClass(ScriptRatingsRepository).asScoped();

        // Scoped with the repository it writes through. The inbox path is a constructor argument
        // rather than a config lookup of its own, so the class stays testable against a temp
        // directory with no container and no AppConfig.
        registry
            .register(SegmentLibrary)
            .useFactory(
                container => new SegmentLibrary(container.get(SegmentStore), container.get(SegmentRepository), libraryDir, container.get(Logger)),
            )
            .asScoped();

        // The soundboard, scoped with the repository and the scanner beside it. The library path is
        // a constructor argument for `SegmentLibrary`'s reason: the class stays testable against a
        // temp directory with no container and no AppConfig.
        const padLibraryDir = config.get('PAD_LIBRARY_DIR', DEFAULT_PAD_LIBRARY_DIR);
        registry.register(PadRepository).useClass(PadRepository).asScoped();
        registry.register(PadSetRepository).useClass(PadSetRepository).asScoped();
        registry
            .register(PadLibrary)
            .useFactory(
                container =>
                    new PadLibrary(
                        container.get(SegmentStore),
                        container.get(PadRepository),
                        container.get(PadSetRepository),
                        padLibraryDir,
                        container.get(AnalysisService),
                        config,
                        container.get(Logger),
                        container.get(AudioUrlSigner),
                    ),
            )
            .asScoped();

        // Scoped with the repositories and the plugin registry it reads. It owns no loop and holds
        // no state between calls: everything about one render lives in the call, and the stream it
        // drains belongs to the plugin instance rather than to this.
        // Singleton, like SegmentStore: a directory root and nothing else.
        registry
            .register(VoiceSampleStore)
            .useFactory(() => new VoiceSampleStore(config.get('VOICE_SAMPLE_DIR', DEFAULT_SAMPLE_DIR)))
            .asSingleton();

        // Scoped with the repositories beside it. The render path reads it once per segment, which
        // is what keeps an operator's edit to the lexicon audible on the next break.
        registry.register(PronunciationRepository).useClass(PronunciationRepository).asScoped();

        // Singleton, for the reason `LlmGate` is one: there is one speech engine, and a per-scope
        // gate would hand every caller its own idea of whether it was busy.
        registry.register(SpeechGate).useClass(SpeechGate).asSingleton();
        registry.register(SpeechService).useClass(SpeechService).asScoped();

        // Beside the speaker and scoped like it: both turn station material into station audio
        // through one chosen plugin. No gate, because a join holds nothing exclusive the way a
        // single set of model weights does.
        registry.register(MixerService).useClass(MixerService).asScoped();

        registry.register(RenderService).useClass(RenderService).asScoped();
    },

    ready: async (container: Container, signal: AbortSignal) => {
        if (signal.aborted) return;
        const logger = container.get(Logger);

        // The station's own lexicon, written once into an EMPTY table — `persona.defaults.ts`'s
        // rule, and for its reason: guarding on the station holding nothing rather than on each
        // written form being absent is what makes deleting a seed expressible. An operator who
        // does not want the station saying "Kesha" gets to say so permanently.
        try {
            await inScope(container, async scope => {
                const lexicon = scope.get(PronunciationRepository);
                if ((await lexicon.count()) > 0) return;

                const seeded = await lexicon.addAll(
                    DEFAULT_PRONUNCIATIONS.map(entry => ({ ...entry, state: 'active' as const, origin: 'operator' as const })),
                );
                logger.info(`render: seeded the station's own pronunciations`, { entries: seeded });
            });
        } catch (error) {
            // A station that says a name plainly is a station that talks. Not a reason to refuse to
            // boot, and the next boot tries again.
            logger.warn(`render: could not seed the pronunciation lexicon (${errorText(error)})`);
        }

        // In `ready` rather than `setup`: nothing the first request does depends on the inbox
        // having been read, and a directory of audio is a filesystem walk plus a row per file. An
        // operator who drops something in later asks for a scan; this is only so a station that was
        // set up while it was down comes up knowing what it has.
        try {
            await inScope(container, async scope => {
                await scope.get(SegmentLibrary).scan();
            });
        } catch (error) {
            // A station with no idents is a station that plays records, which is what it did
            // yesterday. Not a reason to refuse to boot.
            logger.warn(`render: could not scan the segment inbox (${errorText(error)})`);
        }

        // The rack, on the same terms and in its own try for the same reason: an unreadable pad
        // library must not cost the station the idents the scan above just took in.
        try {
            await inScope(container, async scope => {
                const library = scope.get(PadLibrary);

                // Before the scan, and only into a library that has never held anything. See
                // `PadLibrary.seed` for both halves of that, and `docs/decisions/pad-licensing.md`
                // for why the directory it copies from is empty today.
                await library.seed(scope.get(AppConfig).get('PAD_ASSETS_DIR', DEFAULT_PAD_ASSETS_DIR));
                await library.scan();
            });
        } catch (error) {
            // A station with no soundboard is a station that talks without drops, which is every
            // station this one has ever been.
            logger.warn(`render: could not scan the pad library (${errorText(error)})`);
        }
    },
};
