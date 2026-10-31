// What is under test is the promise the station leans on: only the artist asked
// about, only shows that are on, and a service that fails is one fault.

import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { concertsIn, normalArtist } from '../src/ticketmaster.events.js';
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
    host.seedConfig({ apiKey: 'key' });
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

describe('manifest', () => {
    it('declares the one capability and needs a key', () => {
        expect(ticketmasterManifest.capabilities).toEqual(['concerts']);
        expect(ticketmasterManifest.configSchema?.safeParse({}).success).toBe(false);
    });
});
