import { mkdir, readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { PadRepository } from './pad.repository.js';
import { isSegmentExtension, SEGMENT_EXTENSIONS, SegmentStore } from './segment.store.js';

/** What one pass over the pad inbox did. */
export interface PadScan {
    /** Audio files seen, whether or not anything changed. */
    scanned: number;
    /** Pads the station did not have before this pass. */
    imported: number;
    /** Slots whose file changed under them. */
    replaced: number;
    /** Files passed over: not audio, or unreadable. */
    skipped: number;
}

/**
 * The pad inbox: audio dropped on disk becomes something a presenter can hit.
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
 * The one thing it deliberately does NOT do is remove a pad whose file has gone. An inbox is an
 * inbox — the bytes are in the store and the row is the station's — so the way to take a pad off a
 * board is to reject it, which is a decision that outlives the next scan. See
 * `PadRepository.setState`.
 */
@Injectable()
export class PadLibrary {
    constructor(
        private readonly store: SegmentStore,
        private readonly pads: PadRepository,
        private readonly root: string,
        private readonly logger: Logger,
    ) {}

    /**
     * Take everything in the inbox onto the rack.
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

        const result: PadScan = { scanned: 0, imported: 0, replaced: 0, skipped: 0 };
        for (const file of await this.audioFiles()) await this.importOne(file, result);

        if (result.imported > 0 || result.replaced > 0 || result.skipped > 0) {
            this.logger.info('render: scanned the pad inbox', { ...result, inbox: this.root });
        }
        return result;
    }

    /** Everything in the inbox that is audio, with the board its directory puts it on. */
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
                this.logger.warn('render: the pad inbox holds audio in a format the station does not serve', {
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
            this.logger.warn('render: a file in the pad inbox has no name a script could write', { file: file.relative });
            result.skipped += 1;
            return;
        }

        const bytes = await readFile(file.path).catch(() => undefined);
        if (bytes === undefined) {
            this.logger.warn('render: could not read a file in the pad inbox', { file: file.relative });
            result.skipped += 1;
            return;
        }

        const checksum = await this.store.write(bytes, ext);
        const { pad, outcome } = await this.pads.importFile({
            board: file.board,
            name,
            label: labelFor(file.relative),
            sourcePath: file.relative,
            audioChecksum: checksum,
            audioExt: ext,
        });

        if (outcome === 'created') {
            result.imported += 1;
            this.logger.info('render: put a new pad on a board', { pad: pad.id, board: pad.board, name: pad.name });
        } else if (outcome === 'replaced') {
            result.replaced += 1;
            // Worth a line where `unchanged` is not: the station is already saying this name, and
            // what it now plays is a different sound.
            this.logger.info('render: a pad was replaced by a new file under the same name', { pad: pad.id, board: pad.board, name: pad.name });
        }
    }
}

/** Which board a file loose in the inbox lands on, absent a directory saying otherwise. */
const DEFAULT_BOARD = 'station';

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
    const stem = file.slice(0, file.length - extname(file).length);
    const name = stem
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
 */
function labelFor(relative: string): string {
    const name = relative.split('/').pop() ?? relative;
    const stem = name.slice(0, name.length - extname(name).length);
    return stem.replace(/[-_]+/g, ' ').trim() || stem;
}
