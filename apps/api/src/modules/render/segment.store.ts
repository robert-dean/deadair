import { ContentStore } from '#modules/shared/content.store.js';

/**
 * The formats a segment can be in, and what each is served as.
 *
 * The two travel together because the Content-Type is the load-bearing half. Both consumers of
 * these bytes decide what to do with them from that header rather than from the bytes: a browser
 * previewing a segment in an `<audio>` element, which unlike an `<img>` does not sniff, and
 * Liquidsoap, which sends a HEAD before the GET, names the temp file it downloads to after the
 * content type, and picks its decoder from that name. Serving a wav as `audio/mpeg` therefore
 * fails as silence rather than as an error anyone sees.
 *
 * This list is what `render.ck` declares on the audio operation, and the two have to agree: the
 * service answers with the mime and the router sets `ctx.type` from it, so a format here the
 * contract does not declare will not type-check, and one the contract declares that is missing here
 * can never be returned.
 */
export const SEGMENT_CONTENT_TYPES = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
} as const satisfies Record<string, string>;

export type SegmentExtension = keyof typeof SEGMENT_CONTENT_TYPES;

export type SegmentContentType = (typeof SEGMENT_CONTENT_TYPES)[SegmentExtension];

export const SEGMENT_EXTENSIONS = Object.keys(SEGMENT_CONTENT_TYPES) as readonly SegmentExtension[];

export function isSegmentExtension(value: string | undefined): value is SegmentExtension {
    return value !== undefined && Object.hasOwn(SEGMENT_CONTENT_TYPES, value);
}

/**
 * Segment audio on disk.
 *
 * Everything about how bytes are laid out, and every guard against a path that is not what it
 * claims, is {@link ContentStore}'s; this is which formats and a name injectkit can register
 * against. It is the station's own copy and the only one anything reads back: the inbox a file
 * arrived in is an INBOX, and emptying it does not take a segment off the air, which is the point
 * of copying rather than referencing.
 */
export class SegmentStore extends ContentStore<SegmentExtension> {
    constructor(root: string) {
        super(root, SEGMENT_CONTENT_TYPES);
    }
}
