// Auto-generated MCP tools
// generated from [personas.ck](../../data/contracts/personas/personas.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { PersonaExportService } from '#src/modules/personas/persona.export.service.js';
import { PersonaImportService } from '#src/modules/personas/persona.import.service.js';
import { PersonaMemoryService } from '#src/modules/personas/persona.memory.service.js';
import { PersonaNotesService } from '#src/modules/personas/persona.notes.service.js';
import { PersonasService } from '#src/modules/personas/personas.service.js';
import { PersonaStoriesService } from '#src/modules/personas/persona.stories.service.js';
import {
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
    PersonaStoryBeatWrite,
    PersonaStoryDetailWrite,
    PersonaStoryList,
    PersonaStoryState,
    PersonaStoryWrite,
} from '../modules/personas/types/personas.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListPersonasArgs = z.object({});
const CreatePersonaArgs = z.object({ body: PersonaInput });
const RestoreStationPersonasArgs = z.object({});
const ExportPersonasArgs = z.object({});
const ExportPersonaArgs = z.object({ id: z.string().min(1).max(100) });
const PreviewPersonaImportArgs = z.object({ body: PersonaFile });
const ImportPersonasArgs = z.object({ body: PersonaFile });
const UpdatePersonaArgs = z.object({ id: z.string().min(1).max(100), body: PersonaInput });
const DeletePersonaArgs = z.object({ id: z.string().min(1).max(100) });
const SetTheStationHostArgs = z.object({ id: z.string().min(1).max(100) });
const ListPersonaNotesArgs = z.object({ id: z.string().min(1).max(100) });
const WritePersonaNoteArgs = z.object({ id: z.string().min(1).max(100), body: PersonaNoteWrite });
const UpdatePersonaNoteArgs = z.object({ id: z.string().min(1).max(100), noteId: z.string().min(1).max(100), body: PersonaNoteWrite });
const DeletePersonaNoteArgs = z.object({ id: z.string().min(1).max(100), noteId: z.string().min(1).max(100) });
const SetPersonaNoteStateArgs = z.object({ id: z.string().min(1).max(100), noteId: z.string().min(1).max(100), body: PersonaNoteState });
const ListPersonaStoriesArgs = z.object({ id: z.string().min(1).max(100) });
const WritePersonaStoryArgs = z.object({ id: z.string().min(1).max(100), body: PersonaStoryWrite });
const UpdatePersonaStoryArgs = z.object({ id: z.string().min(1).max(100), storyId: z.string().min(1).max(100), body: PersonaStoryWrite });
const DeletePersonaStoryArgs = z.object({ id: z.string().min(1).max(100), storyId: z.string().min(1).max(100) });
const SetPersonaStoryStateArgs = z.object({ id: z.string().min(1).max(100), storyId: z.string().min(1).max(100), body: PersonaStoryState });
const AddPersonaStoryDetailArgs = z.object({ id: z.string().min(1).max(100), storyId: z.string().min(1).max(100), body: PersonaStoryDetailWrite });
const UpdatePersonaStoryDetailArgs = z.object({
    id: z.string().min(1).max(100),
    storyId: z.string().min(1).max(100),
    detailId: z.string().min(1).max(100),
    body: PersonaStoryDetailWrite,
});
const DeletePersonaStoryDetailArgs = z.object({
    id: z.string().min(1).max(100),
    storyId: z.string().min(1).max(100),
    detailId: z.string().min(1).max(100),
});
const SetPersonaStoryDetailStateArgs = z.object({
    id: z.string().min(1).max(100),
    storyId: z.string().min(1).max(100),
    detailId: z.string().min(1).max(100),
    body: PersonaStoryState,
});
const AddPersonaStoryBeatArgs = z.object({ id: z.string().min(1).max(100), storyId: z.string().min(1).max(100), body: PersonaStoryBeatWrite });
const UpdatePersonaStoryBeatArgs = z.object({
    id: z.string().min(1).max(100),
    storyId: z.string().min(1).max(100),
    beatId: z.string().min(1).max(100),
    body: PersonaStoryBeatWrite,
});
const DeletePersonaStoryBeatArgs = z.object({
    id: z.string().min(1).max(100),
    storyId: z.string().min(1).max(100),
    beatId: z.string().min(1).max(100),
});
const SetPersonaStoryBeatStateArgs = z.object({
    id: z.string().min(1).max(100),
    storyId: z.string().min(1).max(100),
    beatId: z.string().min(1).max(100),
    body: PersonaStoryState,
});
const ReadPersonaMemoryArgs = z.object({ id: z.string().min(1).max(100) });
const PreviewPersonaMemoryRollbackArgs = z.object({
    id: z.string().min(1).max(100),
    query: z
        .object({
            to: z
                .string()
                .max(40)
                .optional()
                .describe('The moment to go back to, as a timeline row reports it. Absent counts all of it, which is what a reset would take'),
        })
        .optional(),
});
const RollBackPersonaMemoryArgs = z.object({ id: z.string().min(1).max(100), body: PersonaMemoryRollback });

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L29)
 */
