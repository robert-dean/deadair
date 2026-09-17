import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import type { MultipartBody } from '@maroonedsoftware/multipart';
import { errorText } from '#modules/shared/error.text.js';
import { artPath } from './art.path.js';
import { ArtRepository, type ArtAsset } from './art.repository.js';
import { ART_SERVED_TYPES, ArtStore, isArtExtension, type ArtExtension } from './art.store.js';
import { ART_SNIFF_BYTES, sniffArtExtension } from './art.sniff.js';
import { BREAK_ART_SOURCE, breakArtKey, breakKindIsSafe, isBreakArtKey } from './break.art.js';
import type { BreakArtworkList } from './types/art.types.js';

/**
 * The most an operator may upload for one kind of break.
 *
 * A twentieth of what a pad may be, and the reason is who fetches it: a hardware player asks for
 * this picture three times per break (measured, `docs/internals/playout.md`), over whatever uplink
 * the station is on, and an operator who drops a 20 MB photograph in would be paying that on every
 * bulletin forever. Four megabytes is a generous photograph at the size anything here draws it.
 *
 * Bounded by BYTES and nothing else. Nothing decodes the image to check its dimensions: knowing the
 * bytes are a PNG is the whole question ({@link sniffArtExtension}), and decoding operator-supplied
 * images in-process would be a new attack surface out of all proportion to a cosmetic check.
 */
const MAX_BREAK_ART_BYTES = 4 * 1024 * 1024;

/** One kind of break's picture, as the console draws it and as a revert has to know it. */
export interface BreakArtwork {
    /** `segments.kind`, which is what decides which break wears this. */
    kind: string;
    /** Where the station serves it, as a path under the API root: `art/<id>/cover.<ext>`. */
    url: string;
    /**
     * Whether these are the bytes this repository ships or ones somebody uploaded.
     *
     * Decided by comparing the row's checksum against the shipped file's, rather than by a column
     * saying so. The comparison cannot go stale: if an upgrade changes the shipped picture under a
     * station that never replaced it, the row stops matching and reads as `operator` — which is
     * true in the only sense that matters here, since a revert would visibly change what is on air.
     */
    source: 'shipped' | 'operator';
    /**
     * Whether this repository ships a picture for this kind, which is whether Revert has anywhere to
     * go. False for a kind whose only picture is one somebody uploaded.
     *
     * A flag rather than the path it would read, because that path is inside the image and means
     * nothing to a console — and a server path is not a thing to hand a browser for decoration.
     */
    hasShipped: boolean;
}

/** A picture this repository ships, as {@link BreakArtworkService.shipped} read it off the disk. */
interface ShippedPicture {
    kind: string;
    path: string;
}

/**
 * The picture a kind of break wears.
 *
 * ## Why there is no table
 *
 * A break picture is an art asset — bytes the station serves from its own store under a stable id —
 * so it is a row in `art_assets` and the id in that row is the whole of the mapping. `break.art.ts`
 * carries the argument for borrowing `source_url` as the key; the consequence worth stating here is
 * everything this class does NOT have to do. It mints no URL (`artPath` does, the same one a cached
 * cover gets), it serves no bytes (`GET /art/{id}/{filename}` already does), and nothing downstream
 * of it — `listenerArtwork`, `/nowplaying`, four SDKs, five clients — learns a new path shape.
 *
 * ## Shipped and uploaded are two layers, not one seeded directory
 *
 * `PadLibrary.seed` copies stock audio into the library once, guarded on the library being empty, so
 * that throwing a stock pad away STICKS. The unit here is a kind rather than a rack, and that guard
 * does not survive the translation: per-library it couples weather to news (upload one before the
 * first scan and the other never arrives), and per-kind the shipped picture returns on every boot.
 *
 * So the shipped files stay read-only in the image and are never copied into the volume. The station
 * writes one into its own store when it has no picture for that kind, and `revert` re-reads the file
 * — which means an upgrade that improves a picture is what a revert then restores, and an operator
 * who replaced one is never overwritten at boot.
 */
@Injectable()
export class BreakArtworkService {
    constructor(
        private readonly repository: ArtRepository,
        private readonly store: ArtStore,
        /**
         * Where the pictures this repository ships are read from.
         *
         * A constructor argument rather than an `AppConfig` read inside, on `PadLibrary`'s
         * convention and for its reason: it keeps this class testable against a temp directory with
         * no container and no config double.
         */
        private readonly shippedRoot: string,
        private readonly logger: Logger,
    ) {}

