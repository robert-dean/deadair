import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { RenderService } from '#src/modules/render/render.service.js';
import {
    PronunciationList,
    PronunciationQuery,
    PronunciationStateWrite,
    PronunciationWrite,
    ScriptHistoryPage,
    ScriptHistoryQuery,
    Segment,
    SegmentCreate,
    SegmentList,
    SegmentScanResult,
    VoiceList,
} from '../modules/render/types/render.types.js';
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
 * What the station has written lately, newest first, one page at a time
 * from [render.ck](file://./../../data/contracts/render/render.ck#L80)
 */
RenderRouter.get('/scripts', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, ScriptHistoryQuery.strict());

    const service = ctx.container.get(RenderService);
    const result: ScriptHistoryPage = await service.readScriptHistory(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The voices the station can be asked to speak in
 * from [render.ck](file://./../../data/contracts/render/render.ck#L93)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L118)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L144)
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

/**
 * The station's lexicon: what it says, what has been proposed to it, and what it has turned down
 * from [render.ck](file://./../../data/contracts/render/render.ck#L185)
 */
RenderRouter.get('/pronunciations', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, PronunciationQuery.strict());

    const service = ctx.container.get(RenderService);
    const result: PronunciationList = await service.listPronunciations(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Adds one the operator typed. It is said from the next render on
 * from [render.ck](file://./../../data/contracts/render/render.ck#L195)
 */
RenderRouter.post('/pronunciations', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PronunciationWrite);

    const service = ctx.container.get(RenderService);
    const result: PronunciationList = await service.createPronunciation(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Rewrites one entry's words, whoever proposed it
 * from [render.ck](file://./../../data/contracts/render/render.ck#L216)
 */
RenderRouter.put('/pronunciations/:id', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PronunciationWrite);

    const service = ctx.container.get(RenderService);
    const result: PronunciationList = await service.updatePronunciation(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes an entry outright. Turning a PROPOSAL down is a state rather than a deletion, because a deleted one comes back on the next pass
 * from [render.ck](file://./../../data/contracts/render/render.ck#L231)
 */
RenderRouter.delete('/pronunciations/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(RenderService);
    const result: PronunciationList = await service.deletePronunciation(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Accepts a proposal, turns one down, or takes an entry out of use without losing what it said
 * from [render.ck](file://./../../data/contracts/render/render.ck#L249)
 */
RenderRouter.put('/pronunciations/:id/state', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PronunciationStateWrite);

    const service = ctx.container.get(RenderService);
    const result: PronunciationList = await service.setPronunciationState(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
