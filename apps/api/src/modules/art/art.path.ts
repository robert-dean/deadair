import type { ArtAsset } from './art.repository.js';

/**
 * Where the station serves one cached asset, as a path under the API root.
 *
 * **This is the same string `cachedOrUpstream` in `catalog.art.ts` builds in SQL, and the two have
 * to agree.** They cannot share an implementation: one is a `select` running inside a catalog read
 * and the other is a TypeScript call on a row already in hand. `catalog.art.test.ts` pins the SQL's
 * half and this file's tests pin the other, so a change to either shape fails a test rather than
 * quietly serving a URL that 404s.
 *
 * The filename is what makes a hardware player fetch it at all: it decides whether a URL is a
 * picture by looking at the URL, and never asks for one that ends in an id. `GET /art/{id}/{filename}`
 * answers by the id and ignores the name, so the name is a shape rather than a promise. An asset the
 * store recorded no extension for keeps its bare path, because there is nothing true to call it.
 */
export function artPath(asset: Pick<ArtAsset, 'id' | 'ext'>): string {
    return asset.ext === undefined ? `art/${asset.id}` : `art/${asset.id}/cover.${asset.ext}`;
}
