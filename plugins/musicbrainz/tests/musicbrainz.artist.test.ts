import { beforeEach, describe, expect, it } from 'vitest';

import type { TrackRef } from '@deadair/plugin-sdk';

import { artistFacts, mapArtist, wikidataId } from '../src/musicbrainz.artist.js';
import { MusicBrainzPlugin } from '../src/musicbrainz.plugin.js';
import type { MusicBrainzArtist } from '../src/musicbrainz.types.js';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

const ref: TrackRef = { artist: 'Portishead', title: 'Glory Box', album: 'Dummy' };

const portishead: MusicBrainzArtist = {
    id: 'art-1',
    name: 'Portishead',
    type: 'Group',
    country: 'GB',
    area: { name: 'United Kingdom' },
    'begin-area': { name: 'Bristol' },
    'life-span': { begin: '1991' },
    relations: [
        { type: 'official homepage', url: { resource: 'https://portishead.co.uk/' } },
        { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q483407' } },
        { type: 'discogs', url: { resource: 'https://www.discogs.com/artist/1234' } },
    ],
};

const searchResult = {
    recordings: [
        {
            id: 'rec-1',
            score: 100,
            title: 'Glory Box',
            'artist-credit': [{ name: 'Portishead', artist: { id: 'art-1', name: 'Portishead' } }],
            releases: [{ id: 'rel-1', title: 'Dummy' }],
        },
    ],
};

const recordingDetail = {
    id: 'rec-1',
    title: 'Glory Box',
    'first-release-date': '1994-08-22',
    'artist-credit': [{ name: 'Portishead', artist: { id: 'art-1', name: 'Portishead' } }],
    releases: [{ id: 'rel-1', title: 'Dummy', 'release-group': { 'primary-type': 'Album' } }],
};

let host: FakePluginHost;
let plugin: MusicBrainzPlugin;

const initialize = async (config: Record<string, unknown> = {}): Promise<void> => {
    host.seedConfig({ contactEmail: 'station@example.test', matchScore: 90, includeArtistFacts: true, ...config });
    await plugin.init(host);
};

/** The two requests every track enrichment makes: identify, then the recording document. */
const queueMatch = (): void => {
    host.queueResponse({ body: JSON.stringify(searchResult) });
    host.queueResponse({ body: JSON.stringify(recordingDetail) });
};

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new MusicBrainzPlugin();
});

describe('wikidataId', () => {
    it('reads the entity id out of a Wikidata URL', () => {
        expect(wikidataId('https://www.wikidata.org/wiki/Q483407')).toBe('Q483407');
        expect(wikidataId('https://www.wikidata.org/wiki/Q483407#identifiers')).toBe('Q483407');
        expect(wikidataId('https://en.wikipedia.org/wiki/Portishead_(band)')).toBeUndefined();
        expect(wikidataId(undefined)).toBeUndefined();
    });
});

describe('artistFacts', () => {
    it('says where a group formed and when', () => {
        expect(artistFacts(portishead)).toEqual(['Portishead formed in Bristol in 1991.']);
    });

    it('says a person was born rather than formed', () => {
        const person: MusicBrainzArtist = {
            name: 'Beth Gibbons',
            type: 'Person',
            'begin-area': { name: 'Exeter' },
            'life-span': { begin: '1965-01-04' },
        };
        expect(artistFacts(person)).toEqual(['Beth Gibbons was born in Exeter in 1965.']);
    });

    it('closes the span only when it actually ended', () => {
        const ended: MusicBrainzArtist = { name: 'The Smiths', type: 'Group', 'life-span': { begin: '1982', end: '1987', ended: true } };
        expect(artistFacts(ended)).toEqual(['The Smiths formed in 1982.', 'Active from 1982 to 1987.']);
    });

    it('drops the sentence rather than leaving a hole in it', () => {
        expect(artistFacts({ name: 'Unknown', type: 'Group' })).toEqual([]);
        expect(artistFacts({ type: 'Group', 'life-span': { begin: '1991' } })).toEqual([]);
    });

    it('passes on the disambiguation, which is the one MusicBrainz wrote for humans', () => {
        expect(artistFacts({ name: 'Nirvana', type: 'Group', disambiguation: '90s US grunge band' })).toEqual(['Nirvana: 90s US grunge band.']);
    });
});

