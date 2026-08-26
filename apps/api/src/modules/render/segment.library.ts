import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { errorText } from '#modules/shared/error.text.js';
import { SegmentRepository, type Segment } from './segment.repository.js';
import { isSegmentExtension, SEGMENT_EXTENSIONS, SegmentStore, subdirectoryIsSafe, type SegmentExtension } from './segment.store.js';

/** What one pass over the inbox did. */
export interface LibraryScan {
    /** Audio files seen, whether or not they were new. */
    scanned: number;
    /** Segments the station did not have before this pass. */
    imported: number;
    /** Files passed over: not audio, or unreadable. */
    skipped: number;
}

/** One recording arriving, from whichever door. See {@link SegmentLibrary.ingest}. */
export interface SegmentIngest {
    /** The audio itself. */
    bytes: Buffer;
    ext: SegmentExtension;
    /** The directory it is filed under, which IS its kind. Validated by `subdirectoryIsSafe`. */
    kind: string;
    /** What the console calls it, and what the mount is labelled with while it airs. */
    label: string;
    /**
     * Where it already sits, relative to the inbox root, when the caller read it off that disk.
     *
     * The scan sets it and nothing else does. Absent means the bytes arrived over HTTP and this has
     * to put them on disk itself; present means they are already there and copying them onto
     * themselves would be a needless write.
     */
    onDisk?: string;
}

/**
 * The inbox: audio dropped on disk becomes something the station can play.
 *
 * Deliberately a scanned directory rather than an upload endpoint. Two reasons, in order of how
 * much they matter:
 *
 * 1. It is how the station already takes delivery of audio. `radio.liq` re-scans `MUSIC_DIR` on a
 *    timer for exactly this reason, and an operator who already knows how to put a track in front
 *    of deadair does not have to learn a second way to put an ident in front of it.
 * 2. No contract in this repo accepts a file, so an upload route would mean inventing multipart
 *    handling for the first delivery of the first feature that wants it.
 *
 * The inbox is only an inbox. Bytes are COPIED into the content-addressed store on import, so
 * emptying the directory afterwards does not take a segment off the air, and re-filling it does not
 * produce duplicates: the checksum is the identity.
 *
 * A subdirectory names the {@link Segment.kind}, which is the whole of the taxonomy: drop a file in
 * `ident/` and it is an ident. Anything loose at the top is an ident too, that being what a station
 * with one folder of audio almost certainly has.
 */
@Injectable()
export class SegmentLibrary {
    constructor(
        private readonly store: SegmentStore,
        private readonly segments: SegmentRepository,
        private readonly root: string,
        private readonly logger: Logger,
    ) {}

    /**
     * Take everything in the inbox into the library.
     *
     * Safe to run repeatedly and safe to run concurrently: every file settles on its own, the store
     * write is content-addressed, and the row insert resolves its own conflict. A file that cannot
     * be read is counted and passed over rather than failing the pass, because one unreadable file
     * must not cost the operator the other forty.
     */
    async scan(): Promise<LibraryScan> {
        // Created rather than merely tolerated when missing: an empty directory is a place to drop
        // files, while no directory at all is a feature the operator cannot find.
        await mkdir(this.root, { recursive: true });

        const result: LibraryScan = { scanned: 0, imported: 0, skipped: 0 };
        for (const file of await this.audioFiles()) await this.importOne(file, result);

        if (result.imported > 0 || result.skipped > 0) {
            this.logger.info('render: scanned the segment inbox', { ...result, inbox: this.root });
        }
        return result;
    }

    /**
     * Everything in the inbox that is audio, with the kind its directory gives it.
     *
     * One level deep on purpose. The directory means something here (it is the kind), so a nested
     * tree would have to decide what `ident/jingles/short/x.mp3` is called, and the answer would be
     * a convention nobody asked for.
     */
    private async audioFiles(): Promise<{ path: string; relative: string; kind: string }[]> {
        const found: { path: string; relative: string; kind: string }[] = [];

        for (const entry of await readdir(this.root, { withFileTypes: true }).catch(() => [])) {
            // Dotfiles are not deliveries. `.DS_Store` in particular arrives in every directory a
            // Mac has ever looked at, and would otherwise be counted as a file passed over on
            // every single pass.
            if (entry.name.startsWith('.')) continue;

            if (entry.isDirectory()) {
                const kind = entry.name;
                for (const nested of await readdir(join(this.root, kind), { withFileTypes: true }).catch(() => [])) {
                    if (nested.isFile() && !nested.name.startsWith('.')) {
                        found.push({ path: join(this.root, kind, nested.name), relative: join(kind, nested.name), kind });
                    }
                }
            } else if (entry.isFile()) {
                found.push({ path: join(this.root, entry.name), relative: entry.name, kind: DEFAULT_KIND });
            }
        }

        return found;
    }

