import type { SdkFetch } from '../sdk-options.js';
import { readContentType } from '../sdk-options.js';

export class ArtClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Get art
     * @description The bytes of one cached image
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
}