@Injectable()
export class ListPersonasMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_personas',
        description: 'Every persona this station has, oldest first',
        inputSchema: z.toJSONSchema(ListPersonasArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(PersonasService).list();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L42)
 */
@Injectable()
export class CreatePersonaMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'create_persona',
        description: 'Writes a new persona. It is not put on air by creating it',
        inputSchema: z.toJSONSchema(CreatePersonaArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, CreatePersonaArgs);
        const result = await container.get(PersonasService).create(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L80)
 */
@Injectable()
export class RestoreStationPersonasMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'restore_station_personas',
        description:
            "Writes back whichever of the station's own personas this station is missing, touching nothing it already has and putting nothing on air",
        inputSchema: z.toJSONSchema(RestoreStationPersonasArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(PersonasService).restore();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L99)
 */
@Injectable()
export class ExportPersonasMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'export_personas',
        description: 'Every character this station holds, as one file',
        inputSchema: z.toJSONSchema(ExportPersonasArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaFile, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(PersonaExportService).exportPersonas();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L124)
 */
@Injectable()
export class ExportPersonaMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'export_persona',
        description: 'One character, its sheet and its stories, as a file',
        inputSchema: z.toJSONSchema(ExportPersonaArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaFile, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id } = await parseAndValidate(args, ExportPersonaArgs);
        const result = await container.get(PersonaExportService).exportPersona(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L155)
 */
@Injectable()
export class PreviewPersonaImportMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'preview_persona_import',
        description: 'Reads a file and reports what importing it would create, rewrite and skip. Writes nothing',
        inputSchema: z.toJSONSchema(PreviewPersonaImportArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaImportPlan, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, PreviewPersonaImportArgs);
        const result = await container.get(PersonaImportService).preview(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L180)
 */
@Injectable()
export class ImportPersonasMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'import_personas',
        description: 'Writes a file into this station, merging by key, and answers with what it did',
        inputSchema: z.toJSONSchema(ImportPersonasArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaImportResult, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, ImportPersonasArgs);
        const result = await container.get(PersonaImportService).import(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L198)
 */
@Injectable()
export class UpdatePersonaMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'update_persona',
        description: 'Rewrites one persona. An edit to the one on air is heard on the next break',
        inputSchema: z.toJSONSchema(UpdatePersonaArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, UpdatePersonaArgs);
        const result = await container.get(PersonasService).update(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L210)
 */
@Injectable()
export class DeletePersonaMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_persona',
        description: 'Removes a persona, including the one on air, which leaves the station with none',
        inputSchema: z.toJSONSchema(DeletePersonaArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, DeletePersonaArgs);
        const result = await container.get(PersonasService).remove(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L228)
 */
@Injectable()
export class SetTheStationHostMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'set_the_station_host',
        description: "Makes this persona the station's own host, and the previous one no longer is",
        inputSchema: z.toJSONSchema(SetTheStationHostArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, SetTheStationHostArgs);
        const result = await container.get(PersonasService).setDefaultHost(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L251)
 */
