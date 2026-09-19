import { describe, expect, it } from 'vitest';

import {
    DEFAULT_ORIGIN,
    EMPTY_CATALOG,
    fetchNowPlaying,
    formatDate,
    languageName,
    listenUrl,
    loadCommunity,
    parseCatalog,
    parseStatus,
    readNowPlaying,
    timeAgo,
} from '../../src/community/catalog';

const CATALOG_URL = `${DEFAULT_ORIGIN}/catalog.json`;
const STATUS_URL = `${DEFAULT_ORIGIN}/status.json`;

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
        const data = await loadCommunity(
            DEFAULT_ORIGIN,
            answering({ [CATALOG_URL]: catalog, [STATUS_URL]: { format: 'deadair.status/1', stations: {} } }),
        );
        expect(data.catalog.stations).toHaveLength(1);
        expect(data.status).toEqual({});
    });

    it('comes back empty rather than throwing when the catalogue is unreachable', async () => {
        const refusing = (async () => {
            throw new TypeError('Failed to fetch');
        }) as typeof fetch;
        await expect(loadCommunity(DEFAULT_ORIGIN, refusing)).resolves.toEqual({ catalog: EMPTY_CATALOG, status: {}, origin: DEFAULT_ORIGIN });
    });

    it('still shows the catalogue when only the status is missing', async () => {
        const data = await loadCommunity(DEFAULT_ORIGIN, answering({ [CATALOG_URL]: catalog }));
        expect(data.catalog.plugins).toHaveLength(1);
        expect(data.status).toEqual({});
    });

    it('is empty for an answer that is not JSON', async () => {
        const html = (async () => new Response('<html>', { status: 200 })) as typeof fetch;
        await expect(loadCommunity(DEFAULT_ORIGIN, html)).resolves.toEqual({ catalog: EMPTY_CATALOG, status: {}, origin: DEFAULT_ORIGIN });
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

describe('listenUrl', () => {
    it('prefers the MP3 mount a station lists', () => {
        const status = {
            state: 'on-air' as const,
            checkedAt: 'T',
            mounts: [
                { format: 'hls' as const, path: '/live.m3u8' },
                { format: 'mp3' as const, path: '/radio.mp3' },
            ],
        };
        expect(listenUrl(station, status)).toBe('https://radio.example.org/radio.mp3');
    });

    it('takes another format before HLS when there is no MP3', () => {
        const status = {
            state: 'on-air' as const,
            checkedAt: 'T',
            mounts: [
                { format: 'hls' as const, path: '/live.m3u8' },
                { format: 'aac' as const, path: '/live.aac' },
            ],
        };
        expect(listenUrl(station, status)).toBe('https://radio.example.org/live.aac');
    });

    it('falls back to the default mount when the station has not answered', () => {
        expect(listenUrl(station, undefined)).toBe('https://radio.example.org/live.mp3');
    });
});

describe('timeAgo', () => {
    const now = Date.parse('2026-09-18T12:00:00.000Z');

    it('says how long ago, in the largest unit that fits', () => {
        expect(timeAgo('2026-09-18T11:56:00.000Z', now)).toBe('4 minutes ago');
        expect(timeAgo('2026-09-18T09:00:00.000Z', now)).toBe('3 hours ago');
        expect(timeAgo('2026-09-18T11:59:50.000Z', now)).toBe('just now');
    });

    it('is nothing for a moment it cannot read', () => {
        expect(timeAgo('whenever', now)).toBeUndefined();
    });
});

describe('languageName', () => {
    it('names a language tag the way a reader says it', () => {
        expect(languageName('en')).toBe('English');
        expect(languageName('en-GB')).toBe('British English');
    });

    it('leaves a tag it cannot read as it is', () => {
        expect(languageName('not a tag')).toBe('not a tag');
    });
});

/** What a station on the air answers today, trimmed. */
const onAir = {
    station: 'Deadair',
    onAir: true,
    listeners: 1,
    mounts: [
        { format: 'mp3', path: '/live.mp3', bitrateKbps: 320 },
        { format: 'mp3', path: 'https://elsewhere.example/live.mp3' },
    ],
    show: { name: 'Overnight', host: 'Chaz' },
    track: { kind: 'record', title: 'The Paradox', artist: 'Eradicator', album: 'The Paradox', startedAt: 1789737127346 },
};

describe('readNowPlaying', () => {
    it('reads what a card shows, keeps only mounts on the station itself, and nothing else', () => {
        expect(readNowPlaying(onAir, 'T')).toEqual({
            state: 'on-air',
            checkedAt: 'T',
            lastAnsweredAt: 'T',
            name: 'Deadair',
            mounts: [{ format: 'mp3', path: '/live.mp3' }],
            show: { name: 'Overnight', host: 'Chaz' },
            track: { kind: 'record', artist: 'Eradicator', title: 'The Paradox' },
        });
    });

    it('is off air when the station says so', () => {
        expect(readNowPlaying({ onAir: false }, 'T')?.state).toBe('off-air');
    });

    it('is nothing for an answer that is not a now-playing document', () => {
        expect(readNowPlaying({ hello: 'world' }, 'T')).toBeUndefined();
        expect(readNowPlaying(null, 'T')).toBeUndefined();
    });
});

describe('fetchNowPlaying', () => {
    const at = () => new Date('2026-09-18T12:00:00.000Z');

    it('asks the station itself, at its API', async () => {
        let asked = '';
        const station = (async (url: string) => {
            asked = url;
            return Response.json(onAir);
        }) as typeof fetch;

        const status = await fetchNowPlaying('https://radio.example.org', station, at);
        expect(asked).toBe('https://radio.example.org/api/nowplaying');
        expect(status?.checkedAt).toBe('2026-09-18T12:00:00.000Z');
    });

    it('is nothing when the browser will not hand the answer over', async () => {
        const blocked = (async () => {
            throw new TypeError('Failed to fetch');
        }) as typeof fetch;
        await expect(fetchNowPlaying('https://radio.example.org', blocked, at)).resolves.toBeUndefined();
    });
});
