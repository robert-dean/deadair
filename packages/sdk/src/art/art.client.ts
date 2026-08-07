import type { SdkFetch } from '../sdk-options.js';

export class ArtClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Get art
     * @description The bytes of one cached image
     */
    async getArt(id: string): Promise<{ data: Blob; headers: { cacheControl?: string; etag?: string } }> {
        const result = await this.fetch(`/art/${encodeURIComponent(id)}`, { method: 'GET' });
        const data = await result.blob();
        return { data, headers: { cacheControl: result.headers.get('cache-control') ?? undefined, etag: result.headers.get('etag') ?? undefined } };
    }
}
