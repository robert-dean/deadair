import { createHash } from 'node:crypto';
import { readdir, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { ContentStore } from '#modules/shared/content.store.js';
import { SEGMENT_CONTENT_TYPES, type SegmentExtension } from './segment.store.js';

/**
 * What a copy to share IS: AAC at this bitrate, in this many channels, in an `.m4a`.
 *
 * Decided here, once, and handed to whatever plugin encodes it. The client names a purpose
 * (`rendition=share`) and never these numbers, so changing them changes every client's copy without
 * a client changing. A minute of speech at these is about half a megabyte, which a plain MMS carries
 * where the rendered wav, at three megabytes a minute, does not.
 */
export const SHARE_BITRATE_KBPS = 64;
export const SHARE_CHANNELS = 1;
export const SHARE_EXTENSION = 'm4a' satisfies SegmentExtension;

/** How old a `.tmp-` file must be before the sweep takes it for an interrupted write rather than one in progress. */
export const SHARE_TEMPORARY_GRACE_MS = 60 * 60_000;

/**
 * Small copies of segment audio, made for a listener to send on.
 *
 * ## Not segments, and kept apart from them
 *
 * `VoiceSampleStore`'s argument, for the same reason: a copy has no row in `deadair.segments`, so it
 * cannot be planned, named by a lineup or aired, and a separate root makes that a fact about the
 * filesystem rather than a convention. It is lossy, which is fine for something that never airs and
 * would not be anywhere near the programme.
 *
 * ## Keyed, and a cache
 *
 * Named after the QUESTION (this audio, made into this kind of copy) rather than after its own bytes,
 * so a hit is the file being there and nothing has to remember a mapping. The SOURCE checksum is in
 * the key rather than the segment id, so a segment whose audio is ever replaced gets a fresh copy,
 * and two segments holding identical audio share one.
 *
 * Unlike the voice samples, **this store is swept**: anybody signed in can mint a copy of any break,
 * so it grows with how much the station is shared rather than with an operator's clicks.
 * `PruneShareCopiesJob` removes copies nobody has asked for in `render.shareCopyDays`, and a hit
 * {@link touch}es its file so that "asked for" is measured from the last request rather than the
 * first. Deleting one is always safe: no row points at it, so nothing else can be holding the file,
 * and the next request makes it again.
 */
export class SegmentShareStore extends ContentStore<SegmentExtension> {
    constructor(root: string) {
        super(root, SEGMENT_CONTENT_TYPES);
    }

    /**
     * The cache name for the share copy of one piece of segment audio.
     *
     * The numbers are in it, so changing what a copy is re-keys every copy rather than serving the
     * old ones as though they were the new kind. sha256 because {@link ContentStore} requires it.
     */
    keyFor(audioChecksum: string): string {
        return createHash('sha256').update(`share\naac\n${SHARE_BITRATE_KBPS}k\n${SHARE_CHANNELS}ch\n${audioChecksum}`).digest('hex');
    }

    /**
     * Marks a copy as asked for now, so the sweep measures its age from this request.
     *
     * Quiet on failure: a copy that vanished between the hit and this is served from the bytes
     * already read, and the next request remakes it.
     */
    async touch(key: string): Promise<void> {
        const now = new Date();
        await utimes(this.pathFor(key, SHARE_EXTENSION), now, now).catch(() => {});
    }

    /**
     * Removes the `.tmp-` files interrupted writes left at the root, and says how many.
     *
     * Its own method because `list()` reports such a file without a path, on purpose: in a store that
     * other code shares, a file it cannot account for is reported rather than deleted. Here only this
     * store's own writes ever land, so an old temp file is an encode that died, and leaving it would
     * keep it for good. Anything younger than the grace may still be being written, and is left.
     */
    async removeStaleTemporaries(now: number = Date.now()): Promise<number> {
        const names = await readdir(this.root).catch(() => [] as string[]);
        let removed = 0;

        for (const name of names) {
            if (!name.startsWith('.tmp-')) continue;

            const path = join(this.root, name);
            const stats = await stat(path).catch(() => undefined);
            if (stats === undefined || !stats.isFile() || now - stats.mtimeMs < SHARE_TEMPORARY_GRACE_MS) continue;

            await rm(path, { force: true });
            removed += 1;
        }

        return removed;
    }
}
