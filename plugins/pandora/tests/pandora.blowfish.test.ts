// The cipher's tables are computed from pi rather than written out, so these published vectors are
// what proves every digit: one wrong word anywhere in the P-array or the S-boxes fails them all.

import { describe, expect, it } from 'vitest';

import { Blowfish } from '../src/pandora.blowfish.js';

const hex = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'hex'));
const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

// Eric Young's Blowfish ECB test vectors: key, plaintext, ciphertext.
const VECTORS = [
    ['0000000000000000', '0000000000000000', '4ef997456198dd78'],
    ['ffffffffffffffff', 'ffffffffffffffff', '51866fd5b85ecb8a'],
    ['3000000000000000', '1000000000000001', '7d856f9a613063f2'],
    ['0123456789abcdef', '1111111111111111', '61f9c3802281b096'],
    ['fedcba9876543210', '0123456789abcdef', '0aceab0fc6a0a28d'],
] as const;

describe('Blowfish', () => {
    it.each(VECTORS)('encrypts with key %s as published', (key, plain, cipher) => {
        expect(toHex(new Blowfish(hex(key)).encrypt(hex(plain)))).toBe(cipher);
    });

    it.each(VECTORS)('decrypts with key %s as published', (key, plain, cipher) => {
        expect(toHex(new Blowfish(hex(key)).decrypt(hex(cipher)))).toBe(plain);
    });

    it('round-trips several blocks with a text key, the way Pandora uses it', () => {
        const cipher = new Blowfish(new TextEncoder().encode('6#26FRL$ZWD'));
        const plain = new TextEncoder().encode('{"loginType":"user"}\0\0\0\0');

        expect(cipher.decrypt(cipher.encrypt(plain))).toEqual(plain);
    });

    it('refuses a partial block rather than padding it silently', () => {
        expect(() => new Blowfish(hex('00')).encrypt(new Uint8Array(5))).toThrow(RangeError);
    });

    it('refuses a key Blowfish does not define', () => {
        expect(() => new Blowfish(new Uint8Array(0))).toThrow(RangeError);
        expect(() => new Blowfish(new Uint8Array(57))).toThrow(RangeError);
    });
});
