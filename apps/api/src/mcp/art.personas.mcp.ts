// Auto-generated MCP tools
// generated from [art.personas.ck](../../data/contracts/art/art.personas.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { PersonaArtworkService } from '#src/modules/art/persona.artwork.service.js';
import { PersonaPortraitList } from '../modules/art/types/art.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListPersonaPortraitsArgs = z.object({});
const RemovePersonaPortraitArgs = z.object({ personaId: z.uuid() });

/**
 * from [art.personas.ck](../../data/contracts/art/art.personas.ck) `GET /art/personas`
 */
@Injectable()
export class ListPersonaPortraitsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_persona_portraits',
        description: 'Every persona that has a portrait',
        inputSchema: z.toJSONSchema(ListPersonaPortraitsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaPortraitList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(PersonaArtworkService).listPortraits();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [art.personas.ck](../../data/contracts/art/art.personas.ck) `DELETE /art/personas/{personaId}`
 */
@Injectable()
export class RemovePersonaPortraitMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'remove_persona_portrait',
        description: "Takes a persona's picture away. A player shows the record's cover instead",
        inputSchema: z.toJSONSchema(RemovePersonaPortraitArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PersonaPortraitList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { personaId } = await parseAndValidate(args, RemovePersonaPortraitArgs);
        const result = await container.get(PersonaArtworkService).removePortrait(personaId);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerArtPersonasMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_persona_portraits', container.get(ListPersonaPortraitsMcpTool));
    map.set('remove_persona_portrait', container.get(RemovePersonaPortraitMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerArtPersonasMcpToolClasses(registry: Registry): void {
    registry.register(ListPersonaPortraitsMcpTool).useClass(ListPersonaPortraitsMcpTool).asSingleton();
    registry.register(RemovePersonaPortraitMcpTool).useClass(RemovePersonaPortraitMcpTool).asSingleton();
}
