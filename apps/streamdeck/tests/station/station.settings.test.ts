import { describe, expect, it } from 'vitest';

import { keyHint, parseAddress, redact, stationFrom } from '../../src/station/station.settings.js';

const KEY = 'da_4mR9xQ2vLp7TnB3kW8sYc1Hf6JdZ0aGeUoNiPrVtXyMbSw5qKj';

describe('parseAddress', () => {
    it('gives a bare host https', () => {
        expect(parseAddress('radio.example.com')).toEqual({ origin: 'https://radio.example.com' });
    });

    it('keeps plain http, which is what a station on a home network is', () => {
        expect(parseAddress('http://192.168.1.20:8080')).toEqual({ origin: 'http://192.168.1.20:8080' });
    });

    it('drops a trailing slash, a query and a fragment, and keeps a path', () => {
        expect(parseAddress('  https://example.com/radio/?tab=desk#top ')).toEqual({ origin: 'https://example.com/radio' });
    });

    it('takes a pasted API root back to the station’s address', () => {
        expect(parseAddress('https://radio.example.com/api/')).toEqual({ origin: 'https://radio.example.com' });
        expect(parseAddress('https://example.com/radio/api')).toEqual({ origin: 'https://example.com/radio' });
    });

    it('never carries a user and password into the address', () => {
        expect(parseAddress('https://me:secret@radio.example.com')).toEqual({ origin: 'https://radio.example.com' });
    });

    it('says why something is not an address', () => {
        expect(parseAddress(undefined)).toEqual({ problem: 'empty' });
        expect(parseAddress('   ')).toEqual({ problem: 'empty' });
        expect(parseAddress('https://')).toEqual({ problem: 'empty' });
        expect(parseAddress('ftp://radio.example.com')).toEqual({ problem: 'notHttp' });
        expect(parseAddress('radio example')).toEqual({ problem: 'malformed' });
    });
});

describe('stationFrom', () => {
    it('points the SDK under the edge’s API prefix', () => {
        expect(stationFrom({ address: 'radio.example.com', apiKey: ` ${KEY} ` })).toEqual({
            origin: 'https://radio.example.com',
            apiBase: 'https://radio.example.com/api',
            apiKey: KEY,
        });
    });

    it('has no station while either half is missing', () => {
        expect(stationFrom({})).toBeUndefined();
        expect(stationFrom({ address: 'radio.example.com' })).toBeUndefined();
        expect(stationFrom({ apiKey: KEY })).toBeUndefined();
        expect(stationFrom({ address: 'ftp://radio.example.com', apiKey: KEY })).toBeUndefined();
    });
});

describe('the key in a log line', () => {
    it('is the eight characters the console shows beside it, and never the rest', () => {
        expect(keyHint(KEY)).toBe('da_4mR9x…');
        const line = redact({ address: 'https://me:secret@radio.example.com/api', apiKey: KEY });
        expect(line).toBe('https://radio.example.com, key da_4mR9x…');
        expect(line).not.toContain(KEY.slice(0, 9));
        expect(line).not.toContain('secret');
    });

    it('says what is missing', () => {
        expect(redact({})).toBe('no address, no key');
        expect(redact({ address: 'radio example' })).toBe('an address that does not read, no key');
    });
});