    /**
     * Give every kind this repository ships a picture for one the station holds, where it has none.
     *
     * At boot, best-effort. A kind whose row already carries bytes is left exactly alone — that row
     * may be an operator's own upload, and re-asserting the shipped bytes over it every boot is the
     * failure `PadLibrary.seed`'s note describes one subsystem over.
     *
     * Answers how many pictures it took in, for the boot line.
     */
    async seed(): Promise<number> {
        const shipped = await this.shipped();
        let taken = 0;

        for (const picture of shipped) {
            try {
                const held = await this.repository.findBySourceUrl(breakArtKey(picture.kind));
                if (held?.checksum !== undefined) continue;

                await this.writeFrom(picture);
                taken += 1;
            } catch (error) {
                // One picture failing is one kind of break wearing the station's logo, which is what
                // every kind did before this existed. Never a reason to cost the others theirs.
                this.logger.warn(`art: could not take in the picture shipped for a ${picture.kind} break (${errorText(error)})`, {
                    kind: picture.kind,
                });
            }
        }

        return taken;
    }

    /**
     * Put an operator's own bytes behind a kind.
     *
     * The id does not change, because `recordSuccess` upserts on the key: every URL already on the
     * wire, in a committed running order and in a listener's app keeps working, and what changes is
     * the checksum — which is the ETag, so a player picks the new picture up on its next
     * revalidation rather than having to be told.
     *
     * `undefined` for bytes this store cannot serve, which a caller turns into a 415. The extension
     * comes from the BYTES ({@link sniffArtExtension}) and never from a filename or a declared mime:
     * these are served anonymously from the station's own origin, so a declared `image/png` that is
     * really something else is the one thing that must not get through.
     *
     * The bytes it replaces are left in the store. Nothing here removes a file — the store is
     * content-addressed, so another row may share it, and "reports and never repairs" is the rule
     * `StorageService` already states for exactly this disagreement.
     */
    async replace(kind: string, bytes: Buffer): Promise<ArtAsset | undefined> {
        if (!breakKindIsSafe(kind)) return undefined;

        const ext = sniffArtExtension(bytes.subarray(0, ART_SNIFF_BYTES));
        if (ext === undefined) return undefined;

        return await this.write(kind, bytes, ext);
    }

    /**
     * Put the picture this repository ships back behind a kind.
     *
     * `undefined` where nothing is shipped for that kind, which is an operator asking for a default
     * that does not exist rather than a fault. Their upload is left where it is: there is nothing
     * to put in its place, and a break with no picture would be a silent change to what is on air.
     */
    async revert(kind: string): Promise<ArtAsset | undefined> {
        if (!breakKindIsSafe(kind)) return undefined;

        const picture = (await this.shipped()).find(candidate => candidate.kind === kind);

        return picture === undefined ? undefined : await this.writeFrom(picture);
    }

    /**
     * What each kind wears, for the console.
     *
     * Only kinds the station actually holds BYTES for, because the listing's job is to say what a
     * listener would see and a kind with no picture is a break wearing the station's logo — which is
     * what every break did before this existed and is not a row to draw. A kind this repository
     * ships a picture for that is missing here means the seed could not take it in, and the boot log
     * names it and why.
     */
    async list(): Promise<BreakArtwork[]> {
        const shipped = await this.shipped();
        const rows = await this.repository.findBySourcePrefix(`${BREAK_ART_SOURCE}/`);

        const kinds = [...new Set([...shipped.map(picture => picture.kind), ...rows.map(row => kindOf(row.sourceUrl))])]
            .filter(kind => kind !== '')
            .sort();

        const held = new Map(rows.map(row => [kindOf(row.sourceUrl), row]));
        const listed: BreakArtwork[] = [];

        for (const kind of kinds) {
            const picture = shipped.find(candidate => candidate.kind === kind);
            const row = held.get(kind);
            if (row?.checksum === undefined) continue;

            const stock = picture === undefined ? undefined : await this.checksumOf(picture);

            listed.push({
                kind,
                url: artPath(row),
                source: stock !== undefined && stock === row.checksum ? 'shipped' : 'operator',
                hasShipped: picture !== undefined,
            });
        }

        return listed;
    }

    /**
     * {@link list}, as the shape the route answers with.
     *
     * The wrapper rather than the array, because every listing in this API is an object with a named
     * member: a bare array cannot grow a field later without breaking every client at once.
     */
    async listBreaks(): Promise<BreakArtworkList> {
        return { breaks: await this.list() };
    }

