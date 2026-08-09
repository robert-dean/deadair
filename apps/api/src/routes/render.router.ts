import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { RenderService } from '#src/modules/render/render.service.js';
import { Segment, SegmentCreate, SegmentList, SegmentScanResult, VoiceList } from '../modules/render/types/render.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [render.ck](file://./../../data/contracts/render/render.ck)
 */
export const RenderRouter = ServerKitRouter();

/**
 * Everything the station can play that is not a record
 * from [render.ck](file://./../../data/contracts/render/render.ck#L28)
 */
RenderRouter.get('/segments', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(RenderService);
    const result: SegmentList = await service.listSegments();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Plans something for the station to say, and starts rendering it
 * from [render.ck](file://./../../data/contracts/render/render.ck#L37)
 */
RenderRouter.post('/segments', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, SegmentCreate);

    const service = ctx.container.get(RenderService);
    const result: Segment = await service.createSegment(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Takes whatever audio is sitting in the inbox directory into the library. Safe to repeat: a segment is identified by its audio, so the same recording arriving twice is one segment
 * from [render.ck](file://./../../data/contracts/render/render.ck#L55)
 */
RenderRouter.post('/segments/scan', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(RenderService);
    const result: SegmentScanResult = await service.scanLibrary();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The voices the station can be asked to speak in
 * from [render.ck](file://./../../data/contracts/render/render.ck#L70)
 */
RenderRouter.get('/voices', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(RenderService);
    const result: VoiceList = await service.listVoices();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * A short line spoken in one voice, so an operator can hear it before choosing it
 * from [render.ck](file://./../../data/contracts/render/render.ck#L95)
 */
RenderRouter.get('/voices/:voiceId/sample', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { voiceId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            voiceId: z.string(),
        }),
    );

    const service = ctx.container.get(RenderService);
    const result: {
        contentType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/flac' | 'audio/mp4';
        body: Buffer;
        headers: { cacheControl?: string; etag?: string };
    } = await service.getVoiceSample(voiceId);

    ctx.status = 200;
    if (result.headers['cacheControl'] !== undefined) ctx.set('cache-control', String(result.headers['cacheControl']));
    if (result.headers['etag'] !== undefined) ctx.set('etag', String(result.headers['etag']));
    ctx.type = result.contentType;
    ctx.body = result.body;
});

/**
 * The audio of one segment
 * from [render.ck](file://./../../data/contracts/render/render.ck#L121)
 * anonymous access, no security required
 */
RenderRouter.get('/segments/:id/audio', async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(RenderService);
    const result: {
        contentType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/flac' | 'audio/mp4';
        body: Buffer;
        headers: { cacheControl?: string; etag?: string };
    } = await service.getSegmentAudio(id);

    ctx.status = 200;
    if (result.headers['cacheControl'] !== undefined) ctx.set('cache-control', String(result.headers['cacheControl']));
    if (result.headers['etag'] !== undefined) ctx.set('etag', String(result.headers['etag']));
    ctx.type = result.contentType;
    ctx.body = result.body;
});
