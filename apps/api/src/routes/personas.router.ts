import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PersonaNotesService } from '#src/modules/personas/persona.notes.service.js';
import { PersonaRehearsalService } from '#src/modules/personas/persona.rehearsal.service.js';
import { PersonasService } from '#src/modules/personas/personas.service.js';
import {
    GeneratedPersona,
    Persona,
    PersonaInput,
    PersonaList,
    PersonaNoteList,
    PersonaNoteState,
    PersonaNoteWrite,
    PersonaRehearsal,
    PersonaRequest,
} from '../modules/personas/types/personas.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [personas.ck](file://./../../data/contracts/personas/personas.ck)
 */
export const PersonasRouter = ServerKitRouter();

/**
 * Every persona this station has, oldest first
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L24)
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
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L37)
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
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L59)
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
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L74)
 */
PersonasRouter.post('/personas/restore', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(PersonasService);
    const result: PersonaList = await service.restore();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Rewrites one persona. An edit to the one on air is heard on the next break
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L89)
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
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L101)
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
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L116)
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
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L139)
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
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L151)
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
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L170)
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
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L182)
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
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L198)
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
 * Writes a talk break under this persona against two fixed invented records, and answers with every writer that was asked
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L223)
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