    /**
     * `POST /art/breaks/{kind}`: an operator's own picture, from the browser.
     *
     * The bytes are collected rather than streamed, because {@link replace} hands the same buffer to
     * the sniffer and to the store, and they are bounded at {@link MAX_BREAK_ART_BYTES} by the
     * parser, which answers 413 on the ceiling itself.
     *
     * Answers the whole listing rather than the one row, exactly as `uploadPad` answers the whole
     * rack: the console's own picture of what each kind wears is what changed, and handing it back
     * is one fewer round trip than telling it to go and ask again.
     */
    async replaceBreak(kind: string, multipart: MultipartBody): Promise<BreakArtworkList> {
        if (!breakKindIsSafe(kind)) throw httpError(400).withDetails({ message: `"${kind}" is not a name a kind of break can have` });

        let upload: Buffer | undefined;
        await multipart.parse(
            async (_field, stream) => {
                const chunks: Buffer[] = [];
                for await (const chunk of stream) chunks.push(chunk as Buffer);
                upload = Buffer.concat(chunks);
            },
            { files: 1, fileSize: MAX_BREAK_ART_BYTES, fields: 4 },
        );

        if (upload === undefined || upload.length === 0) throw httpError(400).withDetails({ message: 'that upload carried no image' });

        const replaced = await this.replace(kind, upload);
        if (replaced === undefined) {
            throw httpError(415).withDetails({ message: 'the station serves jpeg, png, webp and gif pictures, and that file is none of them' });
        }

        return await this.listBreaks();
    }

    /**
     * `DELETE /art/breaks/{kind}`: put back the picture this repository ships.
     *
     * A 404 where nothing is shipped for that kind, which says what it means — there is no default
     * here to go back to — and leaves the operator's own picture exactly where it is.
     */
    async revertBreak(kind: string): Promise<BreakArtworkList> {
        if (!breakKindIsSafe(kind)) throw httpError(400).withDetails({ message: `"${kind}" is not a name a kind of break can have` });

        const reverted = await this.revert(kind);
        if (reverted === undefined) {
            throw httpError(404).withDetails({ message: `this station ships no picture for a ${kind} break, so there is nothing to go back to` });
        }

        return await this.listBreaks();
    }

    /**
     * The pictures on disk in the shipped directory, as kind → file.
     *
     * Read per call rather than cached: it is a directory of two files, read when an operator opens
     * a settings page or presses Revert, and a cache here would be a second thing that can be stale
     * for no measurable gain. A file whose name is not a usable kind, or whose extension is not one
     * the store serves, is skipped in silence — the directory is part of the image, so anything odd
     * in it is a build mistake rather than an operator's, and it is named in the boot log if the
     * seed then finds nothing.
     */
    private async shipped(): Promise<ShippedPicture[]> {
        const entries = await readdir(this.shippedRoot).catch(() => undefined);
        if (entries === undefined) return [];

        const pictures: ShippedPicture[] = [];
        for (const entry of entries.sort()) {
            const ext = extname(entry).replace(/^\./, '').toLowerCase();
            if (!isArtExtension(ext)) continue;

            const kind = entry.slice(0, entry.length - ext.length - 1);
            if (!breakKindIsSafe(kind)) continue;

            pictures.push({ kind, path: join(this.shippedRoot, entry) });
        }

        return pictures;
    }

    /** The shipped bytes behind a kind, taken in as the station's own. */
    private async writeFrom(picture: ShippedPicture): Promise<ArtAsset | undefined> {
        const bytes = await readFile(picture.path);

        // Sniffed like an upload, and not trusted for being ours: a file mangled on its way into the
        // image would otherwise be served under a content type taken from its name.
        const ext = sniffArtExtension(bytes.subarray(0, ART_SNIFF_BYTES));
        if (ext === undefined) {
            this.logger.warn(`art: the picture shipped for a ${picture.kind} break is not an image this station serves`, { file: picture.path });
            return undefined;
        }

        return await this.write(picture.kind, bytes, ext);
    }

    /** The one writer: bytes into the store, then the row that says where they are. */
    private async write(kind: string, bytes: Buffer, ext: ArtExtension): Promise<ArtAsset> {
        const checksum = await this.store.write(bytes, ext);

        return await this.repository.recordSuccess(breakArtKey(kind), {
            checksum,
            ext,
            contentType: ART_SERVED_TYPES[ext],
            byteSize: bytes.length,
        });
    }

    /** What the shipped file for a kind currently hashes to, for telling stock bytes from an operator's. */
    private async checksumOf(picture: ShippedPicture): Promise<string | undefined> {
        const bytes = await readFile(picture.path).catch(() => undefined);

        return bytes === undefined ? undefined : createHash('sha256').update(bytes).digest('hex');
    }
}

/** The kind out of a break picture's key, or the empty string for a key that is not one. */
const kindOf = (sourceUrl: string): string => (isBreakArtKey(sourceUrl) ? sourceUrl.slice(BREAK_ART_SOURCE.length + 1) : '');
