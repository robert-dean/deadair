import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
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
     * Writes bytes that arrive a chunk at a time, and answers where they went.
     *
     * The streaming twin of {@link ContentStore.write}, and the reason the audio a plugin produces
     * never exists whole anywhere: chunks are hashed and appended as they arrive, so a long
     * recording costs a buffer rather than a file of memory.
     *
     * The name cannot be known until the last byte has been seen, which is what a content-addressed
     * store means, so this writes to a temp file and renames it into place once the checksum is
     * settled. That is also what makes a failed write leave nothing behind: an interrupted render
     * must not leave a half file under a name that claims to be the whole of something.
     *
     * Idempotent for the same reason `write` is — the same bytes land on the same name — and the
     * rename is atomic within a filesystem, so two renders of identical audio racing each other end
     * with one intact file rather than two halves of one.
     */
    async writeStream(chunks: AsyncIterable<Uint8Array>, ext: Ext): Promise<string> {
        return await this.writeStreamInternal(chunks, ext);
    }

    /**
     * As {@link ContentStore.writeStream}, but filed under a name the caller chose.
     *
     * For a CACHE rather than a library: when the identity of the bytes is the question they answer
     * (this voice, saying this line) rather than the bytes themselves, the key is knowable before
     * the audio exists and a hit is the file being there. Nothing else has to remember the mapping,
     * which is a table and a repository this does not need.
     *
     * `key` must still be a sha256 hex string, so every path guard in this class applies unchanged;
     * derive it by hashing whatever actually identifies the content.
     */
    async writeStreamAs(key: string, chunks: AsyncIterable<Uint8Array>, ext: Ext): Promise<string> {
        if (!CHECKSUM_PATTERN.test(key)) throw new Error(`Not a sha256 checksum: ${key}`);
        return await this.writeStreamInternal(chunks, ext, key);
    }

    /**
     * The shared body of the two streaming writes: hash and spill to a temp file, then rename onto
     * the final path.
     *
     * `key` decides only what that final name is. Everything else — the hashing, the temp file, the
     * cleanup on failure — is identical, because the difference between a content-addressed store
     * and a keyed cache is where the name comes from and nothing about how the bytes are handled.
     */
    private async writeStreamInternal(chunks: AsyncIterable<Uint8Array>, ext: Ext, key?: string): Promise<string> {
        if (!this.isExtension(ext)) throw new Error(`Not an extension this store holds: ${ext}`);

        // Same directory as the destination, so the rename never crosses a filesystem and stays
        // atomic. A uuid rather than the checksum, which is not known yet.
        const temporaryPath = join(this.root, `.tmp-${randomUUID()}.${ext}`);
        await mkdir(this.root, { recursive: true });

        const hash = createHash('sha256');
        try {
            await pipeline(
                Readable.from(chunks).map((chunk: Uint8Array) => {
                    hash.update(chunk);
                    return chunk;
                }),
                createWriteStream(temporaryPath),
            );

            const checksum = key ?? hash.digest('hex');
            const path = this.pathFor(checksum, ext);
            await mkdir(join(this.root, checksum.slice(0, 2)), { recursive: true });
            await rename(temporaryPath, path);

            return checksum;
        } catch (error) {
            // Nothing readable is left behind by a write that did not finish. `force` because the
            // failure may well be that the temp file was never created.
            await rm(temporaryPath, { force: true }).catch(() => {});
            throw error;
        }
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

    /**
     * Whether the file is there, without reading it.
     *
     * For a caller that wants to know if something is IN HAND rather than to serve it: the playout
     * commit pass asks this of every record in its window on every pass, and reading a few tens of
     * megabytes to answer a yes-or-no question would be a strange way to save a provider round trip.
     *
     * Declines on a malformed checksum or extension exactly as {@link read} does, and for the same
     * reason: both halves come from a database row, and a row that is not what it claims means "no
     * file", never an exception thrown at a loop that was only asking.
     */
    async exists(checksum: string, ext: string): Promise<boolean> {
        if (!CHECKSUM_PATTERN.test(checksum) || !this.isExtension(ext)) return false;

        return await access(this.pathFor(checksum, ext))
            .then(() => true)
            .catch(() => false);
    }

    /**
     * Deletes the file, and says whether there was one.
     *
     * Declines rather than throwing on a malformed checksum or extension, exactly as {@link read}
     * and {@link exists} do and for the same reason: both halves come off a database row. A file
     * that is already gone is `false` rather than an error, because every caller here is trying to
     * reach a state rather than perform an act, and "it was not there" is that state.
     *
     * **Content addressing makes this shared**, which is the trap: two rows that resolved to
     * identical audio are ONE file, so whatever decides to call this owes a check that no other row
     * still points at the same checksum. This class cannot make that check — it holds no rows — and
     * it deliberately does not pretend to.
     */
    async remove(checksum: string, ext: string): Promise<boolean> {
        if (!CHECKSUM_PATTERN.test(checksum) || !this.isExtension(ext)) return false;

        return await rm(this.pathFor(checksum, ext))
            .then(() => true)
            .catch(() => false);
    }

    /** Absolute path for a checksum. Throws rather than guessing if either half is not what it claims. */
    pathFor(checksum: string, ext: Ext): string {
        if (!CHECKSUM_PATTERN.test(checksum)) throw new Error(`Not a sha256 checksum: ${checksum}`);
        if (!this.isExtension(ext)) throw new Error(`Not an extension this store holds: ${ext}`);

        return join(this.root, checksum.slice(0, 2), `${checksum}.${ext}`);
    }
}
