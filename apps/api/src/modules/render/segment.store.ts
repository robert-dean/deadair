import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Filename extensions the store will write or read.
 *
 * **One format, deliberately, and the reason is the Content-Type rather than the disk.** These
 * bytes are fetched by two consumers that both decide what to do with them from the response
 * header: a browser previewing the segment in an `<audio>` element (which, unlike an `<img>`, does
 * not sniff), and Liquidsoap, which names the temp file it downloads to after the content type and
 * then picks a decoder by that name. The generated router pins `ctx.type` from the one mime
 * declared on the operation and a service cannot vary it per file (see the same note in
 * `apps/api/data/contracts/art/art.ck`), so a store holding five formats behind one route would be
 * announcing four of them as something they are not, and the failure would be a segment that
 * silently does not play rather than an error anybody sees.
 *
 * mp3 rather than another one because it is what the station already is: `radio.liq` encodes the
 * mount as mp3, and every TTS backend worth pointing at emits it. Widening this is a real
 * possibility and has two honest routes, neither of which is needed yet: one operation per format,
 * or a transcode on import once ffmpeg arrives with multi-voice shows. Anything else in the inbox
 * is passed over with a log line rather than imported as a segment that cannot be heard.
 */
export const SEGMENT_EXTENSIONS = ['mp3'] as const;

export type SegmentExtension = (typeof SEGMENT_EXTENSIONS)[number];

/** What each extension is served as, and what the route declares. */
export const SEGMENT_CONTENT_TYPES: Record<SegmentExtension, string> = {
    mp3: 'audio/mpeg',
};

/** sha256 hex, exactly. Both halves of a path are checked against this before any filesystem call. */
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

export function isSegmentExtension(value: string | undefined): value is SegmentExtension {
    return value !== undefined && (SEGMENT_EXTENSIONS as readonly string[]).includes(value);
}

/**
 * The audio on disk, content-addressed.
 *
 * `<root>/<first-2-of-checksum>/<checksum>.<ext>`, the same layout and the same reasoning as
 * `ArtStore`: the shard keeps a station with thousands of segments off one directory listing, and
 * the checksum name is what makes the same recording imported twice one file rather than two.
 *
 * This is the station's own copy and is the only one anything reads back. The inbox a file arrived
 * in is an INBOX: emptying it does not take a segment off the air, which is the point of copying
 * rather than referencing.
 *
 * Nothing here takes a caller-supplied path. A checksum has to match {@link CHECKSUM_PATTERN} and
 * an extension has to be one of {@link SEGMENT_EXTENSIONS}, so there are no separators to escape
 * with and traversal is rejected before any filesystem call rather than normalized away after one.
 *
 * Deliberately no `Kysely` and no `AppConfig` lookups of its own: the row that says which checksum
 * is which segment is `SegmentRepository`'s business, and this is only the file.
 */
export class SegmentStore {
    constructor(private readonly root: string) {}

    /**
     * Writes the bytes and answers where they went.
     *
     * Idempotent by construction: the same bytes hash to the same name, so a rewrite is the same
     * file with the same contents. No existence check for that reason.
     */
    async write(bytes: Buffer, ext: SegmentExtension): Promise<string> {
        const checksum = createHash('sha256').update(bytes).digest('hex');
        const path = this.pathFor(checksum, ext);

        await mkdir(join(this.root, checksum.slice(0, 2)), { recursive: true });
        await writeFile(path, bytes);

        return checksum;
    }

    /** The bytes, or `undefined` if the file is gone. A missing file is a segment that cannot air, not a crash. */
    async read(checksum: string, ext: string): Promise<Buffer | undefined> {
        if (!CHECKSUM_PATTERN.test(checksum) || !isSegmentExtension(ext)) return undefined;

        return await readFile(this.pathFor(checksum, ext)).catch(() => undefined);
    }

    /** Absolute path for a checksum. Throws rather than guessing if either half is not what it claims. */
    pathFor(checksum: string, ext: SegmentExtension): string {
        if (!CHECKSUM_PATTERN.test(checksum)) throw new Error(`Not a sha256 checksum: ${checksum}`);
        if (!isSegmentExtension(ext)) throw new Error(`Not a segment extension: ${ext}`);

        return join(this.root, checksum.slice(0, 2), `${checksum}.${ext}`);
    }
}
