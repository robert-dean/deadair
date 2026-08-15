// The request chain: which calls a resolve actually makes, in what order, and what it does when one
// of them comes back empty. The judgement inside it is covered in `wikipedia.resolve.test.ts`.

import { beforeEach, describe, expect, it } from 'vitest';

import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { WikipediaPlugin } from '../src/wikipedia.plugin.js';
import { wikipediaManifest } from '../src/wikipedia.manifest.js';

const ARTIST_MBID = '153c9281-268f-4cf3-8938-f5a4593e5df4';
const RECORDING_MBID = 'f72fca9b-694d-4080-9fa8-529635a83fb7';

/** Long enough to survive `MIN_ARTICLE_CHARS`, which a stub deliberately does not. */
const ARTICLE = `"Rusty Cage" is a song by the American rock band Soundgarden. ${'It was written by Chris Cornell.'.repeat(8)}`;

const reply = (payload: unknown) => ({ body: JSON.stringify(payload) });

const search = (...ids: string[]) => reply({ query: { search: ids.map(id => ({ title: id })) } });

const entities = (payload: Record<string, unknown>) => reply({ entities: payload });

const extract = (title: string, text: string) => reply({ query: { pages: [{ pageid: 1, title, extract: text }] } });

let host: FakePluginHost;
let plugin: WikipediaPlugin;

const initialize = async (config: Record<string, unknown> = {}): Promise<void> => {
    host.seedConfig({ contactEmail: 'station@example.test', language: 'en', includeSongArticles: true, ...config });
    await plugin.init(host);
};

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new WikipediaPlugin();
});

describe('manifest', () => {
    it('paces both hosts on one bucket, because they are one service', () => {
        const network = wikipediaManifest.permissions?.network ?? [];

        expect(network).toEqual([
            { host: 'www.wikidata.org', ratePerSecond: 2, bucket: 'wikimedia' },
            { host: '*.wikipedia.org', ratePerSecond: 2, bucket: 'wikimedia' },
        ]);
    });

    it('asks for no storage, because every id it resolves goes back through providerRef', () => {
        expect(wikipediaManifest.permissions?.storage).toBe(false);
    });
});

describe('identifying itself', () => {
    it('sends a contact address, which Wikimedia asks every client for', async () => {
        await initialize();
        host.queueResponse(search());

        await plugin.enrichArtist({ name: 'Soundgarden', mbid: ARTIST_MBID });

        expect(host.calls[0]?.headers?.['user-agent']).toContain('mailto:station@example.test');
    });

    it('does nothing at all without one, rather than being blocked later', async () => {
        await initialize({ contactEmail: '' });

        expect(await plugin.enrichArtist({ name: 'Soundgarden', mbid: ARTIST_MBID })).toEqual({});
        expect(host.calls).toHaveLength(0);
    });
});

