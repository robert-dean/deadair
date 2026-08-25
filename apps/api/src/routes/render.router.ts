import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { RenderService } from '#src/modules/render/render.service.js';
import {
    PronunciationList,
    PronunciationQuery,
    PronunciationStateWrite,
    PronunciationWrite,
    ScriptAttempt,
    ScriptHistoryPage,
    ScriptHistoryQuery,
    ScriptHistorySummary,
    ScriptHistorySummaryQuery,
    ScriptRatingInput,
    Segment,
    SegmentCreate,
    SegmentList,
    SegmentScanResult,
    SpeechPreviewRequest,
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
 * What the operator thought of this attempt. Nothing acts on it automatically
 * from [render.ck](file://./../../data/contracts/render/render.ck#L116)
 */
RenderRouter.put('/scripts/:id/rating', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, ScriptRatingInput);

    const service = ctx.container.get(RenderService);
    const result: ScriptAttempt = await service.rateScript(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Write attempts by outcome, per presenter, over a recent window
 * from [render.ck](file://./../../data/contracts/render/render.ck#L137)
 */
RenderRouter.get('/scripts/summary', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, ScriptHistorySummaryQuery.strict());

    const service = ctx.container.get(RenderService);
    const result: ScriptHistorySummary = await service.readScriptSummary(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The voices the station can be asked to speak in
 * from [render.ck](file://./../../data/contracts/render/render.ck#L150)
 */
RenderRouter.get('/voices', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(RenderService);
    const result: VoiceList = await service.listVoices();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * A short line spoken in whichever voice the plugin falls back to
 * from [render.ck](file://./../../data/contracts/render/render.ck#L173)
 */
RenderRouter.get('/voices/sample', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(RenderService);
    const result: {
        contentType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/flac' | 'audio/mp4';
        body: Buffer;
        headers: { cacheControl?: string; etag?: string };
    } = await service.getDefaultVoiceSample();

    ctx.status = 200;
    if (result.headers['cacheControl'] !== undefined) ctx.set('cache-control', String(result.headers['cacheControl']));
    if (result.headers['etag'] !== undefined) ctx.set('etag', String(result.headers['etag']));
    ctx.type = result.contentType;
    ctx.body = result.body;
});

/**
 * A short line spoken in one voice, so an operator can hear it before choosing it
 * from [render.ck](file://./../../data/contracts/render/render.ck#L209)
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
 * Speaks the caller's words in one voice, so a break can be heard before it is written for air
 * from [render.ck](file://./../../data/contracts/render/render.ck#L240)
 */
RenderRouter.post('/voices/preview', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, SpeechPreviewRequest);

    const service = ctx.container.get(RenderService);
    const result: { contentType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/flac' | 'audio/mp4'; body: Buffer } =
        await service.previewSpeech(body);

    ctx.status = 200;
    ctx.type = result.contentType;
    ctx.body = result.body;
});

/**
 * The audio of one segment
 * from [render.ck](file://./../../data/contracts/render/render.ck#L265)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L306)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L316)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L337)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L352)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L370)
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
