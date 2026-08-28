// The enrichment half: what it asks for, what it opens, and — the important one
// — what it does when the operator has trusted nobody. The trust boundary itself
// is the HOST's allowlist rather than anything here, so what these tests can
// prove is the cheaper half of it: that the plugin scopes its search to the list,
// drops what came back from anywhere else, and makes no request at all when the
// list is empty.

import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePluginHost, PluginError, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { WebSearchPlugin } from '../src/websearch.plugin.js';
import { parseTrustedSites } from '../src/websearch.enrichment.js';
import { ARTICLE_TIMEOUT_MS } from '../src/websearch.manifest.js';

let host: FakePluginHost;
let plugin: WebSearchPlugin;

const siteRows = (...entries: Record<string, string>[]): string => JSON.stringify(entries);

const initialize = async (config: Record<string, unknown> = {}): Promise<void> => {
    host.seedConfig({
        provider: 'searxng',
        baseUrl: 'http://searxng:8080',
        trustedSites: siteRows({ name: 'Example', site: 'https://www.example.com' }),
        ...config,
    });
    await plugin.init(host);
};

const queueSearch = (...urls: string[]): void =>
    host.queueResponse({
        status: 200,
        body: JSON.stringify({ results: urls.map((url, index) => ({ title: `Result ${index}`, content: 'A snippet.', url })) }),
        headers: { 'content-type': 'application/json' },
    });

/**
 * A page whose paragraph is long enough to survive `extractArticle`, which drops
 * anything short on the grounds that a page's furniture is short and its prose
 * is not.
 */
const prose = (words: string): string => `${words} It goes on for a while after that, in complete sentences, the way an article does.`;

const queuePage = (text: string): void =>
    host.queueResponse({
        status: 200,
        body: `<html><body><article><p>${text}</p></article></body></html>`,
        headers: { 'content-type': 'text/html' },
    });

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new WebSearchPlugin();
});

describe('parseTrustedSites', () => {
    it('reads the rows as bare hostnames, which is what a site clause and an allowlist both want', () => {
        expect(parseTrustedSites(siteRows({ site: 'https://www.example.com/about' }, { site: 'http://other.example.org' }))).toEqual([
            { hostname: 'example.com' },
            { hostname: 'other.example.org' },
        ]);
    });

    it('keeps the operator name where they gave one', () => {
        expect(parseTrustedSites(siteRows({ name: 'Example', site: 'https://example.com' }))).toEqual([
            { hostname: 'example.com', name: 'Example' },
        ]);
    });

    it('collapses two rows at one site, which would otherwise search it twice', () => {
        expect(parseTrustedSites(siteRows({ site: 'https://example.com/a' }, { site: 'https://www.example.com/b' }))).toHaveLength(1);
    });

    it('drops a row it cannot read rather than throwing, since the form already refused it', () => {
        expect(parseTrustedSites(siteRows({ site: 'not an address' }, { site: 'https://example.com' }))).toEqual([{ hostname: 'example.com' }]);
        expect(parseTrustedSites('')).toEqual([]);
        expect(parseTrustedSites(undefined)).toEqual([]);
    });
});

describe('with no trusted sites, which is the default', () => {
    it('answers nothing about an artist and makes no request at all', async () => {
        await initialize({ trustedSites: '[]' });

        await expect(plugin.enrichArtist({ name: 'Portishead' })).resolves.toEqual({});
        expect(host.calls).toHaveLength(0);
    });

    it('answers nothing about a record either', async () => {
        await initialize({ trustedSites: '[]' });

        await expect(plugin.enrichAlbum({ name: 'Dummy', artist: 'Portishead' })).resolves.toEqual({});
        expect(host.calls).toHaveLength(0);
    });

    it('still searches, because that half needs no trusted site', async () => {
        await initialize({ trustedSites: '[]' });
        queueSearch('https://anywhere.example.net/a');

        await expect(plugin.search({ query: 'portishead', limit: 5 })).resolves.toHaveLength(1);
    });
});

