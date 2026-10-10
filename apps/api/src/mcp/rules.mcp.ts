// Auto-generated MCP tools
// generated from [rules.ck](../../data/contracts/director/rules.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { BlockRulesService } from '#src/modules/director/block.rules.service.js';
import { BlockRuleInput, BlockRuleList, GenreSteerInput, GenreSteerReading } from '../modules/director/types/rules.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListNeverPlayRulesArgs = z.object({});
const AddANeverPlayRuleArgs = z.object({ body: BlockRuleInput });
const ReadTheGenreSteerArgs = z.object({});
const SteerTowardGenresArgs = z.object({ body: GenreSteerInput });
const StopSteeringArgs = z.object({});
const ChangeANeverPlayRuleArgs = z.object({ id: z.uuid(), body: BlockRuleInput });
const RemoveANeverPlayRuleArgs = z.object({ id: z.uuid() });

/**
 * from [rules.ck](../../data/contracts/director/rules.ck) `GET /rules`
 */
@Injectable()
export class ListNeverPlayRulesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_never_play_rules',
        description: 'Every never-play rule on this station, newest first, each saying whether it holds right now',
        inputSchema: z.toJSONSchema(ListNeverPlayRulesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(BlockRuleList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(BlockRulesService).list();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [rules.ck](../../data/contracts/director/rules.ck) `POST /rules`
 */
@Injectable()
export class AddANeverPlayRuleMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'add_a_never_play_rule',
        description: 'Adds a rule. It holds from the next record the station chooses',
        inputSchema: z.toJSONSchema(AddANeverPlayRuleArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(BlockRuleList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, AddANeverPlayRuleArgs);
        const result = await container.get(BlockRulesService).add(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [rules.ck](../../data/contracts/director/rules.ck) `GET /rules/steer`
 */
@Injectable()
export class ReadTheGenreSteerMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_the_genre_steer',
        description: 'The lean in force, if any',
        inputSchema: z.toJSONSchema(ReadTheGenreSteerArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(GenreSteerReading, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(BlockRulesService).readSteer();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [rules.ck](../../data/contracts/director/rules.ck) `PUT /rules/steer`
 */
@Injectable()
export class SteerTowardGenresMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'steer_toward_genres',
        description: 'Leans the station toward some genres for a number of hours, replacing any lean already in force',
        inputSchema: z.toJSONSchema(SteerTowardGenresArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(GenreSteerReading, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, SteerTowardGenresArgs);
        const result = await container.get(BlockRulesService).steer(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [rules.ck](../../data/contracts/director/rules.ck) `DELETE /rules/steer`
 */
@Injectable()
export class StopSteeringMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'stop_steering',
        description: 'Ends the lean now',
        inputSchema: z.toJSONSchema(StopSteeringArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(GenreSteerReading, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(BlockRulesService).stopSteering();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [rules.ck](../../data/contracts/director/rules.ck) `PUT /rules/{id}`
 */
@Injectable()
export class ChangeANeverPlayRuleMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'change_a_never_play_rule',
        description: 'Replaces a rule',
        inputSchema: z.toJSONSchema(ChangeANeverPlayRuleArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(BlockRuleList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, ChangeANeverPlayRuleArgs);
        const result = await container.get(BlockRulesService).change(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [rules.ck](../../data/contracts/director/rules.ck) `DELETE /rules/{id}`
 */
@Injectable()
export class RemoveANeverPlayRuleMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'remove_a_never_play_rule',
        description: 'Removes a rule',
        inputSchema: z.toJSONSchema(RemoveANeverPlayRuleArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(BlockRuleList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, RemoveANeverPlayRuleArgs);
        const result = await container.get(BlockRulesService).remove(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerRulesMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_never_play_rules', container.get(ListNeverPlayRulesMcpTool));
    map.set('add_a_never_play_rule', container.get(AddANeverPlayRuleMcpTool));
    map.set('read_the_genre_steer', container.get(ReadTheGenreSteerMcpTool));
    map.set('steer_toward_genres', container.get(SteerTowardGenresMcpTool));
    map.set('stop_steering', container.get(StopSteeringMcpTool));
    map.set('change_a_never_play_rule', container.get(ChangeANeverPlayRuleMcpTool));
    map.set('remove_a_never_play_rule', container.get(RemoveANeverPlayRuleMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerRulesMcpToolClasses(registry: Registry): void {
    registry.register(ListNeverPlayRulesMcpTool).useClass(ListNeverPlayRulesMcpTool).asSingleton();
    registry.register(AddANeverPlayRuleMcpTool).useClass(AddANeverPlayRuleMcpTool).asSingleton();
    registry.register(ReadTheGenreSteerMcpTool).useClass(ReadTheGenreSteerMcpTool).asSingleton();
    registry.register(SteerTowardGenresMcpTool).useClass(SteerTowardGenresMcpTool).asSingleton();
    registry.register(StopSteeringMcpTool).useClass(StopSteeringMcpTool).asSingleton();
    registry.register(ChangeANeverPlayRuleMcpTool).useClass(ChangeANeverPlayRuleMcpTool).asSingleton();
    registry.register(RemoveANeverPlayRuleMcpTool).useClass(RemoveANeverPlayRuleMcpTool).asSingleton();
}
