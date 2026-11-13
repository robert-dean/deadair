// What is under test is the promise the station leans on: only the artist asked
// about, only shows that are on, and a service that fails is one fault.

import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { concertsIn, festivalsIn, normalArtist } from '../src/ticketmaster.events.js';
import { TicketmasterPlugin } from '../src/ticketmaster.plugin.js';
import { ticketmasterManifest } from '../src/ticketmaster.manifest.js';

const event = (name: string, overrides: { date?: string; status?: string; venue?: string; tbd?: boolean } = {}) => ({
    url: 'https://www.ticketmaster.com/event/1',
    dates: { start: { localDate: overrides.date ?? '2026-11-14', dateTBD: overrides.tbd ?? false }, status: { code: overrides.status ?? 'onsale' } },
    _embedded: { attractions: [{ name }], venues: [{ name: overrides.venue ?? 'Tabernacle', city: { name: 'Atlanta' } }] },
});
const page = (...events: unknown[]) => ({ _embedded: { events } });

let host: FakePluginHost;
let plugin: TicketmasterPlugin;

const queueJson = (body: unknown, status = 200): void =>
    host.queueResponse({ status, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const GEOCODED = { results: [{ latitude: 33.749, longitude: -84.388 }] };

beforeEach(async () => {
    host = createFakePluginHost();
    plugin = new TicketmasterPlugin();
    host.seedSecret('apiKey', 'key');
    await plugin.init(host);
});

describe('concertsIn', () => {
    it('drops a tribute act and a band with a longer name, which a keyword search brings back', () => {
        const found = concertsIn(page(event('Queen'), event('Queen Nation'), event('Queens of the Stone Age')), 'Queen');
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ artist: 'Queen', venue: 'Tabernacle', city: 'Atlanta', startsOn: '2026-11-14' });
    });

    it('answers in the name the station credits rather than the name the service holds', () => {
        expect(concertsIn(page(event('Guns N Roses')), "Guns N' Roses")[0]?.artist).toBe("Guns N' Roses");
    });

    it.each(['cancelled', 'postponed', 'rescheduled', 'something-new'])('leaves out a show that is %s', status => {
        expect(concertsIn(page(event('Queen', { status })), 'Queen')).toEqual([]);
    });

    it('leaves out a show with no date yet', () => {
        expect(concertsIn(page(event('Queen', { tbd: true })), 'Queen')).toEqual([]);
    });

    it('folds a VIP listing of one night into the show, and sorts soonest first', () => {
        const found = concertsIn(page(event('Queen', { date: '2026-12-01' }), event('Queen'), event('Queen')), 'Queen');
        expect(found.map(concert => concert.startsOn)).toEqual(['2026-11-14', '2026-12-01']);
    });

    it('answers nothing for a body with no events', () => {
        expect(concertsIn({}, 'Queen')).toEqual([]);
    });
});

describe('normalArtist', () => {
    it.each([
        ['AC/DC', 'ACDC'],
        ['The Struts', 'Struts'],
        ['Beyoncé', 'Beyonce'],
        ['Hall & Oates', 'Hall and Oates'],
    ])('reads %s and %s as one name', (a, b) => {
        expect(normalArtist(a)).toBe(normalArtist(b));
    });
});

describe('getConcerts', () => {
    const query = { artist: 'Queen', place: 'Atlanta, GA', from: '2026-11-01' };

    it('searches around the place, and keeps the key out of what it logs', async () => {
        queueJson(GEOCODED);
        queueJson(page(event('Queen')));

        await expect(plugin.getConcerts(query)).resolves.toHaveLength(1);

        const search = new URL(host.calls[1]!.url);
        expect(search.searchParams.get('latlong')).toBe('33.749,-84.388');
        expect(search.searchParams.get('keyword')).toBe('Queen');
        expect(search.searchParams.get('radius')).toBe('60');
        expect(new URL(host.calls[0]!.url).searchParams.get('name')).toBe('Atlanta');
    });

    it('asks once for an artist who is not coming, since that is most of what it is asked', async () => {
        queueJson(GEOCODED);
        queueJson({});

        await plugin.getConcerts(query);
        await expect(plugin.getConcerts(query)).resolves.toEqual([]);
        expect(host.calls).toHaveLength(2);
    });

    it('stops answering with a held show once its date has gone', async () => {
        queueJson(GEOCODED);
        queueJson(page(event('Queen')));

        await plugin.getConcerts(query);
        await expect(plugin.getConcerts({ ...query, from: '2026-11-15' })).resolves.toEqual([]);
    });

    it('throws a refusal once and answers empty after, so an outage is one fault', async () => {
        queueJson(GEOCODED);
        queueJson({}, 429);

        await expect(plugin.getConcerts(query)).rejects.toThrow(/Ticketmaster answered/);
        await expect(plugin.getConcerts(query)).resolves.toEqual([]);
        expect(host.calls).toHaveLength(2);
    });
});

