import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { RenderService } from '#src/modules/render/render.service.js';
import {
    PadFetch,
    PadList,
    PadScanResult,
    PadSetMembership,
    PadSetWrite,
    PadState,
    PadUpload,
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
    SegmentUpload,
    SpeechPreviewRequest,
    VoiceList,
} from '../modules/render/types/render.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { MultipartBody } from '@maroonedsoftware/multipart';

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
 * Takes a recording in from the browser and puts it in the library, ready to air
 * from [render.ck](file://./../../data/contracts/render/render.ck#L64)
 */
RenderRouter.post('/segments/upload', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['multipart']), async ctx => {
    const multipartBody = ctx.parsedBody as MultipartBody;

    const service = ctx.container.get(RenderService);
    const result: Segment = await service.uploadSegment(multipartBody);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Takes whatever audio is sitting in the inbox directory into the library. Safe to repeat: a segment is identified by its audio, so the same recording arriving twice is one segment
 * from [render.ck](file://./../../data/contracts/render/render.ck#L85)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L110)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L146)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L167)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L180)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L203)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L239)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L270)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L295)
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
 * Audio out of the segment store, addressed by content rather than by row
 * from [render.ck](file://./../../data/contracts/render/render.ck#L348)
 * anonymous access, no security required
 */
RenderRouter.get('/audio/:checksum/:ext', async ctx => {
    const { checksum, ext } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            checksum: z.string().min(64).max(64),
            ext: z.string().min(1).max(8),
        }),
    );

    const service = ctx.container.get(RenderService);
    const result: {
        contentType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/flac' | 'audio/mp4';
        body: Buffer;
        headers: { cacheControl?: string; etag?: string };
    } = await service.getStoredAudio(checksum, ext);

    ctx.status = 200;
    if (result.headers['cacheControl'] !== undefined) ctx.set('cache-control', String(result.headers['cacheControl']));
    if (result.headers['etag'] !== undefined) ctx.set('etag', String(result.headers['etag']));
    ctx.type = result.contentType;
    ctx.body = result.body;
});

/**
 * The station's lexicon: what it says, what has been proposed to it, and what it has turned down
 * from [render.ck](file://./../../data/contracts/render/render.ck#L382)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L392)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L413)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L428)
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
 * from [render.ck](file://./../../data/contracts/render/render.ck#L446)
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

/**
 * Every sound the station holds, board by board
 * from [render.ck](file://./../../data/contracts/render/render.ck#L478)
 */
RenderRouter.get('/pads', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(RenderService);
    const result: PadList = await service.listPads();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Takes a sound in from the browser and puts it on a board. The file lands in the pad library on disk, so it survives a rebuild and an archive carries it
 * from [render.ck](file://./../../data/contracts/render/render.ck#L491)
 */
RenderRouter.post('/pads', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['multipart']), async ctx => {
    const multipartBody = ctx.parsedBody as MultipartBody;

    const service = ctx.container.get(RenderService);
    const result: PadList = await service.uploadPad(multipartBody);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Takes whatever audio is sitting in the pad library directory onto its board. Safe to repeat: a file nobody has touched is seen and left alone
 * from [render.ck](file://./../../data/contracts/render/render.ck#L516)
 */
RenderRouter.post('/pads/scan', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(RenderService);
    const result: PadScanResult = await service.scanPads();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Fetches a sound from an address and puts it on a board. The operator names the address, so this is them choosing a file exactly as dropping one in the library is
 * from [render.ck](file://./../../data/contracts/render/render.ck#L531)
 */
RenderRouter.post('/pads/fetch', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PadFetch);

    const service = ctx.container.get(RenderService);
    const result: PadList = await service.fetchPad(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes a sound the console put there, and the file it wrote for it
 * from [render.ck](file://./../../data/contracts/render/render.ck#L561)
 */
RenderRouter.delete('/pads/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(RenderService);
    const result: PadList = await service.deletePad(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Turns a sound down, or puts one back. Answers the whole rack, since one pad changing state is one row moving between two sections of the same page
 * from [render.ck](file://./../../data/contracts/render/render.ck#L581)
 */
RenderRouter.put('/pads/:id/state', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PadState);

    const service = ctx.container.get(RenderService);
    const result: PadList = await service.setPadState(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The sound itself, so an operator can hear what they dropped in
 * from [render.ck](file://./../../data/contracts/render/render.ck#L602)
 * anonymous access, no security required
 */
RenderRouter.get('/pads/:id/audio', async ctx => {
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
    } = await service.getPadAudio(id);

    ctx.status = 200;
    if (result.headers['cacheControl'] !== undefined) ctx.set('cache-control', String(result.headers['cacheControl']));
    if (result.headers['etag'] !== undefined) ctx.set('etag', String(result.headers['etag']));
    ctx.type = result.contentType;
    ctx.body = result.body;
});

/**
 * Names a new set, or answers the one already under that key
 * from [render.ck](file://./../../data/contracts/render/render.ck#L632)
 */
RenderRouter.post('/pads/sets', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PadSetWrite);

    const service = ctx.container.get(RenderService);
    const result: PadList = await service.createPadSet(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Renames a set. The KEY moves with it, so every persona naming the old one stops finding it
 * from [render.ck](file://./../../data/contracts/render/render.ck#L653)
 */
RenderRouter.put('/pads/sets/:id', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PadSetWrite);

    const service = ctx.container.get(RenderService);
    const result: PadList = await service.updatePadSet(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes a set and its memberships, and no pads at all
 * from [render.ck](file://./../../data/contracts/render/render.ck#L668)
 */
RenderRouter.delete('/pads/sets/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(RenderService);
    const result: PadList = await service.deletePadSet(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Puts a pad on a set or takes it off. Refused where the set already answers to that name, because a script writes a name
 * from [render.ck](file://./../../data/contracts/render/render.ck#L686)
 */
RenderRouter.put('/pads/sets/:id/pads', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PadSetMembership);

    const service = ctx.container.get(RenderService);
    const result: PadList = await service.setPadMembership(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