describe('an artist', () => {
    it('is found by its MusicBrainz id and followed to its article', async () => {
        await initialize();
        host.queueResponse(search('Q174817'));
        host.queueResponse(entities({ Q174817: { sitelinks: { enwiki: { title: 'Soundgarden' } } } }));
        host.queueResponse(extract('Soundgarden', ARTICLE));

        const enrichment = await plugin.enrichArtist({ name: 'Soundgarden', mbid: ARTIST_MBID });

        expect(host.calls[0]?.url).toContain(`haswbstatement%3AP434%3D${ARTIST_MBID}`);
        expect(enrichment.providerRef).toBe('Q174817');
        expect(enrichment.externalIds).toEqual([{ source: 'wikidata', id: 'Q174817' }]);
        expect(enrichment.links).toEqual([{ label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Soundgarden' }]);
        expect(enrichment.documents?.[0]?.text).toBe(ARTICLE);
    });

    it('never composes a fact of its own, whatever the article says', async () => {
        // Prose becomes a claim in the host, where it can be checked against the text it came from
        // and cited. A plugin writing its own one-liners would skip both.
        await initialize();
        host.queueResponse(search('Q174817'));
        host.queueResponse(entities({ Q174817: { sitelinks: { enwiki: { title: 'Soundgarden' } } } }));
        host.queueResponse(extract('Soundgarden', ARTICLE));

        const enrichment = await plugin.enrichArtist({ name: 'Soundgarden', mbid: ARTIST_MBID });

        expect(enrichment.facts).toBeUndefined();
        expect(enrichment.biography).toBeUndefined();
        expect(enrichment.genres).toBeUndefined();
    });

    it('takes the id the host handed back rather than searching again', async () => {
        await initialize();
        host.queueResponse(entities({ Q174817: { sitelinks: { enwiki: { title: 'Soundgarden' } } } }));
        host.queueResponse(extract('Soundgarden', ARTICLE));

        await plugin.enrichArtist({ name: 'Soundgarden', mbid: ARTIST_MBID, providerRef: 'Q174817' });

        expect(host.calls[0]?.url).toContain('wbgetentities');
    });

    it('still reports the id when the item has no article in this language', async () => {
        // A real identification, worth remembering: it saves the next pass the search that found it.
        await initialize();
        host.queueResponse(search('Q174817'));
        host.queueResponse(entities({ Q174817: { sitelinks: {} } }));

        const enrichment = await plugin.enrichArtist({ name: 'Soundgarden', mbid: ARTIST_MBID });

        expect(enrichment).toEqual({ providerRef: 'Q174817', externalIds: [{ source: 'wikidata', id: 'Q174817' }] });
    });

    it('says nothing about an artist the catalog has no mbid for', async () => {
        await initialize();

        expect(await plugin.enrichArtist({ name: 'Some Band' })).toEqual({});
        expect(host.calls).toHaveLength(0);
    });
});

describe('a song', () => {
    const ref = { artist: 'Soundgarden', title: 'Rusty Cage - Remastered 2016', mbid: RECORDING_MBID };

    const songItem = {
        Q2744292: {
            labels: { en: { value: 'Rusty Cage' } },
            sitelinks: { enwiki: { title: 'Rusty Cage' } },
            claims: { P175: [{ mainsnak: { snaktype: 'value', datavalue: { value: { id: 'Q174817' } } } }] },
        },
    };

    it('falls to the name search when the recording id reaches no article, and verifies the performer', async () => {
        await initialize();
        // The recording item exists and has no article, which is the ordinary case.
        host.queueResponse(search('Q136098430'));
        host.queueResponse(entities({ Q136098430: { sitelinks: {} } }));
        host.queueResponse(search('Q2744292'));
        host.queueResponse(entities(songItem));
        host.queueResponse(entities({ Q174817: { labels: { en: { value: 'Soundgarden' } } } }));
        host.queueResponse(entities({ Q2744292: { sitelinks: { enwiki: { title: 'Rusty Cage' } } } }));
        host.queueResponse(extract('Rusty Cage', ARTICLE));

        const enrichment = await plugin.enrichTrack(ref);

        expect(host.calls[2]?.url).toContain('Rusty+Cage+Soundgarden');
        expect(enrichment.providerRef).toBe('Q2744292');
        expect(enrichment.documents?.[0]?.url).toBe('https://en.wikipedia.org/wiki/Rusty_Cage');
    });

    it('drops a song whose performers are somebody else, rather than airing the cover', async () => {
        await initialize();
        host.queueResponse(search('Q136098430'));
        host.queueResponse(entities({ Q136098430: { sitelinks: {} } }));
        host.queueResponse(search('Q9'));
        host.queueResponse(
            entities({
                Q9: {
                    labels: { en: { value: 'Rusty Cage' } },
                    sitelinks: { enwiki: { title: 'Rusty Cage (Johnny Cash song)' } },
                    claims: { P175: [{ mainsnak: { snaktype: 'value', datavalue: { value: { id: 'Q42' } } } }] },
                },
            }),
        );
        host.queueResponse(entities({ Q42: { labels: { en: { value: 'Johnny Cash' } } } }));

        expect(await plugin.enrichTrack(ref)).toEqual({});
    });

    it('is not looked up at all when the operator turned song articles off', async () => {
        await initialize({ includeSongArticles: false });

        expect(await plugin.enrichTrack(ref)).toEqual({});
        expect(host.calls).toHaveLength(0);
    });

    it('searches by name for a track with no mbid at all', async () => {
        await initialize();
        host.queueResponse(search());

        await plugin.enrichTrack({ artist: 'Soundgarden', title: 'Rusty Cage' });

        expect(host.calls).toHaveLength(1);
        expect(host.calls[0]?.url).toContain('Rusty+Cage+Soundgarden');
    });

    it('stops before the search rather than being cut off between two requests', async () => {
        // A chain half spent is requests paid for and nothing stored.
        await initialize();
        host.seedRemainingMs(500);

        expect(await plugin.enrichTrack({ artist: 'Soundgarden', title: 'Rusty Cage' })).toEqual({});
        expect(host.calls).toHaveLength(0);
    });
});

describe('a record', () => {
    it('is found by its release-group id', async () => {
        await initialize();
        host.queueResponse(search('Q115485147'));
        host.queueResponse(entities({ Q115485147: { sitelinks: { enwiki: { title: '72 Seasons' } } } }));
        host.queueResponse(extract('72 Seasons', ARTICLE));

        const enrichment = await plugin.enrichAlbum({ name: '72 Seasons', artist: 'Metallica', mbid: 'a0b7b436-94db-4df6-8c5f-bc0e5932a90e' });

        expect(host.calls[0]?.url).toContain('haswbstatement%3AP436%3D');
        expect(enrichment.documents?.[0]?.title).toBe('72 Seasons');
    });
});

describe('the language', () => {
    it('reads the edition the operator chose, on both ends of the chain', async () => {
        await initialize({ language: 'de' });
        host.queueResponse(search('Q174817'));
        host.queueResponse(entities({ Q174817: { sitelinks: { dewiki: { title: 'Soundgarden' } } } }));
        host.queueResponse(extract('Soundgarden', ARTICLE));

        const enrichment = await plugin.enrichArtist({ name: 'Soundgarden', mbid: ARTIST_MBID });

        expect(host.calls[1]?.url).toContain('sitefilter=dewiki');
        expect(host.calls[2]?.url).toContain('de.wikipedia.org');
        expect(enrichment.documents?.[0]?.url).toBe('https://de.wikipedia.org/wiki/Soundgarden');
    });
});
