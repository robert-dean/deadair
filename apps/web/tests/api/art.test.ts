// `imageUrl` carries two shapes and the difference is invisible in a type: an absolute upstream
// URL, or an API-relative path to the station's own copy. Prefixing the wrong one produces
// `/api/https://...`, which fails as a silently broken image rather than as an error.

import { describe, expect, it } from 'vitest';

import { artSrc } from '../../src/api/art';

describe('artSrc', () => {
    it('resolves the local path against the API base', () => {
        expect(artSrc('art/11111111-1111-4111-8111-111111111111')).toBe('/api/art/11111111-1111-4111-8111-111111111111');
    });

    it('leaves an upstream URL alone', () => {
        expect(artSrc('https://i.scdn.co/image/abc')).toBe('https://i.scdn.co/image/abc');
        expect(artSrc('http://coverartarchive.org/release/abc/front-500')).toBe('http://coverartarchive.org/release/abc/front-500');
    });

    it('passes absence through, so a row can be handed over unchecked', () => {
        expect(artSrc(undefined)).toBeUndefined();
        expect(artSrc('')).toBeUndefined();
    });

    it('does not double the separator if the path ever arrives with one', () => {
        expect(artSrc('/art/abc')).toBe('/api/art/abc');
    });
});
