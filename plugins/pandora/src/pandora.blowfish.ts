/**
 * Blowfish in ECB mode, which is all Pandora's tuner API asks for: its sign-in bodies are encrypted
 * with it and its clock answer is decrypted with it.
 *
 * Written here rather than taken from Node because OpenSSL 3 keeps `bf-ecb` behind its legacy
 * provider, so `createCipheriv('bf-ecb', …)` throws "unsupported" on every Node this station runs on.
 * And written rather than installed because a runtime dependency is what an installed-plugin check
 * cannot prove; see the plugin README.
 *
 * The cipher's initial P-array and S-boxes are, by definition, the fractional hex digits of pi in
 * order: 18 words, then 4 × 256. So they are COMPUTED once (Machin's formula in BigInt fixed point,
 * about 40ms) rather than carried as a thousand-number literal nobody can check by eye. The tests pin
 * the published test vector, which a single wrong digit anywhere would fail.
 */

const P_WORDS = 18;
const S_WORDS = 4 * 256;

let piWords: Uint32Array | undefined;

/** The first `P_WORDS + S_WORDS` 32-bit words of pi's fractional part. */
function pi(): Uint32Array {
    if (piWords !== undefined) return piWords;

    const words = P_WORDS + S_WORDS;
    // 64 guard bits below the last word, so truncation in the series never reaches a digit kept.
    const bits = BigInt(words * 32 + 64);
    const one = 1n << bits;
    const arctanOfInverse = (x: bigint): bigint => {
        let sum = 0n;
        let term = one / x;
        let n = 1n;
        let positive = true;
        const xx = x * x;
        while (term !== 0n) {
            sum += positive ? term / n : -(term / n);
            term /= xx;
            n += 2n;
            positive = !positive;
        }
        return sum;
    };
    const value = 4n * (4n * arctanOfInverse(5n) - arctanOfInverse(239n));
    const fraction = value - (3n << bits);

    piWords = new Uint32Array(words);
    for (let i = 0; i < words; i += 1) piWords[i] = Number((fraction >> (bits - BigInt(32 * (i + 1)))) & 0xffffffffn);
    return piWords;
}

/** A keyed Blowfish cipher. Blocks are 8 bytes; inputs must already be a multiple of that. */
export class Blowfish {
    private readonly p: Uint32Array;
    private readonly s: Uint32Array;

    constructor(key: Uint8Array) {
        if (key.length === 0 || key.length > 56) throw new RangeError('a Blowfish key is 1 to 56 bytes');

        const digits = pi();
        this.p = digits.slice(0, P_WORDS);
        this.s = digits.slice(P_WORDS);

        let offset = 0;
        for (let i = 0; i < P_WORDS; i += 1) {
            let word = 0;
            for (let b = 0; b < 4; b += 1) {
                word = ((word << 8) | key[offset]!) >>> 0;
                offset = (offset + 1) % key.length;
            }
            this.p[i] = (this.p[i]! ^ word) >>> 0;
        }

        const block = [0, 0] as [number, number];
        for (let i = 0; i < P_WORDS; i += 2) {
            this.encryptBlock(block);
            this.p[i] = block[0];
            this.p[i + 1] = block[1];
        }
        for (let i = 0; i < S_WORDS; i += 2) {
            this.encryptBlock(block);
            this.s[i] = block[0];
            this.s[i + 1] = block[1];
        }
    }

    /** ECB-encrypt `data`, whose length must be a multiple of 8. */
    encrypt(data: Uint8Array): Uint8Array {
        return this.each(data, block => this.encryptBlock(block));
    }

    /** ECB-decrypt `data`, whose length must be a multiple of 8. */
    decrypt(data: Uint8Array): Uint8Array {
        return this.each(data, block => this.decryptBlock(block));
    }

    private each(data: Uint8Array, step: (block: [number, number]) => void): Uint8Array {
        if (data.length % 8 !== 0) throw new RangeError('Blowfish ECB works on whole 8-byte blocks');

        const out = new Uint8Array(data.length);
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const into = new DataView(out.buffer);
        const block = [0, 0] as [number, number];
        for (let at = 0; at < data.length; at += 8) {
            block[0] = view.getUint32(at);
            block[1] = view.getUint32(at + 4);
            step(block);
            into.setUint32(at, block[0]);
            into.setUint32(at + 4, block[1]);
        }
        return out;
    }

    private f(x: number): number {
        const s = this.s;
        const a = s[x >>> 24]!;
        const b = s[256 + ((x >>> 16) & 0xff)]!;
        const c = s[512 + ((x >>> 8) & 0xff)]!;
        const d = s[768 + (x & 0xff)]!;
        return ((((a + b) >>> 0) ^ c) + d) >>> 0;
    }

    private encryptBlock(block: [number, number]): void {
        let [left, right] = block;
        for (let i = 0; i < 16; i += 1) {
            left = (left ^ this.p[i]!) >>> 0;
            right = (right ^ this.f(left)) >>> 0;
            [left, right] = [right, left];
        }
        [left, right] = [right, left];
        right = (right ^ this.p[16]!) >>> 0;
        left = (left ^ this.p[17]!) >>> 0;
        block[0] = left;
        block[1] = right;
    }

    private decryptBlock(block: [number, number]): void {
        let [left, right] = block;
        for (let i = 17; i > 1; i -= 1) {
            left = (left ^ this.p[i]!) >>> 0;
            right = (right ^ this.f(left)) >>> 0;
            [left, right] = [right, left];
        }
        [left, right] = [right, left];
        right = (right ^ this.p[1]!) >>> 0;
        left = (left ^ this.p[0]!) >>> 0;
        block[0] = left;
        block[1] = right;
    }
}
