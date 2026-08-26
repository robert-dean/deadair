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

/** Reverse of {@link SEGMENT_CONTENT_TYPES}: what a declared media type is stored as. */
const EXTENSION_BY_MIME = new Map<string, SegmentExtension>(
    (Object.entries(SEGMENT_CONTENT_TYPES) as [SegmentExtension, string][]).map(([ext, mime]) => [mime, ext]),
);

/**
 * What to file audio as, going by what whoever produced it says it is.
 *
 * `undefined` for anything the store cannot hold, which the caller has to treat as a refusal rather
 * than guess at: the extension is what the content type is derived from on the way back out, and a
 * wrong one fails as silence rather than as an error anybody sees.
 *
 * Here rather than in either caller because there are two now — a plugin that spoke and a plugin
 * that joined — and a second copy of this map is a second thing that can fall behind the formats
 * above it.
 */
export const extensionForMime = (mime: string): SegmentExtension | undefined => EXTENSION_BY_MIME.get(mime.split(';')[0]!.trim().toLowerCase());

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
