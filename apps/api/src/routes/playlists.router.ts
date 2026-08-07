import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PlaylistsService } from '#src/modules/playlists/playlists.service.js';
import { CatalogPlaylistPage, CatalogPlaylistTracks } from '../modules/playlists/types/playlists.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [playlists.ck](file://./../../data/contracts/playlists/playlists.ck)
 */
export const PlaylistsRouter = ServerKitRouter();

/**
 * Fans out across every installed plugin that declares AND implements the `catalog` capability
 * from [playlists.ck](file://./../../data/contracts/playlists/playlists.ck#L17)
 */
PlaylistsRouter.get('/playlists', requirePolicy({ policy: false }), async ctx => {
    const service = ctx.container.get(PlaylistsService);
    const result: CatalogPlaylistPage = await service.listPlaylists();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * One playlist's tracks from one plugin
 * from [playlists.ck](file://./../../data/contracts/playlists/playlists.ck#L33)
 */
PlaylistsRouter.get('/playlists/:pluginId/:playlistId/tracks', requirePolicy({ policy: false }), async ctx => {
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
