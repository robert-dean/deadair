import type { RecordingList } from './types/stream.archive.types.js';
import { reviveRecordingList } from './types/stream.archive.types.js';
import type { SdkFetch } from '../sdk-options.js';
import { parseJson, buildQueryString, buildHeaders } from '../sdk-options.js';

/**
 * generated from [stream.archive.ck](../../../../apps/api/data/contracts/stream/stream.archive.ck)
 */
export class StreamArchiveClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List recordings
     * @description Every recording in the archive, newest first
     */
    async listRecordings(): Promise<RecordingList> {
        const result = await this.fetch(`/archive/recordings`, { method: 'GET' });
        return reviveRecordingList(await parseJson<RecordingList>(result));
    }

    /**
     * @name Delete recording
     * @description Deletes a finished recording. One still being recorded is refused
     */
    async deleteRecording(id: string): Promise<void> {
        await this.fetch(`/archive/recordings/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }

    /**
     * @name Get recording audio
     * @description The audio of one recording. Answers a byte range, so a player can seek through an hour
     */
    async getRecordingAudio(
        id: string,
        query?: { download?: boolean },
        customHeaders?: { range?: string },
    ): Promise<
        | { status: 200; contentType: 'audio/mpeg'; data: Blob; headers: { acceptRanges?: string; contentDisposition?: string } }
        | { status: 206; contentType: 'audio/mpeg'; data: Blob; headers: { acceptRanges?: string; contentRange: string } }
    > {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/archive/recordings/${encodeURIComponent(id)}/audio${qs}`, {
            method: 'GET',
            headers: buildHeaders(customHeaders),
        });
        switch (result.status) {
            case 206:
                return {
                    status: 206,
                    contentType: 'audio/mpeg',
                    data: await result.blob(),
                    headers: { acceptRanges: result.headers.get('accept-ranges') ?? undefined, contentRange: result.headers.get('content-range')! },
                };
            default:
                return {
                    status: 200,
                    contentType: 'audio/mpeg',
                    data: await result.blob(),
                    headers: {
                        acceptRanges: result.headers.get('accept-ranges') ?? undefined,
                        contentDisposition: result.headers.get('content-disposition') ?? undefined,
                    },
                };
        }
    }
}
