import type { ArtExtension } from './art.store.js';

/** How many bytes {@link sniffArtExtension} needs to see to decide. WebP is the long one: `RIFF`, a size, then `WEBP`. */
export const ART_SNIFF_BYTES = 12;

/**
 * What an image IS, going by its first bytes rather than by what anybody says about it.
 *
 * The image sibling of `sniffSegmentExtension` in `render/segment.store.ts`, and it exists for a
 * sharper reason than that one does. An episode's enclosure arrives with somebody's CMS's opinion of
 * its media type attached and the worst case is silence; this reads bytes an operator UPLOADED,
 * which the station then serves back from an anonymous route on its own public origin, forever, at
 * a URL a listener's player fetches unattended. A declared `image/png` that is really HTML is stored
 * XSS on the station's own origin, and `ART_CONTENT_TYPES` — which maps what an upstream CALLS a
 * file — cannot tell the difference, because it never looks.
 *
 * So: the extension comes from here, and the content type comes from the extension
 * (`ART_SERVED_TYPES`). Neither the filename nor the declared mime decides anything, which is
 * the rule `ArtService.getArtFile` already states for the way out — "a stale name can never serve
 * the wrong bytes and the response's own content type stays the authority" — read backwards.
 *
 * `undefined` for anything the store cannot serve, which a caller turns into a 415 naming what it
 * can. Deliberately NOT a decode: knowing the bytes are a PNG is the whole question here, and
 * decoding operator-supplied images in-process to learn their dimensions would buy a cosmetic check
 * at the cost of a new attack surface.
 */
export function sniffArtExtension(head: Uint8Array): ArtExtension | undefined {
    const ascii = (from: number, length: number): string => String.fromCharCode(...head.subarray(from, from + length));
    const bytes = (...expected: number[]): boolean => expected.every((value, index) => head[index] === value);

    // The PNG signature: the high bit catches a transport that stripped it, and `\r\n`/`\n` catch one
    // that translated line endings. All eight, because that is the point of them.
    if (bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
    // JPEG: start-of-image, then the first marker. Everything after varies by encoder (JFIF, Exif,
    // or a bare quantisation table), so three bytes is as far as this can honestly go.
    if (bytes(0xff, 0xd8, 0xff)) return 'jpg';
    // GIF87a or GIF89a. The version is not checked: the store serves either as `image/gif`.
    if (ascii(0, 4) === 'GIF8') return 'gif';
    // A RIFF container, which is also what a WAV is — so the form type at byte 8 is what decides,
    // exactly as `sniffSegmentExtension` uses it to tell a WAV from anything else RIFF-shaped.
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';

    return undefined;
}
