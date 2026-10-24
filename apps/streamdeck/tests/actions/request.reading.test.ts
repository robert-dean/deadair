import { describe, expect, it } from 'vitest';

import { recordFrom, requestSettingsFrom, requestView, rowLines, samePick } from '../../src/actions/request.reading.js';

const ORIGIN = 'https://radio.example.com';
const held = { trackId: 'b2c4d6e8-0000-4000-8000-000000000001', title: 'Pale Blue Eyes', artist: 'The Velvet Underground' };
const carried = { source: { pluginId: 'ytmusic', externalId: 'yt-1' }, title: 'Heroin', artist: 'The Velvet Underground' };

describe('recordFrom', () => {
    it('keeps a held record by its track id and drops what a press does not send', () => {
        expect(recordFrom({ ...held, album: 'The Velvet Underground', year: 1969 })).toEqual(held);
    });

    it('keeps a provider’s record by its source', () => {
        expect(recordFrom({ ...carried, sourceName: 'YouTube Music' })).toEqual(carried);
    });

    it('saves a row with neither as nothing', () => {
        expect(recordFrom({ title: 'x', artist: 'y' })).toBeUndefined();
    });
});

describe('requestSettingsFrom', () => {
    it('reads what the panel saved', () => {
        expect(requestSettingsFrom({ record: held, station: ORIGIN })).toEqual({ record: held, station: ORIGIN });
        expect(requestSettingsFrom({ record: carried, station: ORIGIN })).toEqual({ record: carried, station: ORIGIN });
    });

    it('drops a record a hand-edited profile has broken, and keeps the station', () => {
        expect(requestSettingsFrom({ record: { title: 'x' }, station: ORIGIN })).toEqual({ station: ORIGIN });
        expect(requestSettingsFrom({ record: { title: 'x', artist: 'y' } })).toEqual({});
        expect(requestSettingsFrom(undefined)).toEqual({});
    });
});

describe('requestView', () => {
    it('asks for the record by its track id', () => {
        expect(requestView({ record: held, station: ORIGIN }, ORIGIN)).toEqual({ dim: false, press: { trackId: held.trackId } });
    });

    it('asks for a provider’s record by its source', () => {
        expect(requestView({ record: carried, station: ORIGIN }, ORIGIN)).toEqual({ dim: false, press: { source: carried.source } });
    });

    it('opens the console’s request dialog for a key with no record, under a path the station is mounted at', () => {
        expect(requestView({}, ORIGIN)).toEqual({ dim: false, open: `${ORIGIN}/?request=1` });
        expect(requestView({}, 'https://example.com/radio')).toEqual({ dim: false, open: 'https://example.com/radio/?request=1' });
    });

    it('refuses a record found on another station, because its id names another record there', () => {
        expect(requestView({ record: held, station: 'https://elsewhere.example.com' }, ORIGIN)).toEqual({
            dim: true,
            refusal: "This Request key's record, “Pale Blue Eyes”, was picked on another station. Open its settings and pick it again.",
        });
    });

    it('refuses everything with no station set up', () => {
        expect(requestView({ record: held, station: ORIGIN }, undefined)).toMatchObject({
            dim: true,
            refusal: expect.stringMatching(/No station yet/),
        });
    });
});

describe('rowLines', () => {
    it('tells two recordings of one title apart by album and year', () => {
        expect(rowLines({ ...held, album: 'Loaded', year: 1970 })).toEqual({ title: 'Pale Blue Eyes', by: 'The Velvet Underground · Loaded · 1970' });
    });

    it('names the provider of a record the station would take in', () => {
        expect(rowLines({ ...carried, sourceName: 'YouTube Music' }).by).toBe('The Velvet Underground · from YouTube Music');
    });
});

describe('samePick', () => {
    it('matches a record found to the one saved, by track id or by source', () => {
        expect(samePick(held, held)).toBe(true);
        expect(samePick(carried, carried)).toBe(true);
        expect(samePick(carried, held)).toBe(false);
        expect(samePick(held, carried)).toBe(false);
        expect(samePick(held, undefined)).toBe(false);
    });
});
