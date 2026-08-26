import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, buildQueryString, readContentType } from '../sdk-options.js';
import type {
    PadList,
    PadScanResult,
    PadSetMembership,
    PadSetWrite,
    PadState,
    PadUpload,
    PronunciationList,
    PronunciationQuery,
    PronunciationStateWrite,
    PronunciationWrite,
    ScriptAttempt,
    ScriptHistoryPage,
    ScriptHistoryQuery,
    ScriptHistorySummary,
    ScriptHistorySummaryQuery,
    ScriptRatingInput,
    Segment,
    SegmentCreate,
    SegmentList,
    SegmentScanResult,
    SpeechPreviewRequest,
    VoiceList,
} from './types/render.types.js';

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
     * @name Read script history
     * @description What the station has written lately, newest first, one page at a time
     */
    async readScriptHistory(query?: ScriptHistoryQuery): Promise<ScriptHistoryPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/scripts${qs}`, {
            method: 'GET',
        });
        return await parseJson<ScriptHistoryPage>(result);
    }

    /**
     * @name Rate script
     * @description What the operator thought of this attempt. Nothing acts on it automatically
     */
    async rateScript(id: string, body: ScriptRatingInput): Promise<ScriptAttempt> {
        const result = await this.fetch(`/scripts/${encodeURIComponent(id)}/rating`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<ScriptAttempt>(result);
    }

    /**
     * @name Read script summary
     * @description Write attempts by outcome, per presenter, over a recent window
     */
    async readScriptSummary(query?: ScriptHistorySummaryQuery): Promise<ScriptHistorySummary> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/scripts/summary${qs}`, {
            method: 'GET',
        });
        return await parseJson<ScriptHistorySummary>(result);
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
     * @name Get default voice sample
     * @description A short line spoken in whichever voice the plugin falls back to
     */
    async getDefaultVoiceSample(): Promise<
        | {
              status: 200;
              contentType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/flac' | 'audio/mp4';
              data: Blob;
              headers: { cacheControl?: string; etag?: string };
          }
        | { status: 304 }
    > {
        const result = await this.fetch(`/voices/sample`, {
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
     * @name Preview speech
     * @description Speaks the caller's words in one voice, so a break can be heard before it is written for air
     */
    async previewSpeech(
        body: SpeechPreviewRequest,
    ): Promise<{ contentType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/flac' | 'audio/mp4'; data: Blob }> {
        const result = await this.fetch(`/voices/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return {
            contentType: readContentType(result) as 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/flac' | 'audio/mp4',
            data: await result.blob(),
        };
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

    /**
     * @name Get stored audio
     * @description Audio out of the segment store, addressed by content rather than by row
     */
    async getStoredAudio(
        checksum: string,
        ext: string,
    ): Promise<
        | {
              status: 200;
              contentType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/flac' | 'audio/mp4';
              data: Blob;
              headers: { cacheControl?: string; etag?: string };
          }
        | { status: 304 }
    > {
        const result = await this.fetch(`/audio/${encodeURIComponent(checksum)}/${encodeURIComponent(ext)}`, {
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
     * @name List pronunciations
     * @description The station's lexicon: what it says, what has been proposed to it, and what it has turned down
     */
    async listPronunciations(query?: PronunciationQuery): Promise<PronunciationList> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/pronunciations${qs}`, {
            method: 'GET',
        });
        return await parseJson<PronunciationList>(result);
    }

    /**
     * @name Create pronunciation
     * @description Adds one the operator typed. It is said from the next render on
     */
    async createPronunciation(body: PronunciationWrite): Promise<PronunciationList> {
        const result = await this.fetch(`/pronunciations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PronunciationList>(result);
    }

    /**
     * @name Update pronunciation
     * @description Rewrites one entry's words, whoever proposed it
     */
    async updatePronunciation(id: string, body: PronunciationWrite): Promise<PronunciationList> {
        const result = await this.fetch(`/pronunciations/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PronunciationList>(result);
    }

    /**
     * @name Delete pronunciation
     * @description Removes an entry outright. Turning a PROPOSAL down is a state rather than a deletion, because a deleted one comes back on the next pass
     */
    async deletePronunciation(id: string): Promise<PronunciationList> {
        const result = await this.fetch(`/pronunciations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return await parseJson<PronunciationList>(result);
    }

    /**
     * @name Set pronunciation state
     * @description Accepts a proposal, turns one down, or takes an entry out of use without losing what it said
     */
    async setPronunciationState(id: string, body: PronunciationStateWrite): Promise<PronunciationList> {
        const result = await this.fetch(`/pronunciations/${encodeURIComponent(id)}/state`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PronunciationList>(result);
    }

    /**
     * @name List pads
     * @description Every sound the station holds, board by board
     */
    async listPads(): Promise<PadList> {
        const result = await this.fetch(`/pads`, { method: 'GET' });
        return await parseJson<PadList>(result);
    }

    /**
     * @name Upload pad
     * @description Takes a sound in from the browser and puts it on a board. The file lands in the pad library on disk, so it survives a rebuild and an archive carries it
     */
    async uploadPad(body: FormData): Promise<PadList> {
        const result = await this.fetch(`/pads`, {
            method: 'POST',
            body: body,
        });
        return await parseJson<PadList>(result);
    }

    /**
     * @name Scan the pad library
     * @description Takes whatever audio is sitting in the pad library directory onto its board. Safe to repeat: a file nobody has touched is seen and left alone
     */
    async scanThePadLibrary(): Promise<PadScanResult> {
        const result = await this.fetch(`/pads/scan`, { method: 'POST' });
        return await parseJson<PadScanResult>(result);
    }

    /**
     * @name Set pad state
     * @description Turns a sound down, or puts one back. Answers the whole rack, since one pad changing state is one row moving between two sections of the same page
     */
    async setPadState(id: string, body: PadState): Promise<PadList> {
        const result = await this.fetch(`/pads/${encodeURIComponent(id)}/state`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PadList>(result);
    }

    /**
     * @name Get pad audio
     * @description The sound itself, so an operator can hear what they dropped in
     */
    async getPadAudio(
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
        const result = await this.fetch(`/pads/${encodeURIComponent(id)}/audio`, {
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
     * @name Create pad set
     * @description Names a new set, or answers the one already under that key
     */
    async createPadSet(body: PadSetWrite): Promise<PadList> {
        const result = await this.fetch(`/pads/sets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PadList>(result);
    }

    /**
     * @name Update pad set
     * @description Renames a set. The KEY moves with it, so every persona naming the old one stops finding it
     */
    async updatePadSet(id: string, body: PadSetWrite): Promise<PadList> {
        const result = await this.fetch(`/pads/sets/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PadList>(result);
    }

    /**
     * @name Delete pad set
     * @description Removes a set and its memberships, and no pads at all
     */
    async deletePadSet(id: string): Promise<PadList> {
        const result = await this.fetch(`/pads/sets/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return await parseJson<PadList>(result);
    }

    /**
     * @name Set pad membership
     * @description Puts a pad on a set or takes it off. Refused where the set already answers to that name, because a script writes a name
     */
    async setPadMembership(id: string, body: PadSetMembership): Promise<PadList> {
        const result = await this.fetch(`/pads/sets/${encodeURIComponent(id)}/pads`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PadList>(result);
    }
}
