// The guest page holds itself to the listener apps' rules, so a guest and a listener with the app ask
// the station the same way. These are the decisions, apart from any drawing.

import { describe, expect, it } from 'vitest';
import type { ListenerRequest } from '@deadair/sdk';
import { DateTime } from 'luxon';

import { EMPTY_FORM, isOpen, outcomeOf, requestBody, rowKey, searchTerm } from '../../src/party/party.rules';

const request = (overrides: Partial<ListenerRequest>): ListenerRequest => ({
    id: 'r-1',
    status: 'queued',
    title: 'Holy Diver',
    artist: 'Dio',
    requesterName: 'Sam',
    source: 'app',
    createdAt: DateTime.utc(),
    ...overrides,
});

describe('searchTerm', () => {
    it('waits for two letters, and asks for what was typed without the spaces round it', () => {
        expect(searchTerm(' h ')).toBeUndefined();
        expect(searchTerm('  ho ')).toBe('ho');
    });
});

describe('requestBody', () => {
    it('names a record the station holds by its track, and leaves out every blank field', () => {
        expect(requestBody({ trackId: 't-1', title: 'x', artist: 'y' }, { name: ' ', dedicateTo: '', message: '  ' })).toEqual({ trackId: 't-1' });
    });

    it('names a record only a provider carries by its source', () => {
        const source = { pluginId: 'deadair.spotify', externalId: 'abc' };
        expect(requestBody({ source, title: 'x', artist: 'y' }, EMPTY_FORM)).toEqual({ source });
    });

    it('trims each field and holds it to what the station takes', () => {
        const body = requestBody(
            { trackId: 't-1', title: 'x', artist: 'y' },
            { name: ` ${'n'.repeat(80)} `, dedicateTo: 'Marcus', message: 'm'.repeat(250) },
        );
        expect(body.name).toHaveLength(60);
        expect(body.dedicateTo).toBe('Marcus');
        expect(body.message).toHaveLength(200);
    });
});

describe('outcomeOf', () => {
    it('reads the status, never the code, since a refusal is a 201 too', () => {
        expect(outcomeOf(request({ status: 'waiting' }))).toEqual({ kind: 'waiting', title: 'Holy Diver' });
        expect(outcomeOf(request({ status: 'pending' }))).toEqual({ kind: 'onItsWay', title: 'Holy Diver' });
        expect(outcomeOf(request({ status: 'declined', reason: 'You already have a request in. One at a time.' }))).toEqual({
            kind: 'refused',
            reason: 'You already have a request in. One at a time.',
        });
        expect(outcomeOf(request({ status: 'expired' }))).toEqual({ kind: 'refused' });
    });
});

describe('the rest', () => {
    it('keys a row by its track, or by its source when it has none', () => {
        expect(rowKey({ trackId: 't-1', title: 'x', artist: 'y' })).toBe('t-1');
        expect(rowKey({ source: { pluginId: 'p', externalId: 'e' }, title: 'x', artist: 'y' })).toBe('p:e');
    });

    it('counts waiting, pending and queued as still to come', () => {
        expect(['waiting', 'pending', 'queued', 'aired', 'declined', 'expired'].map(s => isOpen(s as never))).toEqual([
            true,
            true,
            true,
            false,
            false,
            false,
        ]);
    });
});
