import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PlaylistImportService } from '#src/modules/playlists/playlist.import.service.js';
import { StationPlaylistsService } from '#src/modules/playlists/station.playlists.service.js';
import {
    PlaylistFile,
    PlaylistImportInput,
    PlaylistImportPlan,
    PlaylistImportResult,
    StationPlaylist,
    StationPlaylistDetail,
    StationPlaylistList,
    StationPlaylistUpdate,
} from '../modules/playlists/types/station.playlists.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck)
 */
export const StationPlaylistsRouter = ServerKitRouter();

/**
 * Every playlist the station owns, newest first
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L17)
 */
StationPlaylistsRouter.get('/station-playlists', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(StationPlaylistsService);
    const result: StationPlaylistList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * One station playlist with its records in order, placeholders included
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L35)
 */
StationPlaylistsRouter.get('/station-playlists/:id', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(StationPlaylistsService);
    const result: StationPlaylistDetail = await service.get(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Renames a station playlist, or rewrites what it is for
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L48)
 */
StationPlaylistsRouter.patch('/station-playlists/:id', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, StationPlaylistUpdate);

    const service = ctx.container.get(StationPlaylistsService);
    const result: StationPlaylist = await service.update(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Deletes a station playlist. The records it named stay in the library
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L61)
 */
StationPlaylistsRouter.delete('/station-playlists/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(StationPlaylistsService);
    await service.delete(id);

    ctx.status = 204;
});

/**
 * Looks up the records this playlist names and the library does not hold, in the background, and adds the ones a provider has. The activity feed says how it went
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L75)
 */
StationPlaylistsRouter.post('/station-playlists/:id/fill', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(StationPlaylistsService);
    await service.requestFill(id);

    ctx.status = 202;
});

/**
 * One station playlist as a file another station can import
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L89)
 */
StationPlaylistsRouter.get('/station-playlists/:id/export', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(StationPlaylistsService);
    const result: { body: PlaylistFile; headers: { contentDisposition?: string } } = await service.export(id);

    ctx.status = 200;
    if (result.headers['contentDisposition'] !== undefined) ctx.set('Content-Disposition', String(result.headers['contentDisposition']));
    ctx.type = 'application/json';
    ctx.body = result.body;
});

/**
 * Reads a source and reports which of its records the library holds and which it would have to find. Writes nothing
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L110)
 */
StationPlaylistsRouter.post(
    '/station-playlists/import/preview',
    requirePolicy({ policy: 'platform.manage' }),
    bodyParserMiddleware(['json']),
    async ctx => {
        const body = await parseAndValidate(ctx.parsedBody, PlaylistImportInput);

        const service = ctx.container.get(PlaylistImportService);
        const result: PlaylistImportPlan = await service.preview(body);

        ctx.status = 200;
        ctx.type = 'application/json';
        ctx.body = result;
    },
);

/**
 * Makes a new station playlist from a source and answers with what it did
 * from [station.playlists.ck](../../data/contracts/playlists/station.playlists.ck#L127)
 */
StationPlaylistsRouter.post('/station-playlists/import', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PlaylistImportInput);

    const service = ctx.container.get(PlaylistImportService);
    const result: PlaylistImportResult = await service.import(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
