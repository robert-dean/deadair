import type { SdkFetch } from '../sdk-options.js';
import { parseJson, readContentType } from '../sdk-options.js';
import type { SegmentList, SegmentScanResult } from './types/render.types.js';

export class RenderClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List segments
     * @description Everything the station can play that is not a record
     */
    async listSegments(): Promise<SegmentList> {
        const result = await this.fetch(`/segments`, { method: 'GET' });
        return await parseJson<SegmentList>(result);
    }

    /**
     * @name Scan the segment inbox
     * @description Takes whatever audio is sitting in the inbox directory into the library. Safe to repeat: a segment is identified by its audio, so the same recording arriving twice is one segment
     */
    async scanTheSegmentInbox(): Promise<SegmentScanResult> {
        const result = await this.fetch(`/segments/scan`, { method: 'POST' });
        return await parseJson<SegmentScanResult>(result);
    }

    /**
     * @name Get segment audio
     * @description The audio of one segment
     */
    async getSegmentAudio(
        id: string,
    ): Promise<
        | {
              status: 200;
              contentType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/flac' | 'audio/mp4';
              data: Blob;
              headers: { cacheControl?: string; etag?: string };
          }
        | { status: 304 }
    > {
        const result = await this.fetch(`/segments/${encodeURIComponent(id)}/audio`, {
            method: 'GET',
            expectStatuses: [304],
        });
        switch (result.status) {
            case 304:
                return { status: 304 };
            default:
                return {
                    status: 200,
                    contentType: readContentType(result) as 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/flac' | 'audio/mp4',
                    data: await result.blob(),
                    headers: { cacheControl: result.headers.get('cache-control') ?? undefined, etag: result.headers.get('etag') ?? undefined },
                };
        }
    }
}
