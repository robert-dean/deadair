// Auto-generated MCP tools
// generated from [personas.auditions.ck](../../data/contracts/personas/personas.auditions.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { PersonaAuditionService } from '#src/modules/personas/persona.audition.service.js';
import { PersonaAudition, PersonaAuditionList, PersonaAuditionRequest, PersonaAuditionSummary } from '../modules/personas/types/personas.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListPersonaAuditionsArgs = z.object({ id: z.string().min(1).max(100) });
const StartPersonaAuditionArgs = z.object({ id: z.string().min(1).max(100), body: PersonaAuditionRequest });
const GetPersonaAuditionArgs = z.object({ id: z.string().min(1).max(100), auditionId: z.string().min(1).max(100) });
const CancelPersonaAuditionArgs = z.object({ id: z.string().min(1).max(100), auditionId: z.string().min(1).max(100) });

/**
 * from [personas.auditions.ck](../../data/contracts/personas/personas.auditions.ck#L42)
 */
@Injectable()
export class ListPersonaAuditionsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_persona_auditions',
        description: 'Every audition of this character, newest first, without their breaks',
        inputSchema: z.toJSONSchema(ListPersonaAuditionsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaAuditionList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id } = await parseAndValidate(args, ListPersonaAuditionsArgs);
        const result = await container.get(PersonaAuditionService).list(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.auditions.ck](../../data/contracts/personas/personas.auditions.ck#L55)
 */
@Injectable()
export class StartPersonaAuditionMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'start_persona_audition',
        description: 'Asks the station to put this character through a playlist. It is queued, not written',
        inputSchema: z.toJSONSchema(StartPersonaAuditionArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaAudition, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, StartPersonaAuditionArgs);
        const result = await container.get(PersonaAuditionService).start(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.auditions.ck](../../data/contracts/personas/personas.auditions.ck#L74)
 */
@Injectable()
export class GetPersonaAuditionMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_persona_audition',
        description: 'One audition with every break it has written so far, in order',
        inputSchema: z.toJSONSchema(GetPersonaAuditionArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaAudition, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id, auditionId } = await parseAndValidate(args, GetPersonaAuditionArgs);
        const result = await container.get(PersonaAuditionService).get(id, auditionId);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [personas.auditions.ck](../../data/contracts/personas/personas.auditions.ck#L98)
 */
@Injectable()
export class CancelPersonaAuditionMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'cancel_persona_audition',
        description: 'Stops an audition where it stands, keeping the breaks it has already written',
        inputSchema: z.toJSONSchema(CancelPersonaAuditionArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaAuditionSummary, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, auditionId } = await parseAndValidate(args, CancelPersonaAuditionArgs);
        const result = await container.get(PersonaAuditionService).cancel(id, auditionId);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerPersonasAuditionsMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_persona_auditions', container.get(ListPersonaAuditionsMcpTool));
    map.set('start_persona_audition', container.get(StartPersonaAuditionMcpTool));
    map.set('get_persona_audition', container.get(GetPersonaAuditionMcpTool));
    map.set('cancel_persona_audition', container.get(CancelPersonaAuditionMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerPersonasAuditionsMcpToolClasses(registry: Registry): void {
    registry.register(ListPersonaAuditionsMcpTool).useClass(ListPersonaAuditionsMcpTool).asSingleton();
    registry.register(StartPersonaAuditionMcpTool).useClass(StartPersonaAuditionMcpTool).asSingleton();
    registry.register(GetPersonaAuditionMcpTool).useClass(GetPersonaAuditionMcpTool).asSingleton();
    registry.register(CancelPersonaAuditionMcpTool).useClass(CancelPersonaAuditionMcpTool).asSingleton();
}