@Injectable()
export class ListPersonaNotesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_persona_notes',
        description: 'Everything this character has accumulated, oldest first, in every state',
        inputSchema: z.toJSONSchema(ListPersonaNotesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaNoteList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id } = await parseAndValidate(args, ListPersonaNotesArgs);
        const result = await container.get(PersonaNotesService).list(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L263)
 */
@Injectable()
export class WritePersonaNoteMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'write_persona_note',
        description: "Writes a note by hand. An operator's own note is active from the moment it exists; only the distil pass proposes",
        inputSchema: z.toJSONSchema(WritePersonaNoteArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaNoteList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, WritePersonaNoteArgs);
        const result = await container.get(PersonaNotesService).create(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L282)
 */
@Injectable()
export class UpdatePersonaNoteMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'update_persona_note',
        description: "Rewrites one note's words, whoever wrote it. Editing what the station proposed is most of the point of the panel",
        inputSchema: z.toJSONSchema(UpdatePersonaNoteArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaNoteList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, noteId, body } = await parseAndValidate(args, UpdatePersonaNoteArgs);
        const result = await container.get(PersonaNotesService).update(id, noteId, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L294)
 */
@Injectable()
export class DeletePersonaNoteMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_persona_note',
        description: 'Removes a note outright. Turning down a PROPOSAL is a state rather than this, or the next pass writes it again',
        inputSchema: z.toJSONSchema(DeletePersonaNoteArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaNoteList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, noteId } = await parseAndValidate(args, DeletePersonaNoteArgs);
        const result = await container.get(PersonaNotesService).remove(id, noteId);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L310)
 */
@Injectable()
export class SetPersonaNoteStateMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'set_persona_note_state',
        description: "Accepts a proposal, turns one down, or rests an active note. Mirrors the lexicon's own state route",
        inputSchema: z.toJSONSchema(SetPersonaNoteStateArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaNoteList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, noteId, body } = await parseAndValidate(args, SetPersonaNoteStateArgs);
        const result = await container.get(PersonaNotesService).setState(id, noteId, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L336)
 */
@Injectable()
export class ListPersonaStoriesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_persona_stories',
        description: 'Every story this character holds, oldest first, in every state',
        inputSchema: z.toJSONSchema(ListPersonaStoriesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaStoryList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id } = await parseAndValidate(args, ListPersonaStoriesArgs);
        const result = await container.get(PersonaStoriesService).list(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L348)
 */
@Injectable()
export class WritePersonaStoryMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'write_persona_story',
        description: "Writes a story by hand. An operator's own is tellable from the moment it exists; only the enrichment pass proposes",
        inputSchema: z.toJSONSchema(WritePersonaStoryArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaStoryList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, WritePersonaStoryArgs);
        const result = await container.get(PersonaStoriesService).create(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L367)
 */
@Injectable()
export class UpdatePersonaStoryMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'update_persona_story',
        description: "Rewrites one story's handle and telling, whoever wrote it",
        inputSchema: z.toJSONSchema(UpdatePersonaStoryArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaStoryList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, storyId, body } = await parseAndValidate(args, UpdatePersonaStoryArgs);
        const result = await container.get(PersonaStoriesService).update(id, storyId, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L379)
 */
@Injectable()
export class DeletePersonaStoryMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_persona_story',
        description:
            'Removes a story outright, details and all. Turning down a PROPOSAL is a state rather than this, or the next pass writes it again',
        inputSchema: z.toJSONSchema(DeletePersonaStoryArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaStoryList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, storyId } = await parseAndValidate(args, DeletePersonaStoryArgs);
        const result = await container.get(PersonaStoriesService).remove(id, storyId);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L395)
 */
@Injectable()
export class SetPersonaStoryStateMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'set_persona_story_state',
        description: 'Accepts a proposal, turns one down, or takes a story out of the rotation without losing it',
        inputSchema: z.toJSONSchema(SetPersonaStoryStateArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaStoryList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, storyId, body } = await parseAndValidate(args, SetPersonaStoryStateArgs);
        const result = await container.get(PersonaStoriesService).setState(id, storyId, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L414)
 */
