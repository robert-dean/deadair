// The documents here are what libretime/icecast:2.5.0 answered on 2026-10-28, captured
// from a container with two sources up and listeners connected through a trusted
// proxy, and trimmed of nothing. The docs describe only the XML form of this command,
// so these replies are the specification.

import { describe, expect, it } from 'vitest';

import { connectionsFromListClients } from '../../../src/modules/stream/icecast.listclients.parse.js';

const HEADER = { name: 'icestats', ns: 'http://icecast.org/specs/legacystats-0.0.1' };

const history = (mount: string) => [
    [
        { type: 'element', name: 'history', ns: null },
        {},
        [[{ type: 'element', name: 'mount', ns: null }, {}, [[{ type: 'text', text: mount, ns: null }]]]],
    ],
];

/** Two listeners on `/radio.mp3`, one of them over IPv6 with an agent that needed escaping in the XML form. */
const TWO = [
    HEADER,
    {
        modules: {},
        source: {
            '/radio.mp3': {
                listeners: 2,
                listener: [
                    {
                        id: '2',
                        ip: '203.0.113.7',
                        useragent: 'VLC/3.0.21 LibVLC/3.0.21',
                        host: 'localhost',
                        connected: 3,
                        role: 'anonymous',
                        acl: 'anonymous',
                        tls: 'false',
                        protocol: 'http',
                        listensocketeffective: 'edge',
                        'unhandled-child': history('/radio.mp3'),
                    },
                    {
                        id: '3',
                        ip: '2001:db8::5',
                        useragent: 'Mozilla/5.0 (X11; Linux) <odd> & "quoted"',
                        host: 'localhost',
                        connected: 3,
                        role: 'anonymous',
                        acl: 'anonymous',
                        tls: 'false',
                        protocol: 'http',
                        listensocketeffective: 'edge',
                        'unhandled-child': history('/radio.mp3'),
                    },
                ],
                geoip: { country: [{ listeners: 2, tls: 0, ipv6: 1 }], location: [] },
            },
        },
    },
];

/** One listener, which is still an array: the shape that would break a parser expecting a bare object. */
const ONE = [
    HEADER,
    {
        modules: {},
        source: {
            '/live.mp3': {
                listeners: 1,
                listener: [
                    {
                        id: '1',
                        ip: '127.0.0.1',
                        useragent: 'only-one',
                        host: 'localhost',
                        connected: 2,
                        role: 'anonymous',
                        acl: 'anonymous',
                        tls: 'false',
                        protocol: 'http',
                        'unhandled-child': history('/live.mp3'),
                    },
                ],
                geoip: { country: [{ listeners: 1, tls: 0, ipv6: 0 }], location: [] },
            },
        },
    },
];

/** A mount with a source and nobody on it: no `listener` key at all. */
const EMPTY = [HEADER, { modules: {}, source: { '/radio.opus': { listeners: 0, geoip: { country: [], location: [] } } } }];

describe('connectionsFromListClients', () => {
    it('reads every listener on the mount', () => {
        expect(connectionsFromListClients(TWO, '/radio.mp3')).toEqual([
            { id: '2', address: '203.0.113.7', agent: 'VLC/3.0.21 LibVLC/3.0.21', connectedMs: 3000 },
            { id: '3', address: '2001:db8::5', agent: 'Mozilla/5.0 (X11; Linux) <odd> & "quoted"', connectedMs: 3000 },
        ]);
    });

    it('reads a single listener, which Icecast still sends as an array', () => {
        expect(connectionsFromListClients(ONE, '/live.mp3')).toEqual([{ id: '1', address: '127.0.0.1', agent: 'only-one', connectedMs: 2000 }]);
    });

    it('is an empty room when the mount has nobody on it', () => {
        expect(connectionsFromListClients(EMPTY, '/radio.opus')).toEqual([]);
    });

    it('matches a mount written without its leading slash', () => {
        expect(connectionsFromListClients(ONE, 'live.mp3')).toHaveLength(1);
    });

    it('cannot tell when the document is about another mount', () => {
        // Not `[]`: the question asked was not answered, and that is not an empty room.
        expect(connectionsFromListClients(TWO, '/live.mp3')).toBeUndefined();
    });

    it.each([
        ['an object', { icestats: {} }],
        ['an array with no source in it', [HEADER, { modules: {} }]],
        ['a listener that is not a list', [HEADER, { source: { '/live.mp3': { listener: { id: '1', ip: '127.0.0.1' } } } }]],
        ['text', 'not found'],
        ['nothing', undefined],
    ])('cannot tell from %s', (_name, body) => {
        expect(connectionsFromListClients(body, '/live.mp3')).toBeUndefined();
    });

    it('drops a row with no address and keeps the rest', () => {
        const body = [HEADER, { source: { '/live.mp3': { listener: [{ id: '1' }, { id: '2', ip: '198.51.100.4', connected: 10 }] } } }];

        expect(connectionsFromListClients(body, '/live.mp3')).toEqual([{ id: '2', address: '198.51.100.4', connectedMs: 10_000 }]);
    });

    it('leaves the agent out when the player sent none', () => {
        const body = [HEADER, { source: { '/live.mp3': { listener: [{ id: '1', ip: '198.51.100.4', useragent: '', connected: 1 }] } } }];

        expect(connectionsFromListClients(body, '/live.mp3')).toEqual([{ id: '1', address: '198.51.100.4', connectedMs: 1000 }]);
    });

    it('reads a numeric id and a missing duration without inventing either', () => {
        const body = [HEADER, { source: { '/live.mp3': { listener: [{ id: 7, ip: '198.51.100.4' }] } } }];

        expect(connectionsFromListClients(body, '/live.mp3')).toEqual([{ id: '7', address: '198.51.100.4', connectedMs: 0 }]);
    });
});
