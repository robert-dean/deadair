import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PersonaExportService } from '#src/modules/personas/persona.export.service.js';
import { PersonaImportService } from '#src/modules/personas/persona.import.service.js';
import { PersonaMemoryService } from '#src/modules/personas/persona.memory.service.js';
import { PersonaNotesService } from '#src/modules/personas/persona.notes.service.js';
import { PersonaRehearsalService } from '#src/modules/personas/persona.rehearsal.service.js';
import { PersonaStoriesService } from '#src/modules/personas/persona.stories.service.js';
import { PersonasService } from '#src/modules/personas/personas.service.js';
import {
    GeneratedPersona,
    PersonaFile,
    PersonaImportPlan,
    PersonaImportResult,
    PersonaInput,
    PersonaList,
    PersonaMemory,
    PersonaMemoryChange,
    PersonaMemoryRollback,
    PersonaMemoryTimeline,
    PersonaNoteList,
    PersonaNoteState,
    PersonaNoteWrite,
    PersonaRehearsal,
    PersonaRequest,
    PersonaStoryBeatWrite,
    PersonaStoryDetailWrite,
    PersonaStoryList,
    PersonaStoryState,
    PersonaStoryWrite,
} from '../modules/personas/types/personas.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [personas.ck](../../data/contracts/personas/personas.ck)
 */
export const PersonasRouter = ServerKitRouter();

/**
 * Every persona this station has, oldest first
 * from [personas.ck](../../data/contracts/personas/personas.ck#L29)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L42)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L64)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L79)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L98)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L123)
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
 * Reads a file and reports what importing it would create, rewrite and skip. Writes nothing
 * from [personas.ck](../../data/contracts/personas/personas.ck#L154)
 */
PersonasRouter.post('/personas/import/preview', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PersonaFile);

    const service = ctx.container.get(PersonaImportService);
    const result: PersonaImportPlan = await service.preview(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Writes a file into this station, merging by key, and answers with what it did
 * from [personas.ck](../../data/contracts/personas/personas.ck#L179)
 */
PersonasRouter.post('/personas/import', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PersonaFile);

    const service = ctx.container.get(PersonaImportService);
    const result: PersonaImportResult = await service.import(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Rewrites one persona. An edit to the one on air is heard on the next break
 * from [personas.ck](../../data/contracts/personas/personas.ck#L197)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L209)
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
 * Makes this persona the station's own host, and the previous one no longer is
 * from [personas.ck](../../data/contracts/personas/personas.ck#L227)
 */
PersonasRouter.put('/personas/:id/default-host', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonasService);
    const result: PersonaList = await service.setDefaultHost(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Everything this character has accumulated, oldest first, in every state
 * from [personas.ck](../../data/contracts/personas/personas.ck#L250)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L262)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L281)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L293)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L309)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L335)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L347)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L366)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L378)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L394)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L413)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L433)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L445)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L462)
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
 * from [personas.ck](../../data/contracts/personas/personas.ck#L487)
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

/**
 * Adds one part to an arc. A script rather than a summary: the floor speaks it as it stands
 * from [personas.ck](../../data/contracts/personas/personas.ck#L507)
 */
PersonasRouter.post(
    '/personas/:id/stories/:storyId/beats',
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

        const body = await parseAndValidate(ctx.parsedBody, PersonaStoryBeatWrite);

        const service = ctx.container.get(PersonaStoriesService);
        const result: PersonaStoryList = await service.addBeat(id, storyId, body);

        ctx.status = 201;
        ctx.type = 'application/json';
        ctx.body = result;
    },
);

/**
 * Rewrites one part's words, or moves it in the order
 * from [personas.ck](../../data/contracts/personas/personas.ck#L527)
 */
PersonasRouter.put(
    '/personas/:id/stories/:storyId/beats/:beatId',
    requirePolicy({ policy: 'platform.manage' }),
    bodyParserMiddleware(['json']),
    async ctx => {
        const { id, storyId, beatId } = await parseAndValidate(
            ctx.params,
            z.strictObject({
                id: z.string().min(1).max(100),
                storyId: z.string().min(1).max(100),
                beatId: z.string().min(1).max(100),
            }),
        );

        const body = await parseAndValidate(ctx.parsedBody, PersonaStoryBeatWrite);

        const service = ctx.container.get(PersonaStoriesService);
        const result: PersonaStoryList = await service.updateBeat(id, storyId, beatId, body);

        ctx.status = 200;
        ctx.type = 'application/json';
        ctx.body = result;
    },
);

/**
 * Removes one part outright, leaving the arc standing. Turning down a PROPOSAL is a state instead
 * from [personas.ck](../../data/contracts/personas/personas.ck#L539)
 */
PersonasRouter.delete('/personas/:id/stories/:storyId/beats/:beatId', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id, storyId, beatId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
            storyId: z.string().min(1).max(100),
            beatId: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonaStoriesService);
    const result: PersonaStoryList = await service.removeBeat(id, storyId, beatId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Accepts a proposed part, or turns it down without losing that it was turned down
 * from [personas.ck](../../data/contracts/personas/personas.ck#L556)
 */
PersonasRouter.put(
    '/personas/:id/stories/:storyId/beats/:beatId/state',
    requirePolicy({ policy: 'platform.manage' }),
    bodyParserMiddleware(['json']),
    async ctx => {
        const { id, storyId, beatId } = await parseAndValidate(
            ctx.params,
            z.strictObject({
                id: z.string().min(1).max(100),
                storyId: z.string().min(1).max(100),
                beatId: z.string().min(1).max(100),
            }),
        );

        const body = await parseAndValidate(ctx.parsedBody, PersonaStoryState);

        const service = ctx.container.get(PersonaStoriesService);
        const result: PersonaStoryList = await service.setBeatState(id, storyId, beatId, body);

        ctx.status = 200;
        ctx.type = 'application/json';
        ctx.body = result;
    },
);

/**
 * What this character has told, newest first. The timeline a moment is picked from
 * from [personas.ck](../../data/contracts/personas/personas.ck#L583)
 */
PersonasRouter.get('/personas/:id/memory', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonaMemoryService);
    const result: PersonaMemoryTimeline = await service.timeline(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * What rolling back to a moment would undo, without undoing it
 * from [personas.ck](../../data/contracts/personas/personas.ck#L601)
 */
PersonasRouter.get('/personas/:id/memory/preview', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const query = await parseAndValidate(
        ctx.query,
        z.strictObject({
            to: z
                .string()
                .max(40)
                .optional()
                .describe('The moment to go back to, as a timeline row reports it. Absent counts all of it, which is what a reset would take'),
        }),
    );

    const service = ctx.container.get(PersonaMemoryService);
    const result: PersonaMemoryChange = await service.preview(id, query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Undo it. Everything the station accrued after that moment goes; everything an operator wrote stays
 * from [personas.ck](../../data/contracts/personas/personas.ck#L622)
 */
PersonasRouter.post('/personas/:id/memory/rollback', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PersonaMemoryRollback);

    const service = ctx.container.get(PersonaMemoryService);
    const result: PersonaMemory = await service.rollback(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