@Injectable()
export class AddPersonaStoryDetailMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'add_persona_story_detail',
        description: 'Adds one thing to a story that already exists',
        inputSchema: z.toJSONSchema(AddPersonaStoryDetailArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaStoryList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, storyId, body } = await parseAndValidate(args, AddPersonaStoryDetailArgs);
        const result = await container.get(PersonaStoriesService).addDetail(id, storyId, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L434)
 */
@Injectable()
export class UpdatePersonaStoryDetailMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'update_persona_story_detail',
        description: "Rewrites one detail's words",
        inputSchema: z.toJSONSchema(UpdatePersonaStoryDetailArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaStoryList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, storyId, detailId, body } = await parseAndValidate(args, UpdatePersonaStoryDetailArgs);
        const result = await container.get(PersonaStoriesService).updateDetail(id, storyId, detailId, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L446)
 */
@Injectable()
export class DeletePersonaStoryDetailMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_persona_story_detail',
        description: 'Removes one detail, leaving the story it was hung on alone',
        inputSchema: z.toJSONSchema(DeletePersonaStoryDetailArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaStoryList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, storyId, detailId } = await parseAndValidate(args, DeletePersonaStoryDetailArgs);
        const result = await container.get(PersonaStoriesService).removeDetail(id, storyId, detailId);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L463)
 */
@Injectable()
export class SetPersonaStoryDetailStateMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'set_persona_story_detail_state',
        description: 'Accepts a proposed detail or turns it down, which has to outlive the pass that proposed it',
        inputSchema: z.toJSONSchema(SetPersonaStoryDetailStateArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaStoryList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, storyId, detailId, body } = await parseAndValidate(args, SetPersonaStoryDetailStateArgs);
        const result = await container.get(PersonaStoriesService).setDetailState(id, storyId, detailId, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L509)
 */
@Injectable()
export class AddPersonaStoryBeatMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'add_persona_story_beat',
        description: 'Adds one part to an arc. A script rather than a summary: the floor speaks it as it stands',
        inputSchema: z.toJSONSchema(AddPersonaStoryBeatArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaStoryList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, storyId, body } = await parseAndValidate(args, AddPersonaStoryBeatArgs);
        const result = await container.get(PersonaStoriesService).addBeat(id, storyId, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L529)
 */
@Injectable()
export class UpdatePersonaStoryBeatMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'update_persona_story_beat',
        description: "Rewrites one part's words, or moves it in the order",
        inputSchema: z.toJSONSchema(UpdatePersonaStoryBeatArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaStoryList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, storyId, beatId, body } = await parseAndValidate(args, UpdatePersonaStoryBeatArgs);
        const result = await container.get(PersonaStoriesService).updateBeat(id, storyId, beatId, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L541)
 */
@Injectable()
export class DeletePersonaStoryBeatMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_persona_story_beat',
        description: 'Removes one part outright, leaving the arc standing. Turning down a PROPOSAL is a state instead',
        inputSchema: z.toJSONSchema(DeletePersonaStoryBeatArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaStoryList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, storyId, beatId } = await parseAndValidate(args, DeletePersonaStoryBeatArgs);
        const result = await container.get(PersonaStoriesService).removeBeat(id, storyId, beatId);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L558)
 */
@Injectable()
export class SetPersonaStoryBeatStateMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'set_persona_story_beat_state',
        description: 'Accepts a proposed part, or turns it down without losing that it was turned down',
        inputSchema: z.toJSONSchema(SetPersonaStoryBeatStateArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaStoryList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, storyId, beatId, body } = await parseAndValidate(args, SetPersonaStoryBeatStateArgs);
        const result = await container.get(PersonaStoriesService).setBeatState(id, storyId, beatId, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L585)
 */
