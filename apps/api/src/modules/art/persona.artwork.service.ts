import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import type { MultipartBody } from '@maroonedsoftware/multipart';
import { subdirectoryIsSafe } from '#modules/render/segment.store.js';
import { errorText } from '#modules/shared/error.text.js';
import { artPath } from './art.path.js';
import { ArtRepository } from './art.repository.js';
import { ART_SERVED_TYPES, ArtStore, isArtExtension } from './art.store.js';
import { ART_SNIFF_BYTES, sniffArtExtension } from './art.sniff.js';
import { PERSONA_ART_SOURCE, personaArtKey, personaIdIsSafe } from './persona.art.js';
import type { PersonaPortraitList } from './types/art.types.js';

/** The largest portrait taken in, which is the break pictures' ceiling for the same reason. */
const MAX_PORTRAIT_BYTES = 4 * 1024 * 1024;

/** One persona a shipped portrait may be given to: its row's id, and the stable key the file is named after. */
export interface PortraitCandidate {
    id: string;
    key: string;
}

/**
 * A picture of each presenter, which a listener's player shows while that persona is on air.
 *
 * Removing a portrait takes the row away and the player shows the record's cover instead; the bytes
 * are left to `storage.sweep_orphans`, which is what reclaims every content-addressed file nothing
 * names.
 *
 * ## Shipped portraits, and why they are not `BreakArtworkService`'s shape
 *
 * The personas `persona.defaults.ts` seeds are this repository's own characters, so it ships a
 * picture of each one (`assets/art/personas`, named by persona KEY, with its provenance in
 * `MANIFEST.json`). A break picture is taken in at every boot where the station holds none; a
 * portrait cannot be, because a portrait can be REMOVED and a break picture cannot, and a boot that
 * gave one back would make removing it impossible to express. So {@link seedShipped} is called at
 * exactly the two moments the stories in `persona.story.defaults.ts` are written — a fresh station's
 * seed and the operator's Restore — and never on its own.
 *
 * There is no Revert either. The break pictures need one because an upload REPLACES the shipped
 * bytes under the same row; here, removing an upload and pressing Restore is the same round trip,
 * and a route for it would be a contract change across four SDKs for a button the personas page
 * already has.
 */
@Injectable()
export class PersonaArtworkService {
    constructor(
        private readonly repository: ArtRepository,
        private readonly store: ArtStore,
        /**
         * Where the portraits this repository ships are read from. A constructor argument rather than
         * a config read inside, on `BreakArtworkService`'s convention and for its reason: it keeps
         * this class testable against a temp directory with no container.
         */
        private readonly shippedRoot: string,
        private readonly logger: Logger,
    ) {}

    /** Where a persona's portrait is served, as a path under the API root, or nothing when it has none. */
    async portraitUrl(personaId: string): Promise<string | undefined> {
        if (!personaIdIsSafe(personaId)) return undefined;

        const row = await this.repository.findBySourceUrl(personaArtKey(personaId));
        return row?.checksum === undefined ? undefined : artPath(row);
    }

    /** `GET /art/personas`: every persona that has a portrait, with where it is served. */
    async listPortraits(): Promise<PersonaPortraitList> {
        const rows = await this.repository.findBySourcePrefix(`${PERSONA_ART_SOURCE}/`);

        return {
            portraits: rows
                .filter(row => row.checksum !== undefined)
                .map(row => ({ personaId: row.sourceUrl.slice(PERSONA_ART_SOURCE.length + 1), url: artPath(row) }))
                .filter(portrait => personaIdIsSafe(portrait.personaId)),
        };
    }

    /**
     * Give each of these personas the portrait this repository ships for its key, where it has none.
     *
     * A persona that already holds a portrait is left exactly alone, whoever put it there, so an
     * operator's own upload always wins. A key with no shipped file is skipped, which is every
     * persona an operator wrote. Best-effort per persona: one picture that cannot be taken in is one
     * presenter showing the record's cover, which is what every presenter did before this existed,
     * and never a reason to cost the others theirs.
     *
     * Answers how many portraits it gave, for the caller's log line.
     */
    async seedShipped(personas: readonly PortraitCandidate[]): Promise<number> {
        const shipped = await this.shipped();
        if (shipped.size === 0) return 0;

        let given = 0;
        for (const persona of personas) {
            const path = shipped.get(persona.key);
            if (path === undefined || !personaIdIsSafe(persona.id)) continue;

            try {
                const held = await this.repository.findBySourceUrl(personaArtKey(persona.id));
                if (held?.checksum !== undefined) continue;

                if (await this.writeFrom(persona, path)) given += 1;
            } catch (error) {
                this.logger.warn(`art: could not give ${persona.key} the portrait shipped for it (${errorText(error)})`, { key: persona.key });
            }
        }

        return given;
    }

