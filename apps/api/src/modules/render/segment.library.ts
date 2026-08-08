import { mkdir, readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { SegmentRepository, type Segment } from './segment.repository.js';
import { isSegmentExtension, SegmentStore } from './segment.store.js';

/** What one pass over the inbox did. */
export interface LibraryScan {
    /** Audio files seen, whether or not they were new. */
    scanned: number;
    /** Segments the station did not have before this pass. */
    imported: number;
    /** Files passed over: not audio, or unreadable. */
    skipped: number;
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
            // An operator who drops forty wavs in and is told "skipped: 40" has been told nothing.
            // Audio the station cannot serve is named as such, once per file per pass, because the
            // fix (convert it to mp3) is only obvious to somebody who knows why it was refused.
            if (AUDIO_EXTENSIONS.has(ext)) {
                this.logger.warn('render: the segment inbox holds audio the station cannot serve; convert it to mp3', {
                    file: file.relative,
                    format: ext,
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

        const checksum = await this.store.write(bytes, ext);
        const { segment, created } = await this.segments.importFile({
            kind: file.kind,
            label: labelFor(file.relative),
            sourcePath: file.relative,
            audioChecksum: checksum,
            audioExt: ext,
        });

        if (created) {
            result.imported += 1;
            this.logger.info('render: took a new segment into the library', { segment: segment.id, kind: segment.kind, label: segment.label });
        }
        return segment;
    }
}

/** What a file loose in the inbox is, absent a directory saying otherwise. */
const DEFAULT_KIND = 'ident';

/**
 * Audio the station recognises but does not serve, so a file in one of these formats is refused out
 * loud rather than counted as a stray. See the note on `SEGMENT_EXTENSIONS` for why the store holds
 * one format.
 */
const AUDIO_EXTENSIONS = new Set(['wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'aif', 'aiff', 'wma', 'alac']);

/**
 * A filename as something a listener can read.
 *
 * This ends up on the mount as the title while the segment airs, so `station-ident-1.mp3` reaching
 * somebody's car stereo as "station ident 1" is the whole of the ambition. Nothing here tries to be
 * clever about capitalisation: an operator who wants exact wording renames the file, and a guess
 * that title-cased "a" and "the" would be wrong more often than the raw name is.
 */
function labelFor(relative: string): string {
    const name = relative.split('/').pop() ?? relative;
    const stem = name.slice(0, name.length - extname(name).length);
    return stem.replace(/[-_]+/g, ' ').trim() || stem;
}
