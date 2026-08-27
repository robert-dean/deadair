import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PersonaExportService } from '#src/modules/personas/persona.export.service.js';
import { PersonaNotesService } from '#src/modules/personas/persona.notes.service.js';
import { PersonaRehearsalService } from '#src/modules/personas/persona.rehearsal.service.js';
import { PersonaStoriesService } from '#src/modules/personas/persona.stories.service.js';
import { PersonasService } from '#src/modules/personas/personas.service.js';
import {
    GeneratedPersona,
    Persona,
    PersonaFile,
    PersonaInput,
    PersonaList,
    PersonaNoteList,
    PersonaNoteState,
    PersonaNoteWrite,
    PersonaRehearsal,
    PersonaRequest,
    PersonaStoryDetailWrite,
    PersonaStoryList,
    PersonaStoryState,
    PersonaStoryWrite,
} from '../modules/personas/types/personas.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [personas.ck](file://./../../data/contracts/personas/personas.ck)
 */
export const PersonasRouter = ServerKitRouter();

/**
 * Every persona this station has, oldest first
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L26)
 */
PersonasRouter.get('/personas', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(PersonasService);
    const result: PersonaList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Writes a new persona. It is not put on air by creating it
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L39)
 */
PersonasRouter.post('/personas', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PersonaInput);

    const service = ctx.container.get(PersonasService);
    const result: PersonaList = await service.create(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Turns a description of a character into a whole persona, checked against its own sample lines and handed back unsaved
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L61)
 */
PersonasRouter.post('/personas/generate', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PersonaRequest);

    const service = ctx.container.get(PersonasService);
    const result: GeneratedPersona = await service.generate(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Writes back whichever of the station's own personas this station is missing, touching nothing it already has and putting nothing on air
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L76)
 */
PersonasRouter.post('/personas/restore', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(PersonasService);
    const result: PersonaList = await service.restore();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Every character this station holds, as one file
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L95)
 */
PersonasRouter.get('/personas/export', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(PersonaExportService);
    const result: { body: PersonaFile; headers: { contentDisposition?: string } } = await service.exportPersonas();

    ctx.status = 200;
    if (result.headers['contentDisposition'] !== undefined) ctx.set('Content-Disposition', String(result.headers['contentDisposition']));
    ctx.type = 'application/json';
    ctx.body = result.body;
});

/**
 * One character, its sheet and its stories, as a file
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L120)
 */
PersonasRouter.get('/personas/:id/export', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonaExportService);
    const result: { body: PersonaFile; headers: { contentDisposition?: string } } = await service.exportPersona(id);

    ctx.status = 200;
    if (result.headers['contentDisposition'] !== undefined) ctx.set('Content-Disposition', String(result.headers['contentDisposition']));
    ctx.type = 'application/json';
    ctx.body = result.body;
});

/**
 * Rewrites one persona. An edit to the one on air is heard on the next break
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L142)
 */
PersonasRouter.put('/personas/:id', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PersonaInput);

    const service = ctx.container.get(PersonasService);
    const result: PersonaList = await service.update(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes a persona, including the one on air, which leaves the station with none
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L154)
 */
