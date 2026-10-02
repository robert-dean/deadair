import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { AudioUrlSigner } from '#modules/playout/audio.url.signer.js';
import { resolvePlayoutBaseUrl, segmentAudioUrl } from '#modules/playout/playout.urls.js';
import type { Segment } from './segment.repository.js';
import { SEGMENT_CONTENT_TYPES } from './segment.store.js';
import { SegmentShareStore, SHARE_BITRATE_KBPS, SHARE_CHANNELS, SHARE_EXTENSION } from './segment.share.store.js';
import { TranscodeService } from './transcode.service.js';

/** What `rendition=share` answers. The audio route's response, with a file name to save it under. */
export interface SegmentShareResponse {
    contentType: (typeof SEGMENT_CONTENT_TYPES)[typeof SHARE_EXTENSION];
    body: Buffer;
    headers: { cacheControl: string; etag: string; contentDisposition: string };
}

/**
 * A day, as the original's is, and for its reason: the URL names exactly these bytes. The source
 * checksum is in the key, so different audio is a different copy, and a copy swept and remade is
 * the same encode of the same source.
 */
const CACHE_CONTROL = 'public, max-age=86400';

/**
 * Encodes in flight, by share key, so two requests for the same copy make it once.
 *
 * Module state rather than a field, because the service is scoped and a double tap is two requests
 * and so two instances. It holds a promise only for as long as an encode runs.
 */
const inFlight = new Map<string, Promise<void>>();

/**
 * The file name a phone saves the copy under: `deadair-` and the break's label, made safe.
 *
 * The listener's wording of the label where there is one, since that is the register written for
 * somebody outside the station. ASCII letters, digits and dashes only, so the name survives every
 * messaging app and filesystem it is about to pass through, and bounded so a long label does not
 * become an unwieldy attachment.
 */
export function shareFileName(segment: Pick<Segment, 'label' | 'listenerLabel'>): string {
    const slug = (segment.listenerLabel ?? segment.label)
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/g, '');

    return `deadair-${slug.length > 0 ? slug : 'break'}.${SHARE_EXTENSION}`;
}

/**
 * The small copy of a segment's audio that a listener sends on.
 *
 * Made once per source and kept in {@link SegmentShareStore}, which `PruneShareCopiesJob` sweeps. The
 * encode is the transcode plugin's, against the station's own signed URL for the original, which is
 * what the sidecar can reach and what is certain to be the bytes that aired. Nothing here reads or
 * writes a sample: the copy arrives as a stream and is piped into the store.
 */
@Injectable()
export class SegmentShareService {
    constructor(
        private readonly store: SegmentShareStore,
        private readonly transcoder: TranscodeService,
        private readonly signer: AudioUrlSigner,
        private readonly config: AppConfig,
    ) {}

    /**
     * The copy, made now if it is not already in hand.
     *
     * @throws 503 when the station has nothing that can make one, which is an ordinary state rather
     *   than a fault; 502 when the encoder tried and failed.
     */
    async copyOf(segment: Segment & { audioChecksum: string }): Promise<SegmentShareResponse> {
        const key = this.store.keyFor(segment.audioChecksum);

        let body = await this.store.read(key, SHARE_EXTENSION);
        if (body === undefined) {
            await this.make(segment, key);
            body = await this.store.read(key, SHARE_EXTENSION);
            if (body === undefined)
                throw httpError(502).withDetails({ message: `the copy of segment "${segment.id}" was made and then could not be read` });
        } else {
            // A hit is a request, and the sweep measures from the last one.
            await this.store.touch(key);
        }

        return {
            contentType: SEGMENT_CONTENT_TYPES[SHARE_EXTENSION],
            body,
            headers: {
                cacheControl: CACHE_CONTROL,
                etag: `"${key}"`,
                contentDisposition: `attachment; filename="${shareFileName(segment)}"`,
            },
        };
    }

    /** Encode once per key, however many requests are waiting on it. */
    private async make(segment: Segment, key: string): Promise<void> {
        const running = inFlight.get(key);
        if (running !== undefined) return await running;

        const work = this.encode(segment, key).finally(() => inFlight.delete(key));
        inFlight.set(key, work);
        return await work;
    }

    private async encode(segment: Segment, key: string): Promise<void> {
        const url = this.signer.sign(segmentAudioUrl(resolvePlayoutBaseUrl(this.config), segment.id));
        const outcome = await this.transcoder.transcode(segment.label, { url, bitrateKbps: SHARE_BITRATE_KBPS, channels: SHARE_CHANNELS });

        if (!outcome.ok) {
            throw httpError(outcome.reason === 'failed' ? 502 : 503).withDetails({
                message: `the station cannot make a copy to share: ${outcome.message}`,
            });
        }

        // Checked rather than trusted: the copy is stored and served as an .m4a for as long as it is
        // kept, so a plugin answering something else would be served wrongly to everybody after.
        if (outcome.copy.mime !== SEGMENT_CONTENT_TYPES[SHARE_EXTENSION]) {
            await outcome.copy.audio.cancel();
            throw httpError(502).withDetails({ message: `the encoder answered ${outcome.copy.mime}, not ${SEGMENT_CONTENT_TYPES[SHARE_EXTENSION]}` });
        }

        await this.store.writeStreamAs(key, outcome.copy.audio, SHARE_EXTENSION);
    }
}
