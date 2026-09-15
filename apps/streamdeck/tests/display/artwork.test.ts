import { describe, expect, it, vi } from 'vitest';

import { ArtworkCache, resolveArtworkUrl } from '../../src/display/artwork.js';

const API = 'https://radio.example.com/api';

describe('resolveArtworkUrl', () => {
    it('puts the station’s own copy under the API prefix', () => {
        expect(resolveArtworkUrl(API, 'art/5f0c')).toBe('https://radio.example.com/api/art/5f0c');
        expect(resolveArtworkUrl(API, '/art/5f0c')).toBe('https://radio.example.com/api/art/5f0c');
    });

    it('leaves a provider’s address as it is', () => {
        expect(resolveArtworkUrl(API, 'https://i.scdn.co/image/ab67')).toBe('https://i.scdn.co/image/ab67');
    });

    it('has nothing to fetch for nothing', () => {
        expect(resolveArtworkUrl(API, undefined)).toBeUndefined();
        expect(resolveArtworkUrl(API, ' ')).toBeUndefined();
    });
});

function image(type = 'image/jpeg', bytes = 'cover', headers: Record<string, string> = {}): Response {
    return new Response(bytes, { headers: { 'content-type': type, ...headers } });
}

describe('ArtworkCache', () => {
    it('answers a cover as a data URI, asking with the plugin’s agent and without the station’s key', async () => {
        const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => image());
        const cache = new ArtworkCache({ fetch, userAgent: 'deadair-streamdeck/0.1.0' });

        expect(await cache.load(`${API}/art/1`)).toBe(`data:image/jpeg;base64,${Buffer.from('cover').toString('base64')}`);
        const headers = fetch.mock.calls[0]![1]!.headers as Record<string, string>;
        expect(headers).toEqual({ 'User-Agent': 'deadair-streamdeck/0.1.0' });
    });

    it('fetches a cover once, however many ask while it downloads and after', async () => {
        const fetch = vi.fn(async () => image());
        const cache = new ArtworkCache({ fetch, userAgent: 'agent' });
        await Promise.all([cache.load('a'), cache.load('a'), cache.load('a')]);
        await cache.load('a');
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(cache.peek('a')?.cover).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('remembers a cover it could not have, so it is not asked for on every redraw', async () => {
        const fetch = vi.fn(async () => new Response('missing', { status: 404 }));
        const cache = new ArtworkCache({ fetch, userAgent: 'agent' });
        expect(await cache.load('a')).toBeUndefined();
        expect(await cache.load('a')).toBeUndefined();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(cache.peek('a')).toEqual({ cover: undefined });
        expect(cache.peek('b')).toBeUndefined();
    });

    it('draws nothing it cannot draw, and nothing too big to send to a key', async () => {
        const avif = new ArtworkCache({ fetch: async () => image('image/avif'), userAgent: 'agent' });
        expect(await avif.load('a')).toBeUndefined();

        const declared = new ArtworkCache({ fetch: async () => image('image/png', 'x', { 'content-length': '5000000' }), userAgent: 'agent' });
        expect(await declared.load('a')).toBeUndefined();

        const actual = new ArtworkCache({ fetch: async () => image('image/png', 'x'.repeat(2_000)), userAgent: 'agent', maxBytes: 1_000 });
        expect(await actual.load('a')).toBeUndefined();
    });

    it('treats a fetch that throws as a cover it could not have', async () => {
        const cache = new ArtworkCache({ fetch: async () => Promise.reject(new TypeError('fetch failed')), userAgent: 'agent' });
        expect(await cache.load('a')).toBeUndefined();
    });

    it('forgets the oldest cover past its capacity', async () => {
        const fetch = vi.fn(async () => image());
        const cache = new ArtworkCache({ fetch, userAgent: 'agent', capacity: 2 });
        await cache.load('a');
        await cache.load('b');
        await cache.load('c');
        expect(cache.peek('a')).toBeUndefined();
        expect(cache.peek('c')).toBeDefined();
    });
});
