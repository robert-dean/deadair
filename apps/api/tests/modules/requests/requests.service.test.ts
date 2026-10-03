// The routes a listener app and the console call. What matters is who the requester is (the
// account, never its email), and that a decision nobody can make answers the right status.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { RequestsService, UNNAMED_REQUESTER, toListenerRequest } from '../../../src/modules/requests/requests.service.js';
import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import type { RequestRow } from '../../../src/modules/requests/requests.repository.js';
import { settingsConfig } from '../../utils/settings.config.js';

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

interface World {
    /** What the library search answers. */
    library?: { trackId: string; title: string; artist: string }[];
    /** Whether the provider half would be asked, and what it answers. */
    reaches?: boolean;
    reached?: { source: { pluginId: string; externalId: string }; sourceName: string; title: string; artist: string }[];
    /** Provider ids the copy resolver can take in, and the track each becomes. */
    copies?: Record<string, string>;
    settings?: Record<string, string>;
}

function build(found?: RequestRow, world: World = {}) {
    const desk = { submit: vi.fn(async (..._args: unknown[]) => row()), grant: vi.fn(async () => undefined), decline: vi.fn(async () => undefined) };
    const requestable = new Set(['t-1', ...Object.values(world.copies ?? {})]);
    const repository = {
        findRequestable: vi.fn(async (id: string) =>
            requestable.has(id) ? { trackId: id, title: 'Teardrop', artist: 'Massive Attack' } : undefined,
        ),
        find: vi.fn(async () => found),
        list: vi.fn(async () => [row()]),
        search: vi.fn(async () => world.library ?? []),
    };
    const providers = { reaches: vi.fn(() => world.reaches ?? false), search: vi.fn(async () => world.reached ?? []) };
    const copies = { resolve: vi.fn(async (_pluginId: string, externalId: string) => world.copies?.[externalId]) };
    const { config } = settingsConfig(world.settings ?? {});
    const service = new RequestsService(
        user,
        desk as never,
        repository as never,
        { stationKey: 'main' } as never,
        providers as never,
        copies as never,
        config,
    );
    return { service, desk, repository, providers, copies };
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

    it('answers with the library alone when it held enough, without asking the providers', async () => {
        const library = [{ trackId: 't-1', title: 'Teardrop', artist: 'Massive Attack' }];
        const { service, providers } = build(undefined, { library, reaches: false });

        expect(await service.search({ q: 'teardrop' })).toEqual({ tracks: library });
        expect(providers.search).not.toHaveBeenCalled();
    });

    it("adds records a provider carries after the library's own when the library held few", async () => {
        const library = [{ trackId: 't-1', title: 'Teardrop', artist: 'Massive Attack' }];
        const reached = [
            { source: { pluginId: 'deadair.spotify', externalId: 'sp-1' }, sourceName: 'Spotify', title: 'Teardrop', artist: 'Elizabeth Fraser' },
        ];
        const { service, providers } = build(undefined, { library, reaches: true, reached });

        expect(await service.search({ q: 'teardrop', limit: 5 })).toEqual({ tracks: [...library, ...reached] });
        expect(providers.search).toHaveBeenCalledWith('teardrop', library, 4);
    });

    it("takes a provider's record in and asks for it like any other", async () => {
        const { service, desk, copies } = build(undefined, { copies: { 'sp-1': 't-new' } });

        await service.create({ source: { pluginId: 'deadair.spotify', externalId: 'sp-1' } });

        expect(copies.resolve).toHaveBeenCalledWith('deadair.spotify', 'sp-1', 'requests.create.getTrack');
        expect(desk.submit.mock.calls[0]?.[1]).toMatchObject({ trackId: 't-new' });
    });

    it('answers 400 for a request naming its record both ways, or neither', async () => {
        const { service } = build();

        await expect(service.create({ trackId: 't-1', source: { pluginId: 'deadair.spotify', externalId: 'sp-1' } })).rejects.toMatchObject({
            statusCode: 400,
        });
        await expect(service.create({})).rejects.toMatchObject({ statusCode: 400 });
    });

    it('answers 404 for a provider record nothing could take in', async () => {
        const { service, desk } = build(undefined, { copies: {} });

        await expect(service.create({ source: { pluginId: 'deadair.spotify', externalId: 'sp-gone' } })).rejects.toMatchObject({ statusCode: 404 });
        expect(desk.submit).not.toHaveBeenCalled();
    });

    it('takes nothing in while the station may not add records, with the setting as the STRING it really is', async () => {
        const { service, copies } = build(undefined, { copies: { 'sp-1': 't-new' }, settings: { 'rotation.discover': 'false' } });

        await expect(service.create({ source: { pluginId: 'deadair.spotify', externalId: 'sp-1' } })).rejects.toMatchObject({ statusCode: 404 });
        expect(copies.resolve).not.toHaveBeenCalled();
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
