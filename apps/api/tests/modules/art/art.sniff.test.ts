// What an uploaded file IS, going by its bytes. The refusals matter more than the formats here: the
// bytes this decides about are served back anonymously from the station's own public origin, so
// anything that gets through under the wrong name gets through forever.

import { describe, expect, it } from 'vitest';

import { ART_SNIFF_BYTES, sniffArtExtension } from '../../../src/modules/art/art.sniff.js';

const head = (...bytes: number[]) => Uint8Array.from(bytes);
const ascii = (text: string, length = text.length) => Uint8Array.from(Buffer.from(text.padEnd(length, '\0'), 'binary'));

describe('sniffArtExtension', () => {
    it('reads a PNG by its whole signature', () => {
        expect(sniffArtExtension(head(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0))).toBe('png');
    });

    it('reads a JPEG by its start-of-image marker', () => {
        expect(sniffArtExtension(head(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('jpg');
    });

    it('reads either version of a GIF, since the store serves both the same way', () => {
        expect(sniffArtExtension(ascii('GIF87a', ART_SNIFF_BYTES))).toBe('gif');
        expect(sniffArtExtension(ascii('GIF89a', ART_SNIFF_BYTES))).toBe('gif');
    });

    it('tells a WebP from anything else RIFF-shaped by the form type at byte eight', () => {
        const webp = Uint8Array.from([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')]);
        const wav = Uint8Array.from([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WAVE')]);

        expect(sniffArtExtension(webp)).toBe('webp');
        expect(sniffArtExtension(wav)).toBeUndefined();
    });

    it('refuses HTML, which is the upload this exists to stop', () => {
        // A declared `image/png` that is really a page would be stored XSS on the station's own
        // origin, served anonymously and cached by whoever asked. Neither the filename nor the
        // declared type is consulted anywhere, so this is the only thing standing in its way.
        expect(sniffArtExtension(ascii('<!DOCTYPE h', ART_SNIFF_BYTES))).toBeUndefined();
        expect(sniffArtExtension(ascii('<svg xmlns=', ART_SNIFF_BYTES))).toBeUndefined();
    });

    it('goes by the bytes and not by what a file is called', () => {
        // The case an operator hits by accident: a JPEG saved as `weather.png`. It is stored and
        // served as a JPEG, which is right, and nothing anywhere reads the name.
        expect(sniffArtExtension(head(0xff, 0xd8, 0xff, 0xdb, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('jpg');
    });

    it('refuses a truncated signature rather than guessing from the first byte or two', () => {
        expect(sniffArtExtension(head(0x89, 0x50))).toBeUndefined();
        expect(sniffArtExtension(head())).toBeUndefined();
    });
});
