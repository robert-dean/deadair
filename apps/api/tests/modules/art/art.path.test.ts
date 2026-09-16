// `artPath` and the SQL in `catalog.art.ts` build the same string in two languages, and they have
// to agree: the TypeScript one is what the director puts on a record heading for air, the SQL one
// is what every catalog read reports, and a disagreement is a URL that 404s on whichever side got
// it wrong. `catalog.art.test.ts` pins the SQL half.

import { describe, expect, it } from 'vitest';

import { artPath } from '../../../src/modules/art/art.path.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('artPath', () => {
    it('names the file after the extension the store recorded', () => {
        // The filename is what makes a hardware player fetch it at all: it decides whether a URL is
        // a picture by looking at the URL, and never asks for one that ends in an id.
        expect(artPath({ id: ID, ext: 'jpg' })).toBe(`art/${ID}/cover.jpg`);
        expect(artPath({ id: ID, ext: 'png' })).toBe(`art/${ID}/cover.png`);
    });

    it('leaves the name off an asset the store recorded no extension for', () => {
        // There is nothing true to call it. A player that wants an extension ignores it, and a
        // browser does not care.
        expect(artPath({ id: ID })).toBe(`art/${ID}`);
    });

    it('is a path under the API root rather than a URL', () => {
        // The API knows nothing about the `/api` prefix the edge adds, so it cannot mint an
        // absolute local URL; every consumer resolves this against the base it already has.
        expect(artPath({ id: ID, ext: 'jpg' }).startsWith('art/')).toBe(true);
    });
});
