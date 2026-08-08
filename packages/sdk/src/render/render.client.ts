import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, readContentType } from '../sdk-options.js';
import type { Segment, SegmentCreate, SegmentList, SegmentScanResult, VoiceList } from './types/render.types.js';

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
     * @name Create segment
     * @description Plans something for the station to say, and starts rendering it
     */
    async createSegment(body: SegmentCreate): Promise<Segment> {
        const result = await this.fetch(`/segments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<Segment>(result);
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
     * @name List voices
     * @description The voices the station can be asked to speak in
     */
    async listVoices(): Promise<VoiceList> {
        const result = await this.fetch(`/voices`, { method: 'GET' });
        return await parseJson<VoiceList>(result);
    }

    /**
     * @name Get voice sample
     * @description A short line spoken in one voice, so an operator can hear it before choosing it
     */
    async getVoiceSample(
        voiceId: string,
    ): Promise<
        | {
              status: 200;
              contentType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/flac' | 'audio/mp4';
              data: Blob;
              headers: { cacheControl?: string; etag?: string };
          }
        | { status: 304 }
    > {
        const result = await this.fetch(`/voices/${encodeURIComponent(voiceId)}/sample`, {
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
