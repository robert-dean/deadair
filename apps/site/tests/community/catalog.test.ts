import { describe, expect, it } from 'vitest';

import { CATALOG_URL, EMPTY_CATALOG, formatDate, loadCommunity, parseCatalog, parseStatus, STATUS_URL } from '../../src/community/catalog';

const listing = { submittedBy: 'someone', dateAdded: '2026-09-18' };

const station = { slug: 'night-shift', name: 'Night Shift', url: 'https://radio.example.org', description: 'All night.', listing };
const plugin = {
    slug: 'bandcamp',
    id: 'org.example.bandcamp',
    name: 'Bandcamp',
    description: 'Records from Bandcamp.',
    author: 'Someone',
    repository: 'https://github.com/someone/bandcamp',
    license: 'MIT',
    version: '1.2.0',
    apiVersion: '^1.0.0',
    capabilities: ['catalog'],
    hosts: ['bandcamp.com'],
    listing,
};
const app = {
    slug: 'wall-panel',
    name: 'Wall panel',
    kind: 'remote',
    platforms: ['web'],
    description: 'x',
    author: 'x',
    url: 'https://example.org',
    listing,
};
const persona = {
    slug: 'the-archivist',
    summary: 'Liner notes.',
    author: 'Someone',
    download: 'personas/the-archivist.json',
    persona: { key: 'the-archivist', label: 'The Archivist', style: 'a librarian', stories: [] },
    listing,
};

const catalog = {
    format: 'deadair.catalog/1',
    builtAt: '2026-09-18T00:00:00.000Z',
    stations: [station],
    plugins: [plugin],
    apps: [app],
    personas: [persona],
};

describe('parseCatalog', () => {
    it('reads every kind of entry', () => {
        expect(parseCatalog(catalog)).toEqual({ stations: [station], plugins: [plugin], apps: [app], personas: [persona] });
    });

    it('is empty for anything that is not a catalogue it knows', () => {
        expect(parseCatalog(undefined)).toBe(EMPTY_CATALOG);
        expect(parseCatalog('<html>')).toBe(EMPTY_CATALOG);
        expect(parseCatalog({ ...catalog, format: 'deadair.catalog/2' })).toBe(EMPTY_CATALOG);
    });

    it('drops one malformed entry and keeps the rest', () => {
        const { stations, plugins, personas } = parseCatalog({
            ...catalog,
            stations: [station, { slug: 'broken', name: 'No address', listing }],
            plugins: [plugin, { ...plugin, slug: 'no-hosts', hosts: 'bandcamp.com' }],
            personas: [persona, { ...persona, slug: 'no-character', persona: undefined }],
        });
        expect(stations.map(entry => entry.slug)).toEqual(['night-shift']);
        expect(plugins.map(entry => entry.slug)).toEqual(['bandcamp']);
        expect(personas.map(entry => entry.slug)).toEqual(['the-archivist']);
    });

    it('treats a missing list as an empty one', () => {
        expect(parseCatalog({ format: 'deadair.catalog/1' })).toEqual(EMPTY_CATALOG);
    });
});

describe('parseStatus', () => {
    it('reads each station’s status, and drops one it does not recognise', () => {
        const status = parseStatus({
            format: 'deadair.status/1',
            checkedAt: 'T',
            stations: {
                'night-shift': { state: 'on-air', checkedAt: 'T', track: { kind: 'record', artist: 'A', title: 'B' } },
                weird: { state: 'sleeping', checkedAt: 'T' },
            },
        });
        expect(Object.keys(status)).toEqual(['night-shift']);
        expect(status['night-shift']?.track?.title).toBe('B');
    });

    it('is empty for anything that is not a status document', () => {
        expect(parseStatus(null)).toEqual({});
        expect(parseStatus({ format: 'deadair.status/1', stations: [] })).toEqual({});
    });
});

describe('loadCommunity', () => {
    const answering = (bodies: Record<string, unknown>) =>
        (async (url: string) => {
            if (!(url in bodies)) return new Response('not found', { status: 404 });
            return Response.json(bodies[url]);
        }) as typeof fetch;

    it('reads the catalogue and the status together', async () => {
        const data = await loadCommunity(answering({ [CATALOG_URL]: catalog, [STATUS_URL]: { format: 'deadair.status/1', stations: {} } }));
        expect(data.catalog.stations).toHaveLength(1);
        expect(data.status).toEqual({});
    });

    it('comes back empty rather than throwing when the catalogue is unreachable', async () => {
        const refusing = (async () => {
            throw new TypeError('Failed to fetch');
        }) as typeof fetch;
        await expect(loadCommunity(refusing)).resolves.toEqual({ catalog: EMPTY_CATALOG, status: {} });
    });

    it('still shows the catalogue when only the status is missing', async () => {
        const data = await loadCommunity(answering({ [CATALOG_URL]: catalog }));
        expect(data.catalog.plugins).toHaveLength(1);
        expect(data.status).toEqual({});
    });

    it('is empty for an answer that is not JSON', async () => {
        const html = (async () => new Response('<html>', { status: 200 })) as typeof fetch;
        await expect(loadCommunity(html)).resolves.toEqual({ catalog: EMPTY_CATALOG, status: {} });
    });
});

describe('formatDate', () => {
    it('prints a listing date the way a card does, whatever the reader’s time zone', () => {
        // `Sep` or `Sept`, depending on the ICU data the runtime ships.
        expect(formatDate('2026-09-18')).toMatch(/^18 Sept? 2026$/);
    });

    it('leaves a date it cannot read as it is', () => {
        expect(formatDate('soon')).toBe('soon');
    });
});
