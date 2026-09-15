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
 * Whether a name may be a directory inside one of the station's audio libraries.
 *
 * Both libraries take a subdirectory from somewhere: the SCAN takes it from a directory that already
 * exists, which is safe by construction, and a console upload takes it from whoever is typing — and
 * `join(root, name)` with `../..` in it writes wherever it likes. So both `PadLibrary.ingest` and
 * `SegmentLibrary.ingest` check it at the seam rather than at each door, because the guarantee wanted
 * is that nothing escapes the library root rather than that every caller remembered.
 *
 * A LIMIT rather than a normalisation: `My Board` is a directory an operator may legitimately have
 * made by hand, and rewriting it here would file an upload somewhere the scan does not look.
 *
 * Here rather than in either library because there are two now, on `extensionForMime`'s reason one
 * function down: a second copy of a path rule is a second thing that can be relaxed by accident.
 */
export function subdirectoryIsSafe(name: string): boolean {
    const trimmed = name.trim();

    if (trimmed === '' || trimmed.length > 200) return false;
    if (trimmed.startsWith('.')) return false;

    return !/[/\\\0]/.test(trimmed);
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

/** How many bytes {@link sniffSegmentExtension} needs to see to decide. */
export const SNIFF_BYTES = 12;

/**
 * What a file IS, going by its first bytes rather than by what anybody says about it.
 *
 * For audio that arrived from somebody else's server with somebody else's CMS's opinion of its media
 * type attached: a podcast episode's enclosure. `audio/mp3`, `audio/x-m4a`, `application/octet-stream`
 * and an empty type are all ordinary there, and a type that is simply wrong is not rare. The
 * extension decides what the file is SERVED as, and Liquidsoap picks its decoder from that, so a
 * wrong one fails as silence rather than as an error anybody sees ({@link SEGMENT_CONTENT_TYPES}).
 * The bytes cannot be wrong about themselves.
 *
 * `undefined` for anything this store cannot serve, and one refusal is worth naming: raw AAC in an
 * ADTS stream begins with the same sync word as an MP3 frame and would be filed as `mp3` by anything
 * reading only the first byte. It is told apart by the layer bits, which ADTS always sets to zero and
 * no MP3 frame does, and it is refused rather than filed as `m4a`, because it is not in an MP4
 * container and a decoder handed it as one fails.
 */
export function sniffSegmentExtension(head: Uint8Array): SegmentExtension | undefined {
    const ascii = (from: number, length: number): string => String.fromCharCode(...head.subarray(from, from + length));

    // An ID3v2 tag in front of the audio is how nearly every podcast MP3 begins.
    if (ascii(0, 3) === 'ID3') return 'mp3';
    // An ISO base media file (MP4, M4A): a box size, then `ftyp`.
    if (ascii(4, 4) === 'ftyp') return 'm4a';
    if (ascii(0, 4) === 'OggS') return 'ogg';
    if (ascii(0, 4) === 'fLaC') return 'flac';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'wav';

    // A bare MPEG audio frame: eleven sync bits, then the version, then the LAYER. Layer bits of `00`
    // are reserved in MPEG audio and are exactly what ADTS writes, which is the AAC case above.
    if (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) {
        const layer = (head[1]! >> 1) & 0x03;
        return layer === 0 ? undefined : 'mp3';
    }

    return undefined;
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
