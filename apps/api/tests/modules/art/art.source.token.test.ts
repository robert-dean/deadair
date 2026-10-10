// The token is a provider's cover URL sealed so a read can hand out a path to it without handing out
// the URL. What it must never do: let the URL (and the credential in its query string) be read back
// out of the path, accept a token this station did not mint, or answer the upstream URL when no key
// is configured.

import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    clearArtSourceKey,
    configureArtSourceKey,
    openSourceToken,
    sealSourceUrl,
    stationCover,
    withStationCover,
} from '../../../src/modules/art/art.source.token.js';

const KEY = 'ab'.repeat(32);
const UPSTREAM = 'https://music.example/rest/getCoverArt.view?id=al-42&u=operator&t=5f4dcc3b5aa765d61d8327deb882cf99&s=salty';

beforeEach(() => configureArtSourceKey(KEY));
afterEach(() => clearArtSourceKey());

describe('sealing a cover URL', () => {
    it('opens back to exactly the URL it sealed', () => {
        const token = sealSourceUrl(UPSTREAM)!;

        expect(openSourceToken(token)).toBe(UPSTREAM);
    });

    it('is deterministic, so one cover is one path for a browser cache and a single-flight', () => {
        expect(sealSourceUrl(UPSTREAM)).toBe(sealSourceUrl(UPSTREAM));
        expect(sealSourceUrl(UPSTREAM)).not.toBe(sealSourceUrl(`${UPSTREAM}x`));
    });

    it('is URL-safe, so it can sit in a path segment as it is', () => {
        expect(sealSourceUrl(UPSTREAM)).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('does not carry the URL, or any piece of the credential, in readable form', () => {
        const token = sealSourceUrl(UPSTREAM)!;
        const decoded = Buffer.from(token, 'base64url').toString('latin1');

        for (const piece of ['music.example', 'getCoverArt', 'operator', '5f4dcc3b5aa765d61d8327deb882cf99', 'salty']) {
            expect(token).not.toContain(piece);
            expect(decoded).not.toContain(piece);
        }
    });

    it('opens nothing it did not mint: a flipped bit, a truncation, junk, or another key', () => {
        const token = sealSourceUrl(UPSTREAM)!;
        const raw = Buffer.from(token, 'base64url');

        for (const at of [0, 5, 14, raw.length - 1]) {
            const flipped = Buffer.from(raw);
            flipped[at] = flipped[at]! ^ 0x01;
            expect(openSourceToken(flipped.toString('base64url'))).toBeUndefined();
        }
        expect(openSourceToken(token.slice(0, -4))).toBeUndefined();
        expect(openSourceToken('not-a-token-at-all-but-long-enough')).toBeUndefined();
        expect(openSourceToken('has/slash')).toBeUndefined();

        configureArtSourceKey(randomBytes(32).toString('hex'));
        expect(openSourceToken(token)).toBeUndefined();
    });

    it('refuses a token whose IV was not derived from its own plaintext', () => {
        // Same key, same URL, but an IV the station would never choose: GCM alone would accept it.
        const token = sealSourceUrl(UPSTREAM)!;
        const other = sealSourceUrl('https://other.example/cover.jpg')!;
        const spliced = Buffer.concat([Buffer.from(other, 'base64url').subarray(0, 12), Buffer.from(token, 'base64url').subarray(12)]);

        expect(openSourceToken(spliced.toString('base64url'))).toBeUndefined();
    });
});

describe('stationCover', () => {
    it("leaves the station's own path alone", () => {
        expect(stationCover('art/asset-1/cover.jpg')).toBe('art/asset-1/cover.jpg');
    });

    it("turns an upstream URL into the station's proxy path for it", () => {
        const cover = stationCover(UPSTREAM)!;

        expect(cover).toMatch(/^art\/source\/[A-Za-z0-9_-]+$/);
        expect(openSourceToken(cover.slice('art/source/'.length))).toBe(UPSTREAM);
    });

    it('answers nothing for nothing, and for anything that is neither', () => {
        expect(stationCover(undefined)).toBeUndefined();
        expect(stationCover(null)).toBeUndefined();
        expect(stationCover('file:///etc/passwd')).toBeUndefined();
    });

    it('fails closed with no key: no cover, never the upstream URL', () => {
        clearArtSourceKey();

        expect(stationCover(UPSTREAM)).toBeUndefined();
        expect(stationCover('art/asset-1')).toBe('art/asset-1');
    });

    it('maps one field of a row and keeps the rest', () => {
        const row = { id: 'a', imageUrl: UPSTREAM as string | null };

        const mapped = withStationCover(row, 'imageUrl');

        expect(mapped.id).toBe('a');
        expect(mapped.imageUrl).toMatch(/^art\/source\//);
    });
});