    /** Import one file, counting the outcome. Answers `undefined` for anything that did not become a segment. */
    private async importOne(file: { path: string; relative: string; kind: string }, result: LibraryScan): Promise<Segment | undefined> {
        const ext = extname(file.path).slice(1).toLowerCase();
        if (!isSegmentExtension(ext)) {
            // An operator who drops forty files in and is told "skipped: 40" has been told nothing.
            // Audio the station cannot serve is named as such, once per file per pass, because the
            // fix (convert it) is only obvious to somebody who knows why it was refused. A text
            // file in the same directory is not worth a line: it was never a delivery.
            if (AUDIO_EXTENSIONS.has(ext)) {
                this.logger.warn('render: the segment inbox holds audio in a format the station does not serve', {
                    file: file.relative,
                    format: ext,
                    serves: SEGMENT_EXTENSIONS.join(', '),
                });
            }
            result.skipped += 1;
            return undefined;
        }
        result.scanned += 1;

        const bytes = await readFile(file.path).catch(() => undefined);
        if (bytes === undefined) {
            this.logger.warn('render: could not read a file in the segment inbox', { file: file.relative });
            result.skipped += 1;
            return undefined;
        }

        const { segment, created } = await this.ingest({
            bytes,
            ext,
            kind: file.kind,
            label: labelFor(file.relative),
            onDisk: file.relative,
        });

        if (created) result.imported += 1;
        return segment;
    }

    /**
     * Take one recording into the library, whichever door it arrived through.
     *
     * The scan is one caller and the console is the other. Shorter than `PadLibrary.ingest`'s tail
     * because a segment joins nothing and is measured by nothing — `durationMs` is a display value
     * the player works out for itself — so what is shared is the file, the bytes and the row.
     *
     * ## The disk write is the one step here that is NOT best-effort
     *
     * `docs/todo/backup-and-restore.md` carries this directory as tier 1 and treats the content store
     * as disposable, because the boot scan rewrites the store from here. So bytes that reached only
     * the store are a recording that is absent from every export and gone after a restore, with
     * nothing logged anywhere. A refusal the operator can see is strictly better, so this throws.
     *
     * ## A name already taken is written BESIDE rather than over
     *
     * This is where a segment differs from a pad and the difference is not cosmetic. A pad's identity
     * is `(board, name)`, so a second file under one name REPLACES what that slot holds and writing
     * over it is the correct thing to do. A segment's identity is its CHECKSUM, so two different
     * recordings both called `ident.mp3` are two segments — and writing the second over the first
     * would leave the first row's `source_path` naming bytes that are not its own, which the archive
     * then carries in place of the audio that row actually plays. Nothing would report it.
     *
     * So a path already holding DIFFERENT bytes gets `-2`, `-3` and so on, while a path holding the
     * SAME bytes is left exactly as it is: `importFile` will answer with the existing row anyway, and
     * rewriting a byte-identical file would churn the directory an operator is looking at.
     */
    async ingest(request: SegmentIngest): Promise<{ segment: Segment; created: boolean }> {
        if (!subdirectoryIsSafe(request.kind)) throw new Error(`"${request.kind}" is not a kind a file can be filed under`);

        const checksum = await this.store.write(request.bytes, request.ext);
        const relative = request.onDisk ?? (await this.write(request, checksum));

        const { segment, created } = await this.segments.importFile({
            kind: request.kind,
            label: request.label,
            sourcePath: relative,
            audioChecksum: checksum,
            audioExt: request.ext,
        });

        if (created) {
            this.logger.info('render: took a new segment into the library', { segment: segment.id, kind: segment.kind, label: segment.label });
        }

        return { segment, created };
    }