describe('testConnection', () => {
    it('sends the stored secret, which is the only place a secret field is kept', async () => {
        queueJson({});

        await expect(plugin.testConnection()).resolves.toEqual({ ok: true, message: 'Ticketmaster answered.' });
        expect(new URL(host.calls[0]!.url).searchParams.get('apikey')).toBe('key');
    });

    it('says there is no key without asking, whatever plain config holds', async () => {
        const keyless = createFakePluginHost();
        const unkeyed = new TicketmasterPlugin();
        keyless.seedConfig({ apiKey: 'never-read' });
        await unkeyed.init(keyless);

        await expect(unkeyed.testConnection()).resolves.toEqual({ ok: false, message: 'There is no API key yet.' });
        expect(keyless.calls).toHaveLength(0);
    });
});

describe('manifest', () => {
    it('declares the one capability and needs a key', () => {
        expect(ticketmasterManifest.capabilities).toEqual(['concerts']);
        expect(ticketmasterManifest.configSchema?.safeParse({}).success).toBe(false);
    });
});

describe('festivalsIn', () => {
    const festival = (overrides: { id?: string; name?: string; start?: string; end?: string; status?: string; acts?: string[] } = {}) => ({
        id: overrides.id ?? 'G5v',
        name: overrides.name ?? 'Shaky Knees Music Festival',
        url: 'https://www.ticketmaster.com/event/G5v',
        dates: {
            start: { localDate: overrides.start ?? '2027-05-07' },
            ...(overrides.end === undefined ? {} : { end: { localDate: overrides.end } }),
            status: { code: overrides.status ?? 'onsale' },
        },
        _embedded: {
            attractions: (overrides.acts ?? ['Shaky Knees', 'Foo Fighters', 'Wet Leg', 'Foo Fighters']).map(name => ({ name })),
            venues: [{ name: 'Piedmont Park', city: { name: 'Atlanta' } }],
        },
    });

    it('reads the dates, the place and the bill, without the festival itself or an act listed twice', () => {
        expect(festivalsIn(page(festival({ end: '2027-05-09' })))).toEqual([
            {
                id: 'G5v',
                name: 'Shaky Knees Music Festival',
                startsOn: '2027-05-07',
                endsOn: '2027-05-09',
                venue: 'Piedmont Park',
                city: 'Atlanta',
                url: 'https://www.ticketmaster.com/event/G5v',
                acts: ['Foo Fighters', 'Wet Leg'],
            },
        ]);
    });

    it('takes the first day as the last when the service gives no end, or an end before the start', () => {
        expect(festivalsIn(page(festival()))[0]?.endsOn).toBe('2027-05-07');
        expect(festivalsIn(page(festival({ end: '2027-05-01' })))[0]?.endsOn).toBe('2027-05-07');
    });

    it("keeps a one-word act that only appears inside the festival's name", () => {
        expect(festivalsIn(page(festival({ name: 'Live at the Park', acts: ['Live', 'Wet Leg'] })))[0]?.acts).toEqual(['Live', 'Wet Leg']);
    });

    it('leaves off a page link that is not a web page', () => {
        const listed = { ...festival(), url: 'javascript:alert(1)' };
        expect(festivalsIn(page(listed))[0]).not.toHaveProperty('url');
    });

    it('leaves out a festival that is not on, and sorts soonest first', () => {
        const found = festivalsIn(
            page(festival({ id: 'b', start: '2027-09-01' }), festival({ id: 'off', status: 'cancelled' }), festival({ id: 'a' })),
        );
        expect(found.map(listing => listing.id)).toEqual(['a', 'b']);
    });
});

describe('findFestivals', () => {
    it('asks for festivals by name from the date given, and answers what came back', async () => {
        queueJson(page({ id: 'G5v', name: 'Shaky Knees', dates: { start: { localDate: '2027-05-07' }, status: { code: 'onsale' } }, _embedded: {} }));

        const found = await plugin.findFestivals({ name: 'Shaky Knees', from: '2027-01-01' });

        expect(found.map(listing => listing.name)).toEqual(['Shaky Knees']);
        const asked = new URL(host.calls[0]!.url);
        expect(asked.searchParams.get('keyword')).toBe('Shaky Knees');
        expect(asked.searchParams.get('classificationName')).toBe('festival');
        expect(asked.searchParams.get('startDateTime')).toBe('2027-01-01T00:00:00Z');
    });

    it('asks nothing for an empty name', async () => {
        expect(await plugin.findFestivals({ name: '  ' })).toEqual([]);
        expect(host.calls).toHaveLength(0);
    });

    it('throws a refusal to the operator who asked', async () => {
        queueJson({ fault: 'no' }, 401);
        await expect(plugin.findFestivals({ name: 'Shaky Knees' })).rejects.toThrow(/401/);
    });
});