    /**
     * `POST /art/personas/{personaId}`: an operator's picture for a persona.
     *
     * Collected rather than streamed, for `BreakArtworkService.replaceBreak`'s reason: one buffer goes
     * to the sniffer and to the store. The type is decided by the BYTES.
     */
    async replacePortrait(personaId: string, multipart: MultipartBody): Promise<PersonaPortraitList> {
        if (!personaIdIsSafe(personaId)) throw httpError(400).withDetails({ message: `"${personaId}" is not a persona id` });

        let upload: Buffer | undefined;
        await multipart.parse(
            async (_field, stream) => {
                const chunks: Buffer[] = [];
                for await (const chunk of stream) chunks.push(chunk as Buffer);
                upload = Buffer.concat(chunks);
            },
            { files: 1, fileSize: MAX_PORTRAIT_BYTES, fields: 4 },
        );

        if (upload === undefined || upload.length === 0) throw httpError(400).withDetails({ message: 'that upload carried no image' });

        if (!(await this.write(personaId, upload))) {
            throw httpError(415).withDetails({ message: 'the station serves jpeg, png, webp and gif pictures, and that file is none of them' });
        }

        return await this.listPortraits();
    }

    /** `DELETE /art/personas/{personaId}`: the persona goes back to having no picture. */
    async removePortrait(personaId: string): Promise<PersonaPortraitList> {
        if (!personaIdIsSafe(personaId)) throw httpError(400).withDetails({ message: `"${personaId}" is not a persona id` });

        await this.repository.deleteBySourceUrl(personaArtKey(personaId));
        return await this.listPortraits();
    }

    /**
     * The portraits on disk in the shipped directory, as persona key → file.
     *
     * Read per call rather than cached, for `BreakArtworkService.shipped`'s reason: it is read when a
     * station is seeded or somebody presses Restore, and never otherwise. A file whose name is not a
     * usable key, or whose extension the store does not serve, is skipped in silence; the directory is
     * part of the image, so anything odd in it is a build mistake. The key goes through the same
     * path-component rule a break kind does, because it reaches a filesystem path here.
     */
    private async shipped(): Promise<Map<string, string>> {
        const entries = await readdir(this.shippedRoot).catch(() => undefined);
        const shipped = new Map<string, string>();
        if (entries === undefined) return shipped;

        for (const entry of entries.sort()) {
            const ext = extname(entry).replace(/^\./, '').toLowerCase();
            if (!isArtExtension(ext)) continue;

            const key = entry.slice(0, entry.length - ext.length - 1);
            if (subdirectoryIsSafe(key)) shipped.set(key, join(this.shippedRoot, entry));
        }

        return shipped;
    }

    /** A shipped portrait's bytes, taken in as the station's own. False for a file that is not a picture. */
    private async writeFrom(persona: PortraitCandidate, path: string): Promise<boolean> {
        // Sniffed like an upload, and not trusted for being ours: a file mangled on its way into the
        // image would otherwise be served under a content type taken from its name.
        const written = await this.write(persona.id, await readFile(path));
        if (!written) this.logger.warn(`art: the portrait shipped for ${persona.key} is not an image this station serves`, { file: path });

        return written;
    }

    /** The one writer: bytes into the store, then the row that says where they are. False for bytes this store cannot serve. */
    private async write(personaId: string, bytes: Buffer): Promise<boolean> {
        const ext = sniffArtExtension(bytes.subarray(0, ART_SNIFF_BYTES));
        if (ext === undefined) return false;

        const checksum = await this.store.write(bytes, ext);
        await this.repository.recordSuccess(personaArtKey(personaId), {
            checksum,
            ext,
            contentType: ART_SERVED_TYPES[ext],
            byteSize: bytes.length,
        });

        return true;
    }
}
