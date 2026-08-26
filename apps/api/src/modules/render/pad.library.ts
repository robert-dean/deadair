import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { AnalysisService } from '#modules/analysis/analysis.service.js';
import { resolvePlayoutBaseUrl, storedAudioUrl } from '#modules/playout/playout.urls.js';
import { errorText } from '#modules/shared/error.text.js';
import { PAD_SOURCES, PadRepository, type Pad, type PadImport } from './pad.repository.js';
import { PadSetRepository } from './pad.set.repository.js';
import { isSegmentExtension, SEGMENT_EXTENSIONS, SegmentStore, type SegmentExtension } from './segment.store.js';

/** What one pass over the pad library did. */
export interface PadScan {
    /** Audio files seen, whether or not anything changed. */
    scanned: number;
    /** Pads the station did not have before this pass. */
    imported: number;
    /** Slots whose file changed under them. */
    replaced: number;
    /** Files passed over: not audio, or unreadable. */
    skipped: number;
    /**
     * Pads that reached the library but not their set, because it already answered to their name.
     *
     * Its own count rather than folded into `skipped`, because the outcomes are opposite: a skipped
     * file is not in the station at all, and one of these is in the library and merely unreachable
     * until somebody puts it on a set by hand.
     */
    contested: number;
}

/** One sound arriving, from whichever door. See {@link PadLibrary.ingest}. */
export interface PadIngest {
    /** The audio itself. */
    bytes: Buffer;
    ext: SegmentExtension;
    /** The directory it belongs in, which is also the set it joins. Validated by {@link boardIsSafe}. */
    board: string;
    /** What a script will write. The FILE is named after this, not after whatever it was called upstream. */
    name: string;
    label: string;
    /** Who delivered it: `library`, `upload`, `url`. See `pads.source`. */
    source: string;
    /**
     * Where it already sits, relative to the library root, when the caller read it off that disk.
     *
     * The scan sets it and nothing else does. Absent means the bytes arrived over HTTP and this has
     * to put them on disk itself; present means they are already there and copying them onto
     * themselves would be a needless write.
     */
    onDisk?: string;
}

/** What taking one sound in did. */
export interface PadIngested {
    pad: Pad;
    outcome: PadImport;
    /** The set already answered to this name, so the pad is in the library and nothing can hit it. */
    contested: boolean;
}

/**
 * The pad library on disk: audio under `media/pads/<board>/` is what a presenter can hit.
 *
 * **A library rather than an inbox**, which is the word this used and the shape `SegmentLibrary`
 * beside it still has. The difference is what `docs/todo/backup-and-restore.md` rests on: the bytes
 * in the content store are rewritten from here by every boot scan and are disposable, and nothing
 * anywhere can reproduce what is here, so this directory is the thing an archive carries. Which in
 * turn is why it has no `inbox/` level — `media/pads/` holds nothing but the library.
 *
 * `SegmentLibrary` with two differences, and both of them are what a soundboard is rather than
 * incidental:
 *
 * 1. **A subdirectory names the BOARD** where a segment's names its kind, so `wisecrack/airhorn.mp3`
 *    is the air horn on the wisecrack board. Anything loose at the top lands on `station`, that being
 *    what an operator with one folder of drops almost certainly means.
 * 2. **The filename stem is the NAME a script writes**, which is the thing a segment has no
 *    equivalent of: an ident is chosen by the planner and a pad is chosen by whoever is talking, so
 *    it needs a token a model can be handed and can give back. `airhorn.mp3` is `[sfx:airhorn]`.
 *
 * Everything else is that file's design and its reasons apply unchanged: one level deep so no
 * convention has to be invented for a nested tree, bytes COPIED into the content-addressed store so
 * emptying the directory does not silence a board, dotfiles are not deliveries, and a file that
 * cannot be read costs the operator that file rather than the other forty.
 *
 * The one thing it deliberately does NOT do is remove a pad whose file has gone. The scan is an
 * argument about what is present and never about what is absent — the bytes are in the store and the
 * row is the station's — so the way to take a pad off a board is to reject it, which is a decision
 * that outlives the next scan. See `PadRepository.setState`.
 */
