// Auto-generated MCP tools
// generated from [stream.archive.ck](../../data/contracts/stream/stream.archive.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { ArchiveService } from '#src/modules/stream/archive.service.js';
import { RecordingList } from '../modules/stream/types/stream.archive.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListRecordingsArgs = z.object({});
const DeleteRecordingArgs = z.object({ id: z.string().min(1).max(64) });

/**
 * from [stream.archive.ck](../../data/contracts/stream/stream.archive.ck) `GET /archive/recordings`
 */
@Injectable()
export class ListRecordingsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_recordings',
        description: 'Every recording in the archive, newest first',
        inputSchema: z.toJSONSchema(ListRecordingsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(RecordingList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(ArchiveService).listRecordings();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [stream.archive.ck](../../data/contracts/stream/stream.archive.ck) `DELETE /archive/recordings/{id}`
 */
@Injectable()
export class DeleteRecordingMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_recording',
        description: 'Deletes a finished recording. One still being recorded is refused',
        inputSchema: z.toJSONSchema(DeleteRecordingArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, DeleteRecordingArgs);
        await container.get(ArchiveService).deleteRecording(id);
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerStreamArchiveMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_recordings', container.get(ListRecordingsMcpTool));
    map.set('delete_recording', container.get(DeleteRecordingMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerStreamArchiveMcpToolClasses(registry: Registry): void {
    registry.register(ListRecordingsMcpTool).useClass(ListRecordingsMcpTool).asSingleton();
    registry.register(DeleteRecordingMcpTool).useClass(DeleteRecordingMcpTool).asSingleton();
}
