import { z } from 'zod';
import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { PlaylistsService } from '#src/modules/playlists/playlists.service.js';
import { CatalogPlaylistPage, CatalogPlaylistTracks } from '../modules/playlists/types/playlists.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [playlists.ck](../../data/contracts/playlists/playlists.ck)
 */
export const PlaylistsRouter = ServerKitRouter();

/**
 * Fans out across every installed plugin that declares AND implements the `catalog` capability
 * from [playlists.ck](../../data/contracts/playlists/playlists.ck#L19)
 */
PlaylistsRouter.get('/playlists', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(PlaylistsService);
    const result: CatalogPlaylistPage = await service.listPlaylists();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * One playlist's tracks from one plugin
 * from [playlists.ck](../../data/contracts/playlists/playlists.ck#L40)
 */
PlaylistsRouter.get('/playlists/:pluginId/:playlistId/tracks', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { pluginId, playlistId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            pluginId: z.string().min(1).max(200),
            playlistId: z.string().min(1).max(400),
        }),
    );

    const service = ctx.container.get(PlaylistsService);
    const result: CatalogPlaylistTracks = await service.getPlaylistTracks(pluginId, playlistId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Hides one playlist from this station: the listing marks it hidden, the pickers stop offering it and the library sync stops reading it. Hiding one already hidden changes nothing
 * from [playlists.ck](../../data/contracts/playlists/playlists.ck#L60)
 */
PlaylistsRouter.put('/playlists/:pluginId/:playlistId/hidden', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { pluginId, playlistId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            pluginId: z.string().min(1).max(200),
            playlistId: z.string().min(1).max(400),
        }),
    );

    const service = ctx.container.get(PlaylistsService);
    await service.hidePlaylist(pluginId, playlistId);

    ctx.status = 204;
});

/**
 * Shows a hidden playlist again. Showing one that is not hidden changes nothing
 * from [playlists.ck](../../data/contracts/playlists/playlists.ck#L64)
 */
PlaylistsRouter.delete('/playlists/:pluginId/:playlistId/hidden', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { pluginId, playlistId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            pluginId: z.string().min(1).max(200),
            playlistId: z.string().min(1).max(400),
        }),
    );

    const service = ctx.container.get(PlaylistsService);
    await service.showPlaylist(pluginId, playlistId);

    ctx.status = 204;
});

/**
 * Reads every playlist on every music source again, in the background, rather than waiting for the next scheduled read. New records reach the library; records gone from every playlist are retired
 * from [playlists.ck](../../data/contracts/playlists/playlists.ck#L71)
 */
PlaylistsRouter.post('/playlists/refresh', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(PlaylistsService);
    await service.requestRefresh();

    ctx.status = 204;
});

/**
 * Reads one playlist again, in the background. New records reach the library; a record taken out of it stays until the next full read judges it
 * from [playlists.ck](../../data/contracts/playlists/playlists.ck#L82)
 */
PlaylistsRouter.post('/playlists/:pluginId/:playlistId/refresh', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { pluginId, playlistId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            pluginId: z.string().min(1).max(200),
            playlistId: z.string().min(1).max(400),
        }),
    );

    const service = ctx.container.get(PlaylistsService);
    await service.requestPlaylistRefresh(pluginId, playlistId);

    ctx.status = 204;
});
