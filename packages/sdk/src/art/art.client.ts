import type { SdkFetch } from '../sdk-options.js';
import { parseJson, readContentType } from '../sdk-options.js';
import type { BreakArtworkList, PersonaPortraitList } from './types/art.types.js';

export class ArtClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List break artwork
     * @description Every kind the station holds a picture for
     */
    async listBreakArtwork(): Promise<BreakArtworkList> {
        const result = await this.fetch(`/art/breaks`, { method: 'GET' });
        return await parseJson<BreakArtworkList>(result);
    }

    /**
     * @name Replace break artwork
     * @description Puts an operator's own picture behind a kind of break. The id does not change, so a URL already on the wire keeps working and the ETag is what says the picture moved
     */
    async replaceBreakArtwork(kind: string, body: FormData): Promise<BreakArtworkList> {
        const result = await this.fetch(`/art/breaks/${encodeURIComponent(kind)}`, {
            method: 'POST',
            body: body,
        });
        return await parseJson<BreakArtworkList>(result);
    }

    /**
     * @name Revert break artwork
     * @description Puts the picture this repository ships back. The shipped file is read at this moment rather than copied at install, so an upgrade that improved it is what comes back
     */
    async revertBreakArtwork(kind: string): Promise<BreakArtworkList> {
        const result = await this.fetch(`/art/breaks/${encodeURIComponent(kind)}`, { method: 'DELETE' });
        return await parseJson<BreakArtworkList>(result);
    }

    /**
     * @name Get source art
     * @description The bytes of a cover the station fetches on first ask, addressed by its sealed source
     */
    async getSourceArt(token: string): Promise<
        | {
              status: 200;
              contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
              data: Blob;
              headers: { cacheControl?: string; etag?: string };
          }
        | { status: 304 }
    > {
        const result = await this.fetch(`/art/source/${encodeURIComponent(token)}`, {
            method: 'GET',
            expectStatuses: [304],
        });
        switch (result.status) {
            case 304:
                return { status: 304 };
            default:
                return {
                    status: 200,
                    contentType: readContentType(result) as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                    data: await result.blob(),
                    headers: { cacheControl: result.headers.get('cache-control') ?? undefined, etag: result.headers.get('etag') ?? undefined },
                };
        }
    }

    /**
     * @name Get source art file
     * @description The bytes of a cover the station fetches on first ask, under any filename
     */
    async getSourceArtFile(
        token: string,
        filename: string,
    ): Promise<
        | {
              status: 200;
              contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
              data: Blob;
              headers: { cacheControl?: string; etag?: string };
          }
        | { status: 304 }
    > {
        const result = await this.fetch(`/art/source/${encodeURIComponent(token)}/${encodeURIComponent(filename)}`, {
            method: 'GET',
            expectStatuses: [304],
        });
        switch (result.status) {
            case 304:
                return { status: 304 };
            default:
                return {
                    status: 200,
                    contentType: readContentType(result) as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                    data: await result.blob(),
                    headers: { cacheControl: result.headers.get('cache-control') ?? undefined, etag: result.headers.get('etag') ?? undefined },
                };
        }
    }

    /**
     * @name Get art
     * @description The bytes of one cached image, addressed by its id alone
     */
    async getArt(id: string): Promise<
        | {
              status: 200;
              contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
              data: Blob;
              headers: { cacheControl?: string; etag?: string };
          }
        | { status: 304 }
    > {
        const result = await this.fetch(`/art/${encodeURIComponent(id)}`, {
            method: 'GET',
            expectStatuses: [304],
        });
        switch (result.status) {
            case 304:
                return { status: 304 };
            default:
                return {
                    status: 200,
                    contentType: readContentType(result) as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                    data: await result.blob(),
                    headers: { cacheControl: result.headers.get('cache-control') ?? undefined, etag: result.headers.get('etag') ?? undefined },
                };
        }
    }

    /**
     * @name Get art file
     * @description The bytes of one cached image, under any filename
     */
    async getArtFile(
        id: string,
        filename: string,
    ): Promise<
        | {
              status: 200;
              contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
              data: Blob;
              headers: { cacheControl?: string; etag?: string };
          }
        | { status: 304 }
    > {
        const result = await this.fetch(`/art/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`, {
            method: 'GET',
            expectStatuses: [304],
        });
        switch (result.status) {
            case 304:
                return { status: 304 };
            default:
                return {
                    status: 200,
                    contentType: readContentType(result) as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                    data: await result.blob(),
                    headers: { cacheControl: result.headers.get('cache-control') ?? undefined, etag: result.headers.get('etag') ?? undefined },
                };
        }
    }

    /**
     * @name List persona portraits
     * @description Every persona that has a portrait
     */
    async listPersonaPortraits(): Promise<PersonaPortraitList> {
        const result = await this.fetch(`/art/personas`, { method: 'GET' });
        return await parseJson<PersonaPortraitList>(result);
    }

    /**
     * @name Replace persona portrait
     * @description Puts a picture on a persona. A persona that already had one keeps its URL, so a player holding it picks up the new picture
     */
    async replacePersonaPortrait(personaId: string, body: FormData): Promise<PersonaPortraitList> {
        const result = await this.fetch(`/art/personas/${encodeURIComponent(personaId)}`, {
            method: 'POST',
            body: body,
        });
        return await parseJson<PersonaPortraitList>(result);
    }

    /**
     * @name Remove persona portrait
     * @description Takes a persona's picture away. A player shows the record's cover instead
     */
    async removePersonaPortrait(personaId: string): Promise<PersonaPortraitList> {
        const result = await this.fetch(`/art/personas/${encodeURIComponent(personaId)}`, { method: 'DELETE' });
        return await parseJson<PersonaPortraitList>(result);
    }
}
