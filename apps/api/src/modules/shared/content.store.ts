import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** sha256 hex, exactly. Both halves of a path are checked against this before any filesystem call. */
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Bytes on disk, content-addressed, with one mime per format.
 *
 * `<root>/<first-2-of-checksum>/<checksum>.<ext>`. The shard keeps a station with tens of thousands
 * of files off one directory listing, and the checksum name is what makes the same bytes reached two
 * ways one file rather than two. Writing is idempotent by construction, so there is no existence
 * check anywhere here.
 *
 * ## Why this is shared rather than copied
 *
 * The station keeps two of these — cover art and segment audio — and the tempting reading is that
 * two is not enough to abstract over. The argument is not the count. It is that the duplicated part
 * is the **path safety**: nothing here takes a caller-supplied path, a checksum has to match
 * {@link CHECKSUM_PATTERN}, an extension has to be one this store was built with, and traversal is
 * therefore rejected before any filesystem call rather than normalized away after one. That is the
 * code you least want two copies of, because a fix to one would silently not reach the other, and
 * the failure it guards against is not the kind that shows up in a test nobody wrote.
 *
 * ## What a subclass supplies, and why it is the mime map
 *
 * The formats, as a map from extension to what that format is SERVED as. The two belong together
 * because a store that can hold a format it cannot name is a route that announces the wrong type,
 * and both consumers of these bytes — a browser and Liquidsoap — decide what to do with them from
 * that header rather than from the bytes. Keeping the pair in one place is what makes "the store
 * holds it" and "the contract declares it" one fact instead of two that can drift.
 *
 * Deliberately no `Kysely` and no `AppConfig`: the row saying which checksum belongs to what is a
 * repository's business, and this is only the file.
 */
export class ContentStore<Ext extends string> {
    constructor(
        private readonly root: string,
        private readonly contentTypes: Readonly<Record<Ext, string>>,
    ) {}

    /** Every format this store holds. */
    get extensions(): readonly Ext[] {
        return Object.keys(this.contentTypes) as Ext[];
    }

    /** What a format is served as. The answer a route puts in its Content-Type. */
    contentTypeFor(ext: Ext): string {
        return this.contentTypes[ext];
    }

    /** Whether this store holds that format. Narrows, so a string off a row can be used as an extension. */
    isExtension(value: string | undefined): value is Ext {
        return value !== undefined && Object.hasOwn(this.contentTypes, value);
    }

    /**
     * Writes the bytes and answers where they went.
     *
     * Idempotent: the same bytes hash to the same name, so a rewrite is the same file with the same
     * contents.
     */
    async write(bytes: Buffer, ext: Ext): Promise<string> {
        const checksum = createHash('sha256').update(bytes).digest('hex');
        const path = this.pathFor(checksum, ext);

        await mkdir(join(this.root, checksum.slice(0, 2)), { recursive: true });
        await writeFile(path, bytes);

        return checksum;
    }

    /**
     * The bytes, or `undefined` if there is no such file.
     *
     * Declines rather than throws, and takes a bare `string` rather than an `Ext`, because both
     * halves come from a database row: a row edited by hand, or written by an older version of the
     * app, should read as "nothing to serve" instead of as a 500.
     */
    async read(checksum: string, ext: string): Promise<Buffer | undefined> {
        if (!CHECKSUM_PATTERN.test(checksum) || !this.isExtension(ext)) return undefined;

        return await readFile(this.pathFor(checksum, ext)).catch(() => undefined);
    }

    /** Absolute path for a checksum. Throws rather than guessing if either half is not what it claims. */
    pathFor(checksum: string, ext: Ext): string {
        if (!CHECKSUM_PATTERN.test(checksum)) throw new Error(`Not a sha256 checksum: ${checksum}`);
        if (!this.isExtension(ext)) throw new Error(`Not an extension this store holds: ${ext}`);

        return join(this.root, checksum.slice(0, 2), `${checksum}.${ext}`);
    }
}
