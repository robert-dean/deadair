import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import type { MultipartBody } from '@maroonedsoftware/multipart';
import { artPath } from './art.path.js';
import { ArtRepository } from './art.repository.js';
import { ART_SERVED_TYPES, ArtStore } from './art.store.js';
import { ART_SNIFF_BYTES, sniffArtExtension } from './art.sniff.js';
import { PERSONA_ART_SOURCE, personaArtKey, personaIdIsSafe } from './persona.art.js';
import type { PersonaPortraitList } from './types/art.types.js';

/** The largest portrait taken in, which is the break pictures' ceiling for the same reason. */
const MAX_PORTRAIT_BYTES = 4 * 1024 * 1024;

/**
 * A picture of each presenter, which a listener's player shows while that persona is on air.
 *
 * `BreakArtworkService`'s shape without its shipped defaults: a persona is the operator's own
 * creation, so there is nothing for this repository to ship and nothing to revert to. Removing a
 * portrait takes the row away and the player shows the record's cover instead; the bytes are left to
 * `storage.sweep_orphans`, which is what reclaims every content-addressed file nothing names.
 */
@Injectable()
export class PersonaArtworkService {
    constructor(
        private readonly repository: ArtRepository,
        private readonly store: ArtStore,
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

        const ext = sniffArtExtension(upload.subarray(0, ART_SNIFF_BYTES));
        if (ext === undefined) {
            throw httpError(415).withDetails({ message: 'the station serves jpeg, png, webp and gif pictures, and that file is none of them' });
        }

        const checksum = await this.store.write(upload, ext);
        await this.repository.recordSuccess(personaArtKey(personaId), {
            checksum,
            ext,
            contentType: ART_SERVED_TYPES[ext],
            byteSize: upload.length,
        });

        return await this.listPortraits();
    }

    /** `DELETE /art/personas/{personaId}`: the persona goes back to having no picture. */
    async removePortrait(personaId: string): Promise<PersonaPortraitList> {
        if (!personaIdIsSafe(personaId)) throw httpError(400).withDetails({ message: `"${personaId}" is not a persona id` });

        await this.repository.deleteBySourceUrl(personaArtKey(personaId));
        return await this.listPortraits();
    }
}