PersonasRouter.delete('/personas/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonasService);
    const result: PersonaList = await service.remove(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Puts this persona on air and takes the previous one off
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L169)
 */
PersonasRouter.put('/personas/:id/active', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonasService);
    const result: PersonaList = await service.setActive(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Everything this character has accumulated, oldest first, in every state
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L192)
 */
PersonasRouter.get('/personas/:id/notes', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonaNotesService);
    const result: PersonaNoteList = await service.list(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Writes a note by hand. An operator's own note is active from the moment it exists; only the distil pass proposes
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L204)
 */
PersonasRouter.post('/personas/:id/notes', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PersonaNoteWrite);

    const service = ctx.container.get(PersonaNotesService);
    const result: PersonaNoteList = await service.create(id, body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Rewrites one note's words, whoever wrote it. Editing what the station proposed is most of the point of the panel
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L223)
 */
PersonasRouter.put('/personas/:id/notes/:noteId', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id, noteId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
            noteId: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PersonaNoteWrite);

    const service = ctx.container.get(PersonaNotesService);
    const result: PersonaNoteList = await service.update(id, noteId, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes a note outright. Turning down a PROPOSAL is a state rather than this, or the next pass writes it again
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L235)
 */
PersonasRouter.delete('/personas/:id/notes/:noteId', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id, noteId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
            noteId: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonaNotesService);
    const result: PersonaNoteList = await service.remove(id, noteId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Accepts a proposal, turns one down, or rests an active note. Mirrors the lexicon's own state route
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L251)
 */
PersonasRouter.put('/personas/:id/notes/:noteId/state', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id, noteId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
            noteId: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PersonaNoteState);

    const service = ctx.container.get(PersonaNotesService);
    const result: PersonaNoteList = await service.setState(id, noteId, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Every story this character holds, oldest first, in every state
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L277)
 */
PersonasRouter.get('/personas/:id/stories', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonaStoriesService);
    const result: PersonaStoryList = await service.list(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Writes a story by hand. An operator's own is tellable from the moment it exists; only the enrichment pass proposes
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L289)
 */
PersonasRouter.post('/personas/:id/stories', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PersonaStoryWrite);

    const service = ctx.container.get(PersonaStoriesService);
    const result: PersonaStoryList = await service.create(id, body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Rewrites one story's handle and telling, whoever wrote it
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L308)
 */
PersonasRouter.put('/personas/:id/stories/:storyId', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id, storyId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
            storyId: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PersonaStoryWrite);

    const service = ctx.container.get(PersonaStoriesService);
    const result: PersonaStoryList = await service.update(id, storyId, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes a story outright, details and all. Turning down a PROPOSAL is a state rather than this, or the next pass writes it again
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L320)
 */
PersonasRouter.delete('/personas/:id/stories/:storyId', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id, storyId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
            storyId: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonaStoriesService);
    const result: PersonaStoryList = await service.remove(id, storyId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Accepts a proposal, turns one down, or takes a story out of the rotation without losing it
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L336)
 */
PersonasRouter.put(
    '/personas/:id/stories/:storyId/state',
    requirePolicy({ policy: 'platform.manage' }),
    bodyParserMiddleware(['json']),
    async ctx => {
        const { id, storyId } = await parseAndValidate(
            ctx.params,
            z.strictObject({
                id: z.string().min(1).max(100),
                storyId: z.string().min(1).max(100),
            }),
        );

        const body = await parseAndValidate(ctx.parsedBody, PersonaStoryState);

        const service = ctx.container.get(PersonaStoriesService);
        const result: PersonaStoryList = await service.setState(id, storyId, body);

        ctx.status = 200;
        ctx.type = 'application/json';
        ctx.body = result;
    },
);

/**
 * Adds one thing to a story that already exists
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L355)
 */
PersonasRouter.post(
    '/personas/:id/stories/:storyId/details',
    requirePolicy({ policy: 'platform.manage' }),
    bodyParserMiddleware(['json']),
    async ctx => {
        const { id, storyId } = await parseAndValidate(
            ctx.params,
            z.strictObject({
                id: z.string().min(1).max(100),
                storyId: z.string().min(1).max(100),
            }),
        );

        const body = await parseAndValidate(ctx.parsedBody, PersonaStoryDetailWrite);

        const service = ctx.container.get(PersonaStoriesService);
        const result: PersonaStoryList = await service.addDetail(id, storyId, body);

        ctx.status = 201;
        ctx.type = 'application/json';
        ctx.body = result;
    },
);

/**
 * Rewrites one detail's words
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L375)
 */
PersonasRouter.put(
    '/personas/:id/stories/:storyId/details/:detailId',
    requirePolicy({ policy: 'platform.manage' }),
    bodyParserMiddleware(['json']),
    async ctx => {
        const { id, storyId, detailId } = await parseAndValidate(
            ctx.params,
            z.strictObject({
                id: z.string().min(1).max(100),
                storyId: z.string().min(1).max(100),
                detailId: z.string().min(1).max(100),
            }),
        );

        const body = await parseAndValidate(ctx.parsedBody, PersonaStoryDetailWrite);

        const service = ctx.container.get(PersonaStoriesService);
        const result: PersonaStoryList = await service.updateDetail(id, storyId, detailId, body);

        ctx.status = 200;
        ctx.type = 'application/json';
        ctx.body = result;
    },
);

/**
 * Removes one detail, leaving the story it was hung on alone
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L387)
 */
PersonasRouter.delete('/personas/:id/stories/:storyId/details/:detailId', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id, storyId, detailId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
            storyId: z.string().min(1).max(100),
            detailId: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonaStoriesService);
    const result: PersonaStoryList = await service.removeDetail(id, storyId, detailId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Accepts a proposed detail or turns it down, which has to outlive the pass that proposed it
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L404)
 */
PersonasRouter.put(
    '/personas/:id/stories/:storyId/details/:detailId/state',
    requirePolicy({ policy: 'platform.manage' }),
    bodyParserMiddleware(['json']),
    async ctx => {
        const { id, storyId, detailId } = await parseAndValidate(
            ctx.params,
            z.strictObject({
                id: z.string().min(1).max(100),
                storyId: z.string().min(1).max(100),
                detailId: z.string().min(1).max(100),
            }),
        );

        const body = await parseAndValidate(ctx.parsedBody, PersonaStoryState);

        const service = ctx.container.get(PersonaStoriesService);
        const result: PersonaStoryList = await service.setDetailState(id, storyId, detailId, body);

        ctx.status = 200;
        ctx.type = 'application/json';
        ctx.body = result;
    },
);

/**
 * Writes a talk break under this persona against two fixed invented records, and answers with every writer that was asked
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L429)
 */
PersonasRouter.post('/personas/:id/rehearse', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonaRehearsalService);
    const result: PersonaRehearsal = await service.rehearse(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