@Injectable()
export class PadLibrary {
    constructor(
        private readonly store: SegmentStore,
        private readonly pads: PadRepository,
        // What a presenter can actually reach. See {@link join}.
        private readonly sets: PadSetRepository,
        private readonly root: string,
        // How loud a pad came out, which nothing else can answer. See {@link measure}.
        private readonly analysis: AnalysisService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Copy the shipped pack into the library, once, before the first scan reads it.
     *
     * ## Guarded on the LIBRARY being empty, not on each file being absent
     *
     * `persona.defaults.ts`' rule and its reason: asking whether the station holds anything is what
     * makes DELETING a stock pad expressible. Per-file it would come back on every boot, and an
     * operator who threw an air horn away would have to keep throwing it away.
     *
     * The library rather than the ROWS, because the row and the file are two different absences: a
     * rejected pad is a row saying somebody decided something, and an empty directory is a station
     * that has never been given anything. This reads the directory.
     *
     * ## Nothing ships in it today
     *
     * `assets/pads/` is empty on purpose — `docs/decisions/pad-licensing.md` says why, and the short
     * version is that everything the station redistributes has to be CC0 and sourcing that properly
     * is a research task with a legal edge. So this is a no-op on every current install, and the
     * reason it exists anyway is that the copy is the part with the decisions in it (when, guarded on
     * what, and what happens on a second boot) and those are worth settling before there is audio to
     * argue about.
     *
     * Best-effort throughout: a pack that could not be copied costs the station its stock sounds and
     * never its boot, exactly as a lexicon that could not be seeded does.
     */
    async seed(from: string): Promise<number> {
        try {
            const shipped = await readdir(from, { withFileTypes: true }).catch(() => []);
            if (shipped.length === 0) return 0;

            // Anything at all, including a file the operator has since rejected: what this asks is
            // whether the station has ever been given pads, and one directory of them is an answer.
            const held = await this.audioFiles();
            if (held.length > 0) return 0;

            let copied = 0;
            for (const entry of shipped) {
                if (!entry.isDirectory()) continue;

                const target = join(this.root, entry.name);
                await mkdir(target, { recursive: true });

                for (const file of await readdir(join(from, entry.name), { withFileTypes: true }).catch(() => [])) {
                    if (!file.isFile() || file.name.startsWith('.')) continue;

                    await copyFile(join(from, entry.name, file.name), join(target, file.name));
                    copied += 1;
                }
            }

            if (copied > 0) this.logger.info('render: put the station\'s own soundboard in the library', { files: copied, from });
            return copied;
        } catch (error) {
            this.logger.warn(`render: could not lay down the shipped soundboard (${errorText(error)})`);
            return 0;
        }
    }

    /**
     * Take everything in the library directory onto the rack.
     *
     * Safe to run repeatedly: a file nobody has touched is `unchanged` and silent, and one whose
     * bytes differ replaces what its slot held. Safe to run concurrently in the sense that matters —
     * the store write is content-addressed — though nothing in the station runs two at once.
     */
    async scan(): Promise<PadScan> {
        // Created rather than merely tolerated when missing, per `SegmentLibrary`: an empty
        // directory is a place to drop files, and no directory at all is a feature the operator
        // cannot find.
        await mkdir(this.root, { recursive: true });

        const result: PadScan = { scanned: 0, imported: 0, replaced: 0, skipped: 0, contested: 0 };
        for (const file of await this.audioFiles()) await this.importOne(file, result);

        if (result.imported > 0 || result.replaced > 0 || result.skipped > 0 || result.contested > 0) {
            this.logger.info('render: scanned the pad library', { ...result, library: this.root });
        }
        return result;
    }

    /** Everything in the library that is audio, with the board its directory puts it on. */
    private async audioFiles(): Promise<{ path: string; relative: string; board: string }[]> {
        const found: { path: string; relative: string; board: string }[] = [];

        for (const entry of await readdir(this.root, { withFileTypes: true }).catch(() => [])) {
            // `.DS_Store` arrives in every directory a Mac has ever looked at, and would otherwise
            // be counted as a file passed over on every single pass.
            if (entry.name.startsWith('.')) continue;

            if (entry.isDirectory()) {
                const board = entry.name;
                for (const nested of await readdir(join(this.root, board), { withFileTypes: true }).catch(() => [])) {
                    if (nested.isFile() && !nested.name.startsWith('.')) {
                        found.push({ path: join(this.root, board, nested.name), relative: join(board, nested.name), board });
                    }
                }
            } else if (entry.isFile()) {
                found.push({ path: join(this.root, entry.name), relative: entry.name, board: DEFAULT_BOARD });
            }
        }

        return found;
    }

    /** Import one file, counting the outcome. */
    private async importOne(file: { path: string; relative: string; board: string }, result: PadScan): Promise<void> {
        const ext = extname(file.path).slice(1).toLowerCase();
        if (!isSegmentExtension(ext)) {
            // Named out loud rather than counted as a stray, per `SegmentLibrary`: the fix is only
            // obvious to somebody who knows why it was refused.
            if (AUDIO_EXTENSIONS.has(ext)) {
                this.logger.warn('render: the pad library holds audio in a format the station does not serve', {
                    file: file.relative,
                    format: ext,
                    serves: SEGMENT_EXTENSIONS.join(', '),
                });
            }
            result.skipped += 1;
            return;
        }
        result.scanned += 1;

        const name = padNameOf(file.relative);
        if (name === undefined) {
            // A file called `.mp3`, or one whose stem is punctuation. There is no token a script
            // could carry for it, so it is not a pad however good the audio is.
            this.logger.warn('render: a file in the pad library has no name a script could write', { file: file.relative });
            result.skipped += 1;
            return;
        }

        const bytes = await readFile(file.path).catch(() => undefined);
        if (bytes === undefined) {
            this.logger.warn('render: could not read a file in the pad library', { file: file.relative });
            result.skipped += 1;
            return;
        }

        const { outcome, contested } = await this.ingest({
            bytes,
            ext,
            board: file.board,
            name,
            label: labelFor(file.relative),
            source: PAD_SOURCES.library,
            onDisk: file.relative,
        });

        if (outcome === 'created') result.imported += 1;
        else if (outcome === 'replaced') result.replaced += 1;
        if (contested) result.contested += 1;
    }

    /**
     * Take one sound onto the rack, whichever door it arrived through.
     *
     * The scan is one caller and the console is the other, and they share this because the tail is
     * where every rule about what a pad IS lives: the file on disk, the bytes in the store, the row,
     * the set it joins and the measurement. A door that skipped the last two would produce pads on no
     * set showing a dash in the loudness column forever, with nothing to backfill either.
     *
     * ## The file is written under the NAME, never under the filename it arrived as
     *
     * `padNameOf` runs on the filename at the next scan, so a sound saved as `Air Horn (2).mp3` under
     * the chosen name `airhorn` would come back as a SECOND pad called `air-horn-2`. Written as
     * `<board>/<name>.<ext>`, the re-scan derives the same name, sees the same checksum, answers
     * `unchanged`, and leaves an operator-set label alone — `importFile` only rewrites `label` when
     * the bytes changed.
     *
     * ## The disk write is the one step here that is NOT best-effort
     *
     * `join` and `measure` below are both allowed to fail and cost only what they were for. This is
     * not: `docs/todo/backup-and-restore.md` carries this directory and treats the content store as
     * disposable, so bytes that reached only the store are a pad that is absent from every export and
     * gone after a restore, with nothing logged anywhere. A refusal the operator can see is strictly
     * better, so this throws.
     */
    async ingest(request: PadIngest): Promise<PadIngested> {
        if (!boardIsSafe(request.board)) throw new Error(`"${request.board}" is not a board a file can be filed under`);

        const relative = request.onDisk ?? (await this.write(request));
        const checksum = await this.store.write(request.bytes, request.ext);

        const { pad, outcome } = await this.pads.importFile({
            board: request.board,
            name: request.name,
            label: request.label,
            source: request.source,
            sourcePath: relative,
            audioChecksum: checksum,
            audioExt: request.ext,
        });

        // The set of the same name, created if absent, and joined on EVERY pass rather than only on
        // the one that created the row. That is what keeps dropping files in a directory a complete
        // answer: an operator who took a pad off its own set by hand has said something and a re-scan
        // must not undo it, but a set an operator DELETED should come back the moment the files are
        // rescanned, because the directory is still the claim.
        //
        // A name the set already answers to is reported rather than thrown, because the case that
        // reaches it is two directories holding `airhorn.wav` and one set pointed at both — which is
        // a thing to tell somebody about, not a reason to fail forty other files.
        const contested = await this.join(pad, request.board);

        if (outcome === 'created') {
            this.logger.info('render: put a new pad on a board', { pad: pad.id, board: pad.board, name: pad.name, source: request.source });
            await this.measure(pad);
        } else if (outcome === 'replaced') {
            // Worth a line where `unchanged` is not: the station is already saying this name, and
            // what it now plays is a different sound.
            this.logger.info('render: a pad was replaced by a new file under the same name', { pad: pad.id, board: pad.board, name: pad.name });
            // Measured again, because `importFile` cleared the old figures: they described the file
            // that used to be in this slot, and levelling a new sound against the old one is the
            // failure that column exists to prevent.
            await this.measure(pad);
        }

        return { pad, outcome, contested };
    }

    /** Put the bytes in the library directory, and answer where they landed. Throws; see {@link ingest}. */
    private async write(request: PadIngest): Promise<string> {
        const relative = join(request.board, `${request.name}.${request.ext}`);

        await mkdir(join(this.root, request.board), { recursive: true });
        await writeFile(join(this.root, relative), request.bytes);

        return relative;
    }

    /**
     * How long a pad runs and how loud it came out, best-effort.
     *
     * The same call the render path makes about a break and held to the same rule: **nothing here may
     * cost the operator their pad.** A station with no analyzer measures nothing and plays everything,
     * which is ordinary rather than a fault, so this is awaited and never thrown from.
     *
     * It matters more here than on a break and in the other direction. A break arrives at whatever
     * level the speech engine produced, which is consistent; a pad is mastered by whoever made it, and
     * an air horn is mastered LOUD. Without a figure the console can only say "—" beside a sound that
     * is twelve decibels hotter than the words it is about to land on.
     *
     * **What reads it today is a person.** Nothing computes an `AudioOverlay.gainDb` from it; it is
     * reported so an operator can see the mismatch and re-master or set the duck.
     *
     * **A short pad legitimately has no loudness at all**, and that is measured rather than assumed:
     * integrated loudness to BS.1770 is gated in 400ms blocks, so a 350ms rimshot produces no block
     * and the analyzer answers with cue points and peaks and no `integratedLufs`. Which is most
     * pads. A dash in that column is therefore the honest answer for a short sound rather than a
     * measurement that failed, and nothing here should ever invent one.
     *
     * The URL is the station's own content-addressed route, for the reason every other measurement
     * uses one: the bytes measured are the bytes that will air, and it is reachable from a sidecar
     * container where a path on this machine's disk is not.
     */
    private async measure(pad: Pad): Promise<void> {
        try {
            const url = storedAudioUrl(resolvePlayoutBaseUrl(this.config), pad.audioChecksum, pad.audioExt);
            const result = await this.analysis.measureAudio(pad.id, url);
            if (result === undefined) return;

            // `durationMs` is a field of the ANALYSIS and `integratedLufs` is a field of its `data`
            // blob, which is not a distinction to guess at: the first is what the analyzer measured
            // the file to be, the second is one of the detectors' outputs. Read from the wrong half,
            // this silently records nothing forever.
            const durationMs = result.durationMs;
            const loudnessLufs = result.data.integratedLufs;

            await this.pads.measured(pad.id, {
                ...(typeof durationMs === 'number' && Number.isFinite(durationMs) ? { durationMs } : {}),
                ...(typeof loudnessLufs === 'number' && Number.isFinite(loudnessLufs) ? { loudnessLufs } : {}),
            });
        } catch (error) {
            this.logger.warn('render: could not measure a pad; it will play at whatever level it was made at', {
                pad: pad.id,
                error: errorText(error),
            });
        }
    }

    /**
     * Put one pad on the set named after its directory, making the set if this is the first file.
     *
     * Best-effort like the measurement beside it: a set that could not be written costs the pad its
     * rack and never the import, because the row is in the library either way and an operator can
     * put it on a set by hand.
     *
     * Answers whether the name was contested rather than counting it, because a count belongs to a
     * SCAN and this runs for a single upload too.
     */
    private async join(pad: Pad, board: string): Promise<boolean> {
        try {
            const set = await this.sets.ensure({ key: board, label: board });
            const outcome = await this.sets.add(set.id, pad.id);

            if (outcome === 'name-taken') {
                this.logger.warn('render: a set already answers to this name, so the new pad is in the library and not on it', {
                    pad: pad.id,
                    set: set.key,
                    name: pad.name,
                });
                return true;
            }
        } catch (error) {
            this.logger.warn('render: could not put a pad on its set', { pad: pad.id, board, error: errorText(error) });
        }

        return false;
    }
}

/** Which board a file loose at the top of the library lands on, absent a directory saying otherwise. */
export const DEFAULT_BOARD = 'station';

/**
 * The most a single sound may weigh.
 *
 * Bounds what arrives over HTTP; a file already on the disk is already on the disk. Deliberately
 * above `@maroonedsoftware/multipart`'s own 20 MB default rather than below it, and deliberately not
 * a `deadair.settings` row: `docs/todo/backup-and-restore.md` is where the figure comes from, in that
 * "a drop is a few kilobytes, but the bed that runs under a phone call is minutes of stereo" — so ten
 * would refuse a legitimate bed, and a ceiling an operator can raise is a ceiling that stops meaning
 * anything.
 */
export const MAX_PAD_BYTES = 25 * 1024 * 1024;

/**
 * Whether a board is a name a file can be filed under.
 *
 * The scan takes its boards from directory names, which are safe by construction. A console upload
 * takes one from whoever is typing, and `join(root, board)` with `../..` in it writes wherever it
 * likes — so this is checked at the seam rather than at each door, because the guarantee wanted is
 * that nothing can escape the library root rather than that each caller remembered.
 *
 * A LIMIT rather than a normalisation: `My Board` is a directory an operator may legitimately have
 * made by hand, and rewriting it here would file an upload somewhere the scan does not look.
 */
export function boardIsSafe(board: string): boolean {
    const trimmed = board.trim();

    if (trimmed === '' || trimmed.length > 200) return false;
    if (trimmed.startsWith('.')) return false;

    return !/[/\\\0]/.test(trimmed);
}

/**
 * Audio the station recognises but does not serve, so a file in one of these formats is refused out
 * loud rather than counted as a stray. `SegmentLibrary`'s list, and for its reason.
 */
const AUDIO_EXTENSIONS = new Set(['oga', 'opus', 'aac', 'aif', 'aiff', 'wma', 'alac', 'amr', 'ape', 'wv']);

/**
 * A filename as the token a script writes.
 *
 * Lower-cased, with runs of anything that is not a letter or a digit collapsed to a single `-`, so
 * `Air Horn 2.mp3` and `air_horn_2.mp3` are one name rather than two. Deliberately narrow: this ends
 * up inside `[sfx:…]` in a prompt and then in a model's answer, and a token carrying a space or a
 * bracket is a token the answer parser has to be clever about.
 *
 * `undefined` where nothing survives, which is a file that cannot be a pad rather than one with an
 * awkward name.
 */
export function padNameOf(relative: string): string | undefined {
    const file = relative.split('/').pop() ?? relative;
    return padName(file.slice(0, file.length - extname(file).length));
}

/**
 * A word somebody TYPED as that same token.
 *
 * {@link padNameOf} one step in, for the console door: an operator naming a sound in a form is making
 * exactly the claim a filename makes, so it had better normalise identically — a name that came out
 * of a box and a name that came off a file must not be two pads.
 */
export function padName(text: string): string | undefined {
    const name = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return name === '' ? undefined : name;
}

/**
 * A filename as something a person reads.
 *
 * `SegmentLibrary.labelFor` exactly, and separate from {@link padNameOf} for the reason the two
 * columns are separate: one is prose for a console and the other is a token for a model.
 *
 * Exported because both doors derive one and they have to derive it identically.
 */
export function labelFor(relative: string): string {
    const name = relative.split('/').pop() ?? relative;
    const stem = name.slice(0, name.length - extname(name).length);
    return stem.replace(/[-_]+/g, ' ').trim() || stem;
}