describe('mapArtist', () => {
    it('maps the links, the wikidata id and the facts', () => {
        const enrichment = mapArtist(portishead);

        expect(enrichment.links).toEqual([
            { label: 'Official site', url: 'https://portishead.co.uk/' },
            { label: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q483407' },
            { label: 'Discogs', url: 'https://www.discogs.com/artist/1234' },
            { label: 'MusicBrainz artist', url: 'https://musicbrainz.org/artist/art-1' },
        ]);
        // The MusicBrainz id first: the host reads the first entry back as the
        // id this answer was fetched under, and hands it over next time.
        expect(enrichment.externalIds).toEqual([
            { source: 'musicbrainz-artist', id: 'art-1' },
            { source: 'wikidata', id: 'Q483407' },
        ]);
        expect(enrichment.facts).toHaveLength(1);
        expect(enrichment.name).toBe('Portishead');
    });

    it('has nothing to say about an artist it was never given', () => {
        expect(mapArtist(undefined)).toEqual({});
    });

    it('stays JSON-safe, because the payload crosses the plugin boundary', () => {
        const enrichment = mapArtist(portishead);
        expect(structuredClone(enrichment)).toEqual(enrichment);
    });
});

describe('enrichArtist', () => {
    it('looks the artist up directly when the host already has an mbid', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify(portishead) });

        const enrichment = await plugin.enrichArtist({ name: 'Portishead', mbid: 'art-1' });

        expect(host.calls).toHaveLength(1);
        expect(host.calls[0]!.url).toContain('artist/art-1?inc=url-rels');
        expect(enrichment.facts).toEqual(['Portishead formed in Bristol in 1991.']);
        expect(enrichment.links?.map(link => link.label)).toEqual(['Official site', 'Wikidata', 'Discogs', 'MusicBrainz artist']);
    });

    it('falls back to the id it answered under last time', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify(portishead) });

        await plugin.enrichArtist({ name: 'Portishead', providerRef: 'art-1' });

        expect(host.calls[0]!.url).toContain('artist/art-1');
    });

    it('searches by name the first time anything asks', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify({ artists: [{ id: 'art-1', name: 'Portishead' }] }) });
        host.queueResponse({ body: JSON.stringify(portishead) });

        const enrichment = await plugin.enrichArtist({ name: 'Portishead' });

        expect(host.calls[0]!.url).toContain('artist?query=');
        expect(host.calls[1]!.url).toContain('artist/art-1');
        expect(enrichment.name).toBe('Portishead');
    });

    it('says nothing when the search finds nobody, which the host remembers as a miss', async () => {
        await initialize();
        host.queueResponse({ body: JSON.stringify({ artists: [] }) });

        await expect(plugin.enrichArtist({ name: 'Nobody At All' })).resolves.toEqual({});
        expect(host.calls).toHaveLength(1);
    });

    it('does not ask at all when the operator turned artist background off', async () => {
        await initialize({ includeArtistFacts: false });

        await expect(plugin.enrichArtist({ name: 'Portishead', mbid: 'art-1' })).resolves.toEqual({});
        expect(host.calls).toHaveLength(0);
    });
});

describe('enrichTrack no longer pays for the artist', () => {
    it('makes no artist request of its own', async () => {
        await initialize();
        queueMatch();

        const enrichment = await plugin.enrichTrack(ref);

        expect(host.calls).toHaveLength(2);
        expect(host.calls.some(call => call.url.includes('artist/'))).toBe(false);
        expect(enrichment.facts).toBeUndefined();
        expect(enrichment.title).toBe('Glory Box');
    });
});
