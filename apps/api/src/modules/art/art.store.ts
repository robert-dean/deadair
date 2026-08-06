import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** Filename extensions the store will write or read. Anything else is not art we serve. */
export const ART_EXTENSIONS = ['jpg', 'png', 'webp', 'gif'] as const;

export type ArtExtension = (typeof ART_EXTENSIONS)[number];

/** Response content types the cacher accepts, mapped to the extension the file gets on disk. */
export const ART_CONTENT_TYPES: Record<string, ArtExtension> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

/** sha256 hex, exactly. Both halves of a path are checked against this before any filesystem call. */
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

export function isArtExtension(value: string | undefined): value is ArtExtension {
    return value !== undefined && (ART_EXTENSIONS as readonly string[]).includes(value);
}

/**
 * The bytes on disk, content-addressed.
 *
 * `<root>/<first-2-of-checksum>/<checksum>.<ext>`. The shard exists so a station with tens of
 * thousands of covers is not one directory listing; the checksum name is what makes the same image
 * reached by two upstream URLs one file rather than two.
 *
 * Nothing here takes a caller-supplied path. A checksum has to match {@link CHECKSUM_PATTERN} and an
 * extension has to be one of {@link ART_EXTENSIONS}, so there are no separators to escape with and
 * traversal is rejected before any filesystem call rather than normalized away after one.
 *
 * Deliberately no `Kysely` and no `AppConfig` lookups of its own: the row that says which checksum
 * belongs to which asset is `ArtRepository`'s business, and this is only the file.
 */
export class ArtStore {
    constructor(private readonly root: string) {}

    /**
     * Writes the bytes and answers where they went.
     *
     * Idempotent by construction: the same bytes hash to the same name, so a rewrite is the same
     * file with the same contents. No existence check for that reason.
     */
    async write(bytes: Buffer, ext: ArtExtension): Promise<string> {
        const checksum = createHash('sha256').update(bytes).digest('hex');
        const path = this.pathFor(checksum, ext);

        await mkdir(join(this.root, checksum.slice(0, 2)), { recursive: true });
        await writeFile(path, bytes);

        return checksum;
    }

    /** The bytes, or `undefined` if the file is gone. A missing file is a cache miss, not an error. */
    async read(checksum: string, ext: string): Promise<Buffer | undefined> {
        if (!CHECKSUM_PATTERN.test(checksum) || !isArtExtension(ext)) return undefined;

        return await readFile(this.pathFor(checksum, ext)).catch(() => undefined);
    }

    /** Absolute path for a checksum. Throws rather than guessing if either half is not what it claims. */
    pathFor(checksum: string, ext: ArtExtension): string {
        if (!CHECKSUM_PATTERN.test(checksum)) throw new Error(`Not a sha256 checksum: ${checksum}`);
        if (!isArtExtension(ext)) throw new Error(`Not an art extension: ${ext}`);

        return join(this.root, checksum.slice(0, 2), `${checksum}.${ext}`);
    }
}