describe('enrichArtist', () => {
    it('scopes the search to the trusted sites and reads the page it found', async () => {
        await initialize();
        queueSearch('https://www.example.com/portishead');
        queuePage('Portishead formed in Bristol in 1991 and released Dummy three years later.');

        const answer = await plugin.enrichArtist({ name: 'Portishead' });

        expect(decodeURIComponent(host.calls[0]?.url ?? '')).toContain('site:example.com');
        expect(answer.documents).toEqual([
            {
                url: 'https://www.example.com/portishead',
                title: 'Result 0',
                text: expect.stringContaining('formed in Bristol'),
                retrievedAt: expect.any(String),
            },
        ]);
    });

    it('hands over the prose verbatim rather than a summary of it', async () => {
        // The host checks every claim's quoted span against this text. A span
        // that has been through a paraphrase is one nothing can check.
        const published = 'They recorded it in a rented house over eighteen months, and then mixed the whole thing twice.';
        await initialize();
        queueSearch('https://www.example.com/dummy');
        queuePage(published);

        const answer = await plugin.enrichAlbum({ name: 'Dummy', artist: 'Portishead' });

        expect(answer.documents?.[0]?.text).toBe(published);
    });

    it('drops a result that came back from a site nobody trusted', async () => {
        // The host would refuse the request anyway. This is the cheaper way to
        // the same answer, and it is what stops the plugin spending a request to
        // be told no.
        await initialize();
        queueSearch('https://spam.example.net/portishead');

        await expect(plugin.enrichArtist({ name: 'Portishead' })).resolves.toEqual({});
        expect(host.calls).toHaveLength(1);
    });

    it('reads no more pages than the operator allowed', async () => {
        await initialize({ maxDocuments: 2 });
        queueSearch('https://www.example.com/a', 'https://www.example.com/b', 'https://www.example.com/c');
        queuePage(prose('One.'));
        queuePage(prose('Two.'));
        queuePage(prose('Three.'));

        const answer = await plugin.enrichArtist({ name: 'Portishead' });

        expect(answer.documents).toHaveLength(2);
        // One search plus two pages: the third was never fetched.
        expect(host.calls).toHaveLength(3);
    });

    it('carries on past a page with no prose on it, rather than answering short', async () => {
        await initialize({ maxDocuments: 1 });
        queueSearch('https://www.example.com/gallery', 'https://www.example.com/story');
        host.queueResponse({ status: 200, body: 'JPEG', headers: { 'content-type': 'image/jpeg' } });
        queuePage(prose('The story of the record, at length.'));

        const answer = await plugin.enrichArtist({ name: 'Portishead' });

        expect(answer.documents).toHaveLength(1);
        expect(answer.documents?.[0]?.url).toBe('https://www.example.com/story');
    });

    it('lets one page fail without costing the subject the others', async () => {
        await initialize({ maxDocuments: 2 });
        queueSearch('https://www.example.com/down', 'https://www.example.com/up');
        host.queueResponse({ status: 503, body: 'no' });
        queuePage(prose('The one that answered.'));

        const answer = await plugin.enrichArtist({ name: 'Portishead' });

        expect(answer.documents).toHaveLength(1);
    });

    it('answers nothing when the engine itself refused, and does not take the walk down with it', async () => {
        await initialize();
        host.setFetchImpl(async () => {
            throw new PluginError('rate limited').withCode('rate_limited');
        });

        await expect(plugin.enrichArtist({ name: 'Portishead' })).resolves.toEqual({});
    });

    it('does not start a page there is not enough of the call left to read', async () => {
        await initialize();
        queueSearch('https://www.example.com/portishead');
        host.setFetchImpl(async () => {
            host.seedRemainingMs(ARTICLE_TIMEOUT_MS - 1);
            return new Response(JSON.stringify({ results: [{ title: 'A', content: 'b', url: 'https://www.example.com/a' }] }), {
                headers: { 'content-type': 'application/json' },
            });
        });

        await expect(plugin.enrichArtist({ name: 'Portishead' })).resolves.toEqual({});
    });
});

describe('enrichTrack', () => {
    it('answers nothing, because a search per recording is a request per track', async () => {
        await initialize();

        await expect(plugin.enrichTrack()).resolves.toEqual({});
        expect(host.calls).toHaveLength(0);
    });
});
