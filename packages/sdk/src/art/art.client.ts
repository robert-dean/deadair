import type { SdkFetch } from '../sdk-options.js';
import { parseJson, readContentType } from '../sdk-options.js';
import type { BreakArtworkList } from './types/art.types.js';

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
}
