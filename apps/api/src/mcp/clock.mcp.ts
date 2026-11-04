// Auto-generated MCP tools
// generated from [clock.ck](../../data/contracts/director/clock.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { ClockService } from '#src/modules/director/clock.service.js';
import { ClockBandInput, ClockBandList, ClockImportResult, ClockPack } from '../modules/director/types/clock.types.js';
import { PackImportPlan } from '../modules/topics/types/topics.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ExportClockArgs = z.object({});
const PreviewClockImportArgs = z.object({ body: ClockPack });
const ImportClockArgs = z.object({ body: ClockPack });
const ListClockBandsArgs = z.object({});
const CreateClockBandArgs = z.object({ body: ClockBandInput });
const UpdateClockBandArgs = z.object({ id: z.string().min(1).max(100), body: ClockBandInput });
const DeleteClockBandArgs = z.object({ id: z.string().min(1).max(100) });

/**
 * from [clock.ck](../../data/contracts/director/clock.ck) `GET /clock/export`
 */
@Injectable()
export class ExportClockMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'export_clock',
        description: "This station's format clock as one file, to hand to another station",
        inputSchema: z.toJSONSchema(ExportClockArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ClockPack, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(ClockService).exportPack();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [clock.ck](../../data/contracts/director/clock.ck) `POST /clock/import/preview`
 */
@Injectable()
export class PreviewClockImportMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'preview_clock_import',
        description: 'Reads a file and reports what importing it would add, skip and leave out. Writes nothing',
        inputSchema: z.toJSONSchema(PreviewClockImportArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PackImportPlan, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, PreviewClockImportArgs);
        const result = await container.get(ClockService).previewImport(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [clock.ck](../../data/contracts/director/clock.ck) `POST /clock/import`
 */
@Injectable()
export class ImportClockMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'import_clock',
        description:
            "Adds the bands in a file after this station's own, switched off, with any subject they need. Changes nothing the station already has",
        inputSchema: z.toJSONSchema(ImportClockArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ClockImportResult, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, ImportClockArgs);
        const result = await container.get(ClockService).importPack(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [clock.ck](../../data/contracts/director/clock.ck) `GET /clock/bands`
 */
@Injectable()
export class ListClockBandsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_clock_bands',
        description: "Every band on this station's clock, including the ones switched off, in the operator's own order",
        inputSchema: z.toJSONSchema(ListClockBandsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ClockBandList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(ClockService).list();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [clock.ck](../../data/contracts/director/clock.ck) `POST /clock/bands`
 */
@Injectable()
export class CreateClockBandMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'create_clock_band',
        description: 'Adds a band. It claims its first boundary on the next commit pass',
        inputSchema: z.toJSONSchema(CreateClockBandArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ClockBandList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, CreateClockBandArgs);
        const result = await container.get(ClockService).create(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [clock.ck](../../data/contracts/director/clock.ck) `PUT /clock/bands/{id}`
 */
@Injectable()
export class UpdateClockBandMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'update_clock_band',
        description: 'Rewrites one band. Breaks it has already planted stay where they are: the running order is the memory',
        inputSchema: z.toJSONSchema(UpdateClockBandArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ClockBandList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, UpdateClockBandArgs);
        const result = await container.get(ClockService).update(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [clock.ck](../../data/contracts/director/clock.ck) `DELETE /clock/bands/{id}`
 */
@Injectable()
export class DeleteClockBandMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_clock_band',
        description: 'Removes a band, which costs it the boundaries it had not claimed yet and nothing else',
        inputSchema: z.toJSONSchema(DeleteClockBandArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ClockBandList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, DeleteClockBandArgs);
        const result = await container.get(ClockService).remove(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerClockMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('export_clock', container.get(ExportClockMcpTool));
    map.set('preview_clock_import', container.get(PreviewClockImportMcpTool));
    map.set('import_clock', container.get(ImportClockMcpTool));
    map.set('list_clock_bands', container.get(ListClockBandsMcpTool));
    map.set('create_clock_band', container.get(CreateClockBandMcpTool));
    map.set('update_clock_band', container.get(UpdateClockBandMcpTool));
    map.set('delete_clock_band', container.get(DeleteClockBandMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerClockMcpToolClasses(registry: Registry): void {
    registry.register(ExportClockMcpTool).useClass(ExportClockMcpTool).asSingleton();
    registry.register(PreviewClockImportMcpTool).useClass(PreviewClockImportMcpTool).asSingleton();
    registry.register(ImportClockMcpTool).useClass(ImportClockMcpTool).asSingleton();
    registry.register(ListClockBandsMcpTool).useClass(ListClockBandsMcpTool).asSingleton();
    registry.register(CreateClockBandMcpTool).useClass(CreateClockBandMcpTool).asSingleton();
    registry.register(UpdateClockBandMcpTool).useClass(UpdateClockBandMcpTool).asSingleton();
    registry.register(DeleteClockBandMcpTool).useClass(DeleteClockBandMcpTool).asSingleton();
}
