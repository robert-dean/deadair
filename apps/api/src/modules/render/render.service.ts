import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import type { SegmentList, SegmentScanResult } from './types/render.types.js';
import { SegmentLibrary } from './segment.library.js';
import { SegmentRepository, type Segment } from './segment.repository.js';
import { SEGMENT_CONTENT_TYPES, SegmentStore, type SegmentContentType } from './segment.store.js';

/**
 * How long a client may reuse segment audio before asking again.
 *
 * Longer than art's hour, and safely so: this URL's id maps to one row whose audio is
 * content-addressed, so the bytes behind an id change only if the segment is re-recorded. The ETag
 * is the checksum, which makes even that a headers-only revalidation the conditional-GET middleware
 * answers with a 304.
 */
const CACHE_CONTROL = 'public, max-age=86400';

/**
 * What the audio route hands the generated router.
 *
 * `contentType` is the answer, not decoration: the operation declares every format the store holds
 * and the router sets `ctx.type` from whichever this names. Both consumers pick their behaviour
 * from that header rather than from the bytes, so it is the difference between a wav that plays and
 * one that silently does not. See the note on `SEGMENT_CONTENT_TYPES`.
 */
export interface SegmentAudioResponse {
    contentType: SegmentContentType;
    body: Buffer;
    headers: { cacheControl: string; etag: string };
}

@Injectable()
export class RenderService {
    constructor(
        private readonly segments: SegmentRepository,
        private readonly store: SegmentStore,
        private readonly library: SegmentLibrary,
    ) {}

    /** Everything the station can play that is not a record. */
    async listSegments(): Promise<SegmentList> {
        const segments = await this.segments.list();
        return { segments: segments.map(toView) };
    }

    /**
     * The audio of one segment.
     *
     * @throws 404 for an id nobody has, for a segment with no audio yet (`planned`, `rendering` or
     * `failed`), and for one whose file has gone missing under it. All three are the same answer to
     * the caller: there is nothing to play here. The director asks the same question of the row
     * before committing anything, so a 404 on this route means a segment went missing between the
     * commit and the fetch rather than that the station tried to air a segment it never had.
     */
    async getSegmentAudio(id: string): Promise<SegmentAudioResponse> {
        const segment = await this.segments.findById(id);
        if (segment === undefined) throw httpError(404).withDetails({ message: `segment "${id}" does not exist` });
        if (segment.audioChecksum === undefined || segment.audioExt === undefined) {
            throw httpError(404).withDetails({ message: `segment "${id}" has no audio (${segment.state})` });
        }

        const bytes = await this.store.read(segment.audioChecksum, segment.audioExt);
        if (bytes === undefined) throw httpError(404).withDetails({ message: `segment "${id}" has no file` });

        return {
            contentType: SEGMENT_CONTENT_TYPES[segment.audioExt],
            body: bytes,
            headers: { cacheControl: CACHE_CONTROL, etag: `"${segment.audioChecksum}"` },
        };
    }

    /** Take whatever is in the inbox into the library. */
    async scanLibrary(): Promise<SegmentScanResult> {
        return await this.library.scan();
    }
}

/** A row as the console reads it. The checksum stays here: it is a filename, not an answer. */
const toView = (segment: Segment): SegmentList['segments'][number] => ({
    id: segment.id,
    kind: segment.kind,
    state: segment.state,
    label: segment.label,
    source: segment.source,
    playable: segment.audioChecksum !== undefined,
    ...(segment.script === undefined ? {} : { script: segment.script }),
    ...(segment.sourcePath === undefined ? {} : { sourcePath: segment.sourcePath }),
    ...(segment.durationMs === undefined ? {} : { durationMs: segment.durationMs }),
    ...(segment.error === undefined ? {} : { error: segment.error }),
});
