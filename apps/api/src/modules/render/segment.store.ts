import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Filename extensions the store will write or read, and what each one is served as.
 *
 * The two travel together because the Content-Type is the load-bearing half. Both consumers of
 * these bytes decide what to do with them from that header rather than from the bytes: a browser
 * previewing a segment in an `<audio>` element, which unlike an `<img>` does not sniff, and
 * Liquidsoap, which sends a HEAD before the GET, names the temp file it downloads to after the
 * content type, and picks its decoder from that name. Serving a wav as `audio/mpeg` therefore
 * fails as silence rather than as an error anyone sees.
 *
 * This list is what `render.ck` declares on the audio operation, and the two have to agree: the
 * service answers with the mime and the router sets `ctx.type` from it, so a format here that the
 * contract does not declare would not type-check, and one the contract declares that is missing
 * here can never be returned. Anything else in the inbox is passed over with a log line rather
 * than imported as a segment that cannot be heard.
 */
export const SEGMENT_CONTENT_TYPES = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
} as const satisfies Record<string, string>;

export type SegmentExtension = keyof typeof SEGMENT_CONTENT_TYPES;

export type SegmentContentType = (typeof SEGMENT_CONTENT_TYPES)[SegmentExtension];

export const SEGMENT_EXTENSIONS = Object.keys(SEGMENT_CONTENT_TYPES) as readonly SegmentExtension[];

/** sha256 hex, exactly. Both halves of a path are checked against this before any filesystem call. */
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

export function isSegmentExtension(value: string | undefined): value is SegmentExtension {
    return value !== undefined && Object.hasOwn(SEGMENT_CONTENT_TYPES, value);
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