    /**
     * Take one segment's file back off the disk.
     *
     * The other end of {@link ingest}'s write, and what makes `RenderService.deleteSegment` mean
     * anything: a row removed on its own comes back on the next scan, because the file is still there
     * making the same claim it always did.
     *
     * Best-effort, which is the opposite call to the write it undoes and not an inconsistency: a
     * write that fails leaves a recording nothing can back up, where a delete that fails leaves a
     * file the next scan re-imports — visible, in the library, and fixable by hand. A file already
     * gone is the ordinary case rather than a fault.
     *
     * It never touches the content store, whose bytes are content-addressed and shared: what may be
     * removed there is a question about every other row naming that checksum.
     */
    async discard(segment: Segment): Promise<void> {
        if (segment.sourcePath === undefined) return;

        try {
            await rm(join(this.root, segment.sourcePath), { force: true });
        } catch (error) {
            this.logger.warn('render: could not take a segment\'s file off the disk; the next scan will read it back in', {
                segment: segment.id,
                file: segment.sourcePath,
                error: errorText(error),
            });
        }
    }

    /**
     * Put the bytes in the inbox, and answer where they landed. Throws; see {@link ingest}.
     *
     * The suffix search is bounded rather than open: past a handful of collisions under one name the
     * operator is uploading into a mess of their own and a number is not the fix, so it gives up and
     * lets the ingest fail rather than counting to a thousand.
     */
    private async write(request: SegmentIngest, checksum: string): Promise<string> {
        const stem = request.label.replace(/[/\\\0]/g, '-').trim() || 'segment';

        await mkdir(join(this.root, request.kind), { recursive: true });

        for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
            const relative = join(request.kind, `${stem}${attempt === 1 ? '' : `-${attempt}`}.${request.ext}`);
            const held = await this.checksumAt(relative);

            // Free, or already holding exactly these bytes. The second case writes nothing: the row
            // this is about to answer with is the one that file already produced.
            if (held === undefined) {
                await writeFile(join(this.root, relative), request.bytes);
                return relative;
            }
            if (held === checksum) return relative;
        }

        throw new Error(`the inbox already holds ${MAX_NAME_ATTEMPTS} different recordings called "${stem}"`);
    }

    /** What is at this path, or `undefined` where nothing is. */
    private async checksumAt(relative: string): Promise<string | undefined> {
        const bytes = await readFile(join(this.root, relative)).catch(() => undefined);

        return bytes === undefined ? undefined : createHash('sha256').update(bytes).digest('hex');
    }
}

/** What a file loose in the inbox is, absent a directory saying otherwise. */
export const DEFAULT_KIND = 'ident';

/**
 * The most a single recording may weigh.
 *
 * Its own constant rather than `MAX_PAD_BYTES` shared, because the two are different things: a pad is
 * a drop measured in kilobytes and this is a recording somebody made, so one number covering both
 * would be named after neither and would be set for whichever was argued about last.
 */
export const MAX_SEGMENT_BYTES = 50 * 1024 * 1024;

/**
 * How many recordings may share one name before the inbox gives up.
 *
 * A bound rather than an open search: past a handful of files called the same thing the operator is
 * uploading into a mess of their own, and a bigger number is not the fix.
 */
const MAX_NAME_ATTEMPTS = 20;

/**
 * Audio the station recognises but does not serve, so a file in one of these formats is refused out
 * loud rather than counted as a stray. The counterpart to `SEGMENT_CONTENT_TYPES`, which is what it
 * does serve: this list is the near misses worth a log line, not every extension in existence.
 */
const AUDIO_EXTENSIONS = new Set(['oga', 'opus', 'aac', 'aif', 'aiff', 'wma', 'alac', 'wma', 'amr', 'ape', 'wv']);

/**
 * A filename as something a listener can read.
 *
 * This ends up on the mount as the title while the segment airs, so `station-ident-1.mp3` reaching
 * somebody's car stereo as "station ident 1" is the whole of the ambition. Nothing here tries to be
 * clever about capitalisation: an operator who wants exact wording renames the file, and a guess
 * that title-cased "a" and "the" would be wrong more often than the raw name is.
 *
 * Exported because the console door derives one too, and the two have to derive it identically or an
 * uploaded recording and a dropped one are labelled by different rules.
 */
export function labelFor(relative: string): string {
    const name = relative.split('/').pop() ?? relative;
    const stem = name.slice(0, name.length - extname(name).length);
    return stem.replace(/[-_]+/g, ' ').trim() || stem;
}
