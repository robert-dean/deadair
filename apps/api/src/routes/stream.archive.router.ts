import { z } from 'zod';
import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { ArchiveService } from '#src/modules/stream/archive.service.js';
import { RecordingList } from '../modules/stream/types/stream.archive.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [stream.archive.ck](../../data/contracts/stream/stream.archive.ck)
 */
export const StreamArchiveRouter = ServerKitRouter();

/**
 * Every recording in the archive, newest first
 * from [stream.archive.ck](../../data/contracts/stream/stream.archive.ck) `GET /archive/recordings`
 */
StreamArchiveRouter.get('/archive/recordings', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(ArchiveService);
    const result: RecordingList = await service.listRecordings();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Deletes a finished recording. One still being recorded is refused
 * from [stream.archive.ck](../../data/contracts/stream/stream.archive.ck) `DELETE /archive/recordings/{id}`
 */
StreamArchiveRouter.delete('/archive/recordings/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(64),
        }),
    );

    const service = ctx.container.get(ArchiveService);
    await service.deleteRecording(id);

    ctx.status = 204;
});

/**
 * The audio of one recording. Answers a byte range, so a player can seek through an hour
 * from [stream.archive.ck](../../data/contracts/stream/stream.archive.ck) `GET /archive/recordings/{id}/audio`
 * anonymous access, no security required
 */
StreamArchiveRouter.get('/archive/recordings/:id/audio', async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(64),
        }),
    );

    const query = await parseAndValidate(
        ctx.query,
        z.strictObject({
            download: z
                .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
                .optional()
                .describe('Answer the whole file as an attachment, named after the recording'),
        }),
    );

    const headers = await parseAndValidate(
        ctx.headers,
        z.object({
            range: z.string().optional().describe('A single byte range, `bytes=start-end`'),
        }),
    );

    const service = ctx.container.get(ArchiveService);
    const result:
        | { status: 200; contentType: 'audio/mpeg'; body: Buffer; headers: { acceptRanges?: string; contentDisposition?: string } }
        | { status: 206; contentType: 'audio/mpeg'; body: Buffer; headers: { acceptRanges?: string; contentRange: string } } =
        await service.getRecordingAudio(id, query, headers);

    ctx.status = result.status;
    switch (result.status) {
        case 200:
            if (result.headers['acceptRanges'] !== undefined) ctx.set('accept-ranges', String(result.headers['acceptRanges']));
            if (result.headers['contentDisposition'] !== undefined) ctx.set('content-disposition', String(result.headers['contentDisposition']));
            ctx.type = result.contentType;
            ctx.body = result.body;
            break;
        case 206:
            if (result.headers['acceptRanges'] !== undefined) ctx.set('accept-ranges', String(result.headers['acceptRanges']));
            ctx.set('content-range', String(result.headers['contentRange']));
            ctx.type = result.contentType;
            ctx.body = result.body;
            break;
    }
});