@Injectable()
export class ReadPersonaMemoryMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_persona_memory',
        description: 'What this character has told, newest first. The timeline a moment is picked from',
        inputSchema: z.toJSONSchema(ReadPersonaMemoryArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaMemoryTimeline, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id } = await parseAndValidate(args, ReadPersonaMemoryArgs);
        const result = await container.get(PersonaMemoryService).timeline(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L603)
 */
@Injectable()
export class PreviewPersonaMemoryRollbackMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'preview_persona_memory_rollback',
        description: 'What rolling back to a moment would undo, without undoing it',
        inputSchema: z.toJSONSchema(PreviewPersonaMemoryRollbackArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaMemoryChange, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id, query = await parseAndValidate({}, PreviewPersonaMemoryRollbackArgs.shape.query.unwrap()) } = await parseAndValidate(
            args,
            PreviewPersonaMemoryRollbackArgs,
        );
        const result = await container.get(PersonaMemoryService).preview(id, query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.ck](../../data/contracts/personas/personas.ck#L624)
 */
@Injectable()
export class RollBackPersonaMemoryMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'roll_back_persona_memory',
        description: 'Undo it. Everything the station accrued after that moment goes; everything an operator wrote stays',
        inputSchema: z.toJSONSchema(RollBackPersonaMemoryArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaMemory, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, RollBackPersonaMemoryArgs);
        const result = await container.get(PersonaMemoryService).rollback(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerPersonasMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_personas', container.get(ListPersonasMcpTool));
    map.set('create_persona', container.get(CreatePersonaMcpTool));
    map.set('restore_station_personas', container.get(RestoreStationPersonasMcpTool));
    map.set('export_personas', container.get(ExportPersonasMcpTool));
    map.set('export_persona', container.get(ExportPersonaMcpTool));
    map.set('preview_persona_import', container.get(PreviewPersonaImportMcpTool));
    map.set('import_personas', container.get(ImportPersonasMcpTool));
    map.set('update_persona', container.get(UpdatePersonaMcpTool));
    map.set('delete_persona', container.get(DeletePersonaMcpTool));
    map.set('set_the_station_host', container.get(SetTheStationHostMcpTool));
    map.set('list_persona_notes', container.get(ListPersonaNotesMcpTool));
    map.set('write_persona_note', container.get(WritePersonaNoteMcpTool));
    map.set('update_persona_note', container.get(UpdatePersonaNoteMcpTool));
    map.set('delete_persona_note', container.get(DeletePersonaNoteMcpTool));
    map.set('set_persona_note_state', container.get(SetPersonaNoteStateMcpTool));
    map.set('list_persona_stories', container.get(ListPersonaStoriesMcpTool));
    map.set('write_persona_story', container.get(WritePersonaStoryMcpTool));
    map.set('update_persona_story', container.get(UpdatePersonaStoryMcpTool));
    map.set('delete_persona_story', container.get(DeletePersonaStoryMcpTool));
    map.set('set_persona_story_state', container.get(SetPersonaStoryStateMcpTool));
    map.set('add_persona_story_detail', container.get(AddPersonaStoryDetailMcpTool));
    map.set('update_persona_story_detail', container.get(UpdatePersonaStoryDetailMcpTool));
    map.set('delete_persona_story_detail', container.get(DeletePersonaStoryDetailMcpTool));
    map.set('set_persona_story_detail_state', container.get(SetPersonaStoryDetailStateMcpTool));
    map.set('add_persona_story_beat', container.get(AddPersonaStoryBeatMcpTool));
    map.set('update_persona_story_beat', container.get(UpdatePersonaStoryBeatMcpTool));
    map.set('delete_persona_story_beat', container.get(DeletePersonaStoryBeatMcpTool));
    map.set('set_persona_story_beat_state', container.get(SetPersonaStoryBeatStateMcpTool));
    map.set('read_persona_memory', container.get(ReadPersonaMemoryMcpTool));
    map.set('preview_persona_memory_rollback', container.get(PreviewPersonaMemoryRollbackMcpTool));
    map.set('roll_back_persona_memory', container.get(RollBackPersonaMemoryMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerPersonasMcpToolClasses(registry: Registry): void {
    registry.register(ListPersonasMcpTool).useClass(ListPersonasMcpTool).asSingleton();
    registry.register(CreatePersonaMcpTool).useClass(CreatePersonaMcpTool).asSingleton();
    registry.register(RestoreStationPersonasMcpTool).useClass(RestoreStationPersonasMcpTool).asSingleton();
    registry.register(ExportPersonasMcpTool).useClass(ExportPersonasMcpTool).asSingleton();
    registry.register(ExportPersonaMcpTool).useClass(ExportPersonaMcpTool).asSingleton();
    registry.register(PreviewPersonaImportMcpTool).useClass(PreviewPersonaImportMcpTool).asSingleton();
    registry.register(ImportPersonasMcpTool).useClass(ImportPersonasMcpTool).asSingleton();
    registry.register(UpdatePersonaMcpTool).useClass(UpdatePersonaMcpTool).asSingleton();
    registry.register(DeletePersonaMcpTool).useClass(DeletePersonaMcpTool).asSingleton();
    registry.register(SetTheStationHostMcpTool).useClass(SetTheStationHostMcpTool).asSingleton();
    registry.register(ListPersonaNotesMcpTool).useClass(ListPersonaNotesMcpTool).asSingleton();
    registry.register(WritePersonaNoteMcpTool).useClass(WritePersonaNoteMcpTool).asSingleton();
    registry.register(UpdatePersonaNoteMcpTool).useClass(UpdatePersonaNoteMcpTool).asSingleton();
    registry.register(DeletePersonaNoteMcpTool).useClass(DeletePersonaNoteMcpTool).asSingleton();
    registry.register(SetPersonaNoteStateMcpTool).useClass(SetPersonaNoteStateMcpTool).asSingleton();
    registry.register(ListPersonaStoriesMcpTool).useClass(ListPersonaStoriesMcpTool).asSingleton();
    registry.register(WritePersonaStoryMcpTool).useClass(WritePersonaStoryMcpTool).asSingleton();
    registry.register(UpdatePersonaStoryMcpTool).useClass(UpdatePersonaStoryMcpTool).asSingleton();
    registry.register(DeletePersonaStoryMcpTool).useClass(DeletePersonaStoryMcpTool).asSingleton();
    registry.register(SetPersonaStoryStateMcpTool).useClass(SetPersonaStoryStateMcpTool).asSingleton();
    registry.register(AddPersonaStoryDetailMcpTool).useClass(AddPersonaStoryDetailMcpTool).asSingleton();
    registry.register(UpdatePersonaStoryDetailMcpTool).useClass(UpdatePersonaStoryDetailMcpTool).asSingleton();
    registry.register(DeletePersonaStoryDetailMcpTool).useClass(DeletePersonaStoryDetailMcpTool).asSingleton();
    registry.register(SetPersonaStoryDetailStateMcpTool).useClass(SetPersonaStoryDetailStateMcpTool).asSingleton();
    registry.register(AddPersonaStoryBeatMcpTool).useClass(AddPersonaStoryBeatMcpTool).asSingleton();
    registry.register(UpdatePersonaStoryBeatMcpTool).useClass(UpdatePersonaStoryBeatMcpTool).asSingleton();
    registry.register(DeletePersonaStoryBeatMcpTool).useClass(DeletePersonaStoryBeatMcpTool).asSingleton();
    registry.register(SetPersonaStoryBeatStateMcpTool).useClass(SetPersonaStoryBeatStateMcpTool).asSingleton();
    registry.register(ReadPersonaMemoryMcpTool).useClass(ReadPersonaMemoryMcpTool).asSingleton();
    registry.register(PreviewPersonaMemoryRollbackMcpTool).useClass(PreviewPersonaMemoryRollbackMcpTool).asSingleton();
    registry.register(RollBackPersonaMemoryMcpTool).useClass(RollBackPersonaMemoryMcpTool).asSingleton();
}
