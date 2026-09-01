// The token on a URL the player fetches. What is pinned: that a token signs one path and one
// expiry and nothing else, that every way of being wrong is refused the same way, and that the
// signer puts exactly that token on a URL, or says so once when it cannot.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { AUDIO_URL_TTL_MS, signAudioPath, verifyAudioToken } from '../../../src/modules/playout/playout.audio.token.js';
import { AudioUrlSigner } from '../../../src/modules/playout/audio.url.signer.js';
import type { LiquidsoapEndpoint } from '../../../src/modules/playout/liquidsoap.endpoint.js';

const SECRET = 'bridge-secret';
const PATH = '/segments/8c1c9f2e-3b6a-4d1e-9c1a-2f3b4c5d6e7f/audio';
const NOW = 1_700_000_000_000;

describe('signAudioPath / verifyAudioToken', () => {
    it('verifies what it signed, for the path it signed, before it expires', () => {
        const token = signAudioPath(SECRET, PATH, NOW + 60_000);

        expect(verifyAudioToken(SECRET, PATH, token, NOW)).toBe(true);
        expect(verifyAudioToken(SECRET, PATH, token, NOW + 59_000)).toBe(true);
    });

    it('refuses the token once it has expired', () => {
        const token = signAudioPath(SECRET, PATH, NOW + 60_000);

        expect(verifyAudioToken(SECRET, PATH, token, NOW + 61_000)).toBe(false);
    });

    it('refuses a token cut for another path', () => {
        const token = signAudioPath(SECRET, PATH, NOW + 60_000);

        expect(verifyAudioToken(SECRET, '/segments/00000000-0000-4000-8000-000000000000/audio', token, NOW)).toBe(false);
        expect(verifyAudioToken(SECRET, `${PATH}/`, token, NOW)).toBe(false);
    });

    it('refuses a token cut with another secret', () => {
        const token = signAudioPath('another-secret', PATH, NOW + 60_000);

        expect(verifyAudioToken(SECRET, PATH, token, NOW)).toBe(false);
    });

    it('refuses an expiry somebody moved', () => {
        const token = signAudioPath(SECRET, PATH, NOW + 60_000);
        const [, mac] = token.split('.');

        expect(verifyAudioToken(SECRET, PATH, `${Math.floor((NOW + 3_600_000) / 1000)}.${mac}`, NOW)).toBe(false);
    });

    it.each(['', 'nodot', '.abc', '123.', 'abc.def', '1700000000.', '99999999999999.x'])('refuses the malformed token %j', token => {
        expect(verifyAudioToken(SECRET, PATH, token, NOW)).toBe(false);
    });

    it('verifies nothing while the secret is unseeded, whatever is presented', () => {
        const token = signAudioPath('', PATH, NOW + 60_000);

        expect(verifyAudioToken('', PATH, token, NOW)).toBe(false);
    });
});

describe('AudioUrlSigner', () => {
    const signer = (secret: string, now = NOW) => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
        const endpoint = { secret: () => secret } as unknown as LiquidsoapEndpoint;
        return { signer: new AudioUrlSigner(endpoint, logger as unknown as Logger, () => now), logger };
    };

    it('puts a token over the path on the URL, valid for the ttl', () => {
        const signed = new URL(signer(SECRET).signer.sign(`http://host.docker.internal:3333${PATH}`));

        const token = signed.searchParams.get('t');
        expect(token).not.toBeNull();
        expect(signed.pathname).toBe(PATH);
        expect(verifyAudioToken(SECRET, PATH, token!, NOW)).toBe(true);
        expect(verifyAudioToken(SECRET, PATH, token!, NOW + AUDIO_URL_TTL_MS - 1_000)).toBe(true);
        expect(verifyAudioToken(SECRET, PATH, token!, NOW + AUDIO_URL_TTL_MS + 1_000)).toBe(false);
    });

    it('signs the path and not the host, so the URL is valid at any address that reaches the app', () => {
        const here = new URL(signer(SECRET).signer.sign(`http://app:3333${PATH}`)).searchParams.get('t')!;

        expect(verifyAudioToken(SECRET, PATH, here, NOW)).toBe(true);
    });

    it('keeps a query the URL already carried', () => {
        const signed = new URL(signer(SECRET).signer.sign(`http://app:3333${PATH}?x=1`));

        expect(signed.searchParams.get('x')).toBe('1');
        expect(signed.searchParams.get('t')).not.toBeNull();
    });

    it('hands the URL back unsigned while the secret is unseeded, and says so once', () => {
        const { signer: unseeded, logger } = signer('');

        expect(unseeded.sign(`http://app:3333${PATH}`)).toBe(`http://app:3333${PATH}`);
        unseeded.sign(`http://app:3333${PATH}`);

        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0]?.[0]).toMatch(/unsigned/);
    });
});
