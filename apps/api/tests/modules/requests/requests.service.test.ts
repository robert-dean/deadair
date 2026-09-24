// The routes a listener app and the console call. What matters is who the requester is (the
// account, never its email), and that a decision nobody can make answers the right status.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { RequestsService, UNNAMED_REQUESTER, toListenerRequest } from '../../../src/modules/requests/requests.service.js';
import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import type { RequestRow } from '../../../src/modules/requests/requests.repository.js';

const user = new AuthorizationContext({ kind: 'user', sessionToken: 's', actorId: 'a-1', platformRoles: new Set(['listener']), factors: [] });

const row = (overrides: Partial<RequestRow> = {}): RequestRow => ({
    id: 'r-1',
    requesterKey: 'user:a-1',
    requesterName: 'Robin',
    trackId: 't-1',
    title: 'Teardrop',
    artist: 'Massive Attack',
    status: 'queued',
    createdAt: DateTime.fromISO('2026-09-24T12:00:00Z'),
    ...overrides,
});

function build(found?: RequestRow) {
    const desk = { submit: vi.fn(async () => row()), grant: vi.fn(async () => undefined), decline: vi.fn(async () => undefined) };
    const repository = {
        findRequestable: vi.fn(async (id: string) => (id === 't-1' ? { trackId: 't-1', title: 'Teardrop', artist: 'Massive Attack' } : undefined)),
        find: vi.fn(async () => found),
        list: vi.fn(async () => [row()]),
    };
    return { service: new RequestsService(user, desk as never, repository as never, { stationKey: 'main' } as never), desk, repository };
}

describe('RequestsService', () => {
    it('asks as the signed-in account, called what they said', async () => {
        const { service, desk } = build();

        await service.create({ trackId: 't-1', name: '  Robin ' });

        expect(desk.submit).toHaveBeenCalledWith(
            { key: 'user:a-1', name: 'Robin', actorId: 'a-1' },
            expect.objectContaining({ trackId: 't-1' }),
            undefined,
        );
    });

    it('calls somebody who gave no name "a listener", never anything from their account', async () => {
        const { service, desk } = build();

        await service.create({ trackId: 't-1' });

        expect(desk.submit).toHaveBeenCalledWith(expect.objectContaining({ name: UNNAMED_REQUESTER }), expect.anything(), undefined);
    });

    it('answers 404 for a record the station could not play', async () => {
        const { service } = build();

        await expect(service.create({ trackId: 't-unknown' })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('lists only the caller’s own requests as theirs', async () => {
        const { service, repository } = build();

        await service.mine();

        expect(repository.list).toHaveBeenCalledWith('main', { requesterKey: 'user:a-1', limit: 20 });
    });

    it('answers 409 for a request already decided, and 404 for none', async () => {
        await expect(build(row({ status: 'aired' })).service.grant('r-1')).rejects.toMatchObject({ statusCode: 409 });
        await expect(build(undefined).service.decline('r-1', {})).rejects.toMatchObject({ statusCode: 404 });
    });

    it('says whether a request came from an app or a chat', () => {
        expect(toListenerRequest(row()).source).toBe('app');
        expect(toListenerRequest(row({ requesterKey: 'chat:deadair.telegram:7' })).source).toBe('chat');
    });

    it('passes a dedication on, tidied', async () => {
        const { service, desk } = build();

        await service.create({ trackId: 't-1', dedicateTo: ' Danielle ', message: 'happy\nbirthday' });

        expect(desk.submit).toHaveBeenCalledWith(expect.anything(), expect.anything(), { to: 'Danielle', message: 'happy birthday' });
    });
});
