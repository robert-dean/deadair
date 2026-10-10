// A record committed before its cover was cached keeps the provider's URL server-side, and every
// reader that shows a cover to a listener asks this for the station's own copy. What it must get
// right: a cover appears as soon as the cache lands (so a miss is never remembered), a hit costs no
// further query, and a store that cannot be read costs the logo rather than an error.

import type { Logger } from '@maroonedsoftware/logger';
import { describe, expect, it, vi } from 'vitest';

import { ArtRepository, type ArtAsset } from '../../../src/modules/art/art.repository.js';
import { COVER_RETRY_MS, CoverResolver } from '../../../src/modules/art/cover.resolver.js';
import { clearArtSourceKey, configureArtSourceKey, openSourceToken } from '../../../src/modules/art/art.source.token.js';
import { stubContainer } from '../../utils/stub.container.js';

const UPSTREAM = 'https://music.example/rest/getCoverArt?id=al-1&u=operator&t=secret&s=salt';

const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as Logger;

const build = (held: Map<string, ArtAsset> = new Map()) => {
    const store = { held };
    const findBySourceUrls = vi.fn(async (urls: readonly string[]) => new Map([...store.held].filter(([url]) => urls.includes(url))));
    const { container } = stubContainer([[ArtRepository, { findBySourceUrls }]]);
    let now = 1_000_000;
    const clock = { advance: (ms: number) => (now += ms) };
    const resolver = new CoverResolver(container, logger, () => now);
    return { resolver, findBySourceUrls, store, clock };
};

const cached: ArtAsset = { id: 'asset-1', sourceUrl: UPSTREAM, checksum: 'abc', ext: 'jpg' };

describe('CoverResolver', () => {
    it('answers nothing for a cover it has not looked up yet, and asks the store off the caller', async () => {
        const { resolver, findBySourceUrls } = build(new Map([[UPSTREAM, cached]]));

        expect(resolver.resolve(UPSTREAM)).toBeUndefined();
        await resolver.ask(UPSTREAM);

        expect(findBySourceUrls).toHaveBeenCalledWith([UPSTREAM]);
        expect(resolver.resolve(UPSTREAM)).toBe('art/asset-1/cover.jpg');
    });

    it("answers the station's proxy path for an uncached cover, so a player shows it straight away", async () => {
        configureArtSourceKey('ef'.repeat(32));
        try {
            const { resolver } = build();

            const proxy = resolver.resolve(UPSTREAM)!;

            // A filename, for the player that decides by the URL; never the upstream URL itself.
            expect(proxy).toMatch(/^art\/source\/[A-Za-z0-9_-]+\/cover\.jpg$/);
            expect(openSourceToken(proxy.split('/')[2]!)).toBe(UPSTREAM);
            expect(proxy).not.toContain('music.example');
        } finally {
            clearArtSourceKey();
        }
    });

    it('remembers a hit, so a cover the station holds costs no further query', async () => {
        const { resolver, findBySourceUrls } = build(new Map([[UPSTREAM, cached]]));
        await resolver.ask(UPSTREAM);
        findBySourceUrls.mockClear();

        for (let poll = 0; poll < 10; poll++) expect(resolver.resolve(UPSTREAM)).toBe('art/asset-1/cover.jpg');

        expect(findBySourceUrls).not.toHaveBeenCalled();
    });

    it('does not remember a miss, so the cover appears once the cache job lands', async () => {
        const { resolver, store, clock } = build();
        await resolver.ask(UPSTREAM);
        expect(resolver.resolve(UPSTREAM)).toBeUndefined();

        // The cache job writes the bytes.
        store.held.set(UPSTREAM, cached);
        clock.advance(COVER_RETRY_MS);
        await resolver.ask(UPSTREAM);

        expect(resolver.resolve(UPSTREAM)).toBe('art/asset-1/cover.jpg');
    });

    it('treats a row with no bytes as a miss', async () => {
        const { resolver } = build(new Map([[UPSTREAM, { id: 'asset-1', sourceUrl: UPSTREAM }]]));
        await resolver.ask(UPSTREAM);

        expect(resolver.resolve(UPSTREAM)).toBeUndefined();
    });

    it('spaces its retries, so every listener polling an uncached record costs one query and not one each', async () => {
        const { resolver, findBySourceUrls, clock } = build();

        for (let poll = 0; poll < 20; poll++) resolver.resolve(UPSTREAM);
        await resolver.ask(UPSTREAM);
        expect(findBySourceUrls).toHaveBeenCalledTimes(1);

        clock.advance(COVER_RETRY_MS);
        await resolver.ask(UPSTREAM);
        expect(findBySourceUrls).toHaveBeenCalledTimes(2);
    });

    it('never asks about something that is not an upstream URL', () => {
        const { resolver, findBySourceUrls } = build();

        expect(resolver.resolve('art/asset-1')).toBeUndefined();
        expect(findBySourceUrls).not.toHaveBeenCalled();
    });

    it('answers nothing when the store cannot be read, and asks again later', async () => {
        const { resolver, findBySourceUrls, clock } = build();
        findBySourceUrls.mockRejectedValueOnce(new Error('the pool is gone'));

        await resolver.ask(UPSTREAM);
        expect(resolver.resolve(UPSTREAM)).toBeUndefined();

        clock.advance(COVER_RETRY_MS);
        await resolver.ask(UPSTREAM);
        expect(findBySourceUrls).toHaveBeenCalledTimes(2);
    });
});
