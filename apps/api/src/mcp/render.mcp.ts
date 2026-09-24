// Auto-generated MCP tools
// generated from [render.ck](../../data/contracts/render/render.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { RenderService } from '#src/modules/render/render.service.js';
import {
    PadFetch,
    PadList,
    PadScanResult,
    PadSetMembership,
    PadSetWrite,
    PadState,
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
    VoiceList,
} from '../modules/render/types/render.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListSegmentsArgs = z.object({});
const CreateSegmentArgs = z.object({ body: SegmentCreate });
const ScanTheSegmentInboxArgs = z.object({});
const ReadScriptHistoryArgs = z.object({ query: ScriptHistoryQuery.optional() });
const RateScriptArgs = z.object({ id: z.uuid(), body: ScriptRatingInput });
const ReadScriptSummaryArgs = z.object({ query: ScriptHistorySummaryQuery.optional() });
const ListVoicesArgs = z.object({});
const DeleteSegmentArgs = z.object({ id: z.uuid() });
const ListPronunciationsArgs = z.object({ query: PronunciationQuery.optional() });
const CreatePronunciationArgs = z.object({ body: PronunciationWrite });
const UpdatePronunciationArgs = z.object({ id: z.uuid(), body: PronunciationWrite });
const DeletePronunciationArgs = z.object({ id: z.uuid() });
const SetPronunciationStateArgs = z.object({ id: z.uuid(), body: PronunciationStateWrite });
const ListPadsArgs = z.object({});
const ScanThePadLibraryArgs = z.object({});
const FetchPadArgs = z.object({ body: PadFetch });
const DeletePadArgs = z.object({ id: z.uuid() });
const SetPadStateArgs = z.object({ id: z.uuid(), body: PadState });
const CreatePadSetArgs = z.object({ body: PadSetWrite });
const UpdatePadSetArgs = z.object({ id: z.uuid(), body: PadSetWrite });
const DeletePadSetArgs = z.object({ id: z.uuid() });
const SetPadMembershipArgs = z.object({ id: z.uuid(), body: PadSetMembership });

/**
 * from [render.ck](../../data/contracts/render/render.ck#L28)
 */
@Injectable()
export class ListSegmentsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_segments',
        description: 'Everything the station can play that is not a record',
        inputSchema: z.toJSONSchema(ListSegmentsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(SegmentList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(RenderService).listSegments();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L37)
 */
@Injectable()
export class CreateSegmentMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'create_segment',
        description: 'Plans something for the station to say, and starts rendering it',
        inputSchema: z.toJSONSchema(CreateSegmentArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Segment, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, CreateSegmentArgs);
        const result = await container.get(RenderService).createSegment(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L85)
 */
@Injectable()
export class ScanTheSegmentInboxMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'scan_the_segment_inbox',
        description:
            'Takes whatever audio is sitting in the inbox directory into the library. Safe to repeat: a segment is identified by its audio, so the same recording arriving twice is one segment',
        inputSchema: z.toJSONSchema(ScanTheSegmentInboxArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(SegmentScanResult, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(RenderService).scanLibrary();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L110)
 */
@Injectable()
export class ReadScriptHistoryMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_script_history',
        description: 'What the station has written lately, newest first, one page at a time',
        inputSchema: z.toJSONSchema(ReadScriptHistoryArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ScriptHistoryPage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { query = await parseAndValidate({}, ReadScriptHistoryArgs.shape.query.unwrap()) } = await parseAndValidate(
            args,
            ReadScriptHistoryArgs,
        );
        const result = await container.get(RenderService).readScriptHistory(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L146)
 */
@Injectable()
export class RateScriptMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'rate_script',
        description: 'What the operator thought of this attempt. Nothing acts on it automatically',
        inputSchema: z.toJSONSchema(RateScriptArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ScriptAttempt, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, RateScriptArgs);
        const result = await container.get(RenderService).rateScript(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L167)
 */
@Injectable()
export class ReadScriptSummaryMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'read_script_summary',
        description: 'Write attempts by outcome, per presenter, over a recent window',
        inputSchema: z.toJSONSchema(ReadScriptSummaryArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ScriptHistorySummary, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { query = await parseAndValidate({}, ReadScriptSummaryArgs.shape.query.unwrap()) } = await parseAndValidate(
            args,
            ReadScriptSummaryArgs,
        );
        const result = await container.get(RenderService).readScriptSummary(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L180)
 */
@Injectable()
export class ListVoicesMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_voices',
        description: 'The voices the station can be asked to speak in',
        inputSchema: z.toJSONSchema(ListVoicesArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(VoiceList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(RenderService).listVoices();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L300)
 */
@Injectable()
export class DeleteSegmentMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_segment',
        description: 'Removes a recording and the inbox file behind it, so the next scan does not read it back in',
        inputSchema: z.toJSONSchema(DeleteSegmentArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(SegmentList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, DeleteSegmentArgs);
        const result = await container.get(RenderService).deleteSegment(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L417)
 */
@Injectable()
export class ListPronunciationsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_pronunciations',
        description: "The station's lexicon: what it says, what has been proposed to it, and what it has turned down",
        inputSchema: z.toJSONSchema(ListPronunciationsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PronunciationList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { query = await parseAndValidate({}, ListPronunciationsArgs.shape.query.unwrap()) } = await parseAndValidate(
            args,
            ListPronunciationsArgs,
        );
        const result = await container.get(RenderService).listPronunciations(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L427)
 */
@Injectable()
export class CreatePronunciationMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'create_pronunciation',
        description: 'Adds one the operator typed. It is said from the next render on',
        inputSchema: z.toJSONSchema(CreatePronunciationArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PronunciationList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, CreatePronunciationArgs);
        const result = await container.get(RenderService).createPronunciation(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L448)
 */
@Injectable()
export class UpdatePronunciationMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'update_pronunciation',
        description: "Rewrites one entry's words, whoever proposed it",
        inputSchema: z.toJSONSchema(UpdatePronunciationArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PronunciationList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, UpdatePronunciationArgs);
        const result = await container.get(RenderService).updatePronunciation(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L463)
 */
@Injectable()
export class DeletePronunciationMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_pronunciation',
        description:
            'Removes an entry outright. Turning a PROPOSAL down is a state rather than a deletion, because a deleted one comes back on the next pass',
        inputSchema: z.toJSONSchema(DeletePronunciationArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PronunciationList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, DeletePronunciationArgs);
        const result = await container.get(RenderService).deletePronunciation(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L481)
 */
@Injectable()
export class SetPronunciationStateMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'set_pronunciation_state',
        description: 'Accepts a proposal, turns one down, or takes an entry out of use without losing what it said',
        inputSchema: z.toJSONSchema(SetPronunciationStateArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PronunciationList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, SetPronunciationStateArgs);
        const result = await container.get(RenderService).setPronunciationState(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L513)
 */
@Injectable()
export class ListPadsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_pads',
        description: 'Every sound the station holds, board by board',
        inputSchema: z.toJSONSchema(ListPadsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PadList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const result = await container.get(RenderService).listPads();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L551)
 */
@Injectable()
export class ScanThePadLibraryMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'scan_the_pad_library',
        description:
            'Takes whatever audio is sitting in the pad library directory onto its board. Safe to repeat: a file nobody has touched is seen and left alone',
        inputSchema: z.toJSONSchema(ScanThePadLibraryArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PadScanResult, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const result = await container.get(RenderService).scanPads();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L566)
 */
@Injectable()
export class FetchPadMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'fetch_pad',
        description:
            'Fetches a sound from an address and puts it on a board. The operator names the address, so this is them choosing a file exactly as dropping one in the library is',
        inputSchema: z.toJSONSchema(FetchPadArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PadList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, FetchPadArgs);
        const result = await container.get(RenderService).fetchPad(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L596)
 */
@Injectable()
export class DeletePadMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_pad',
        description: 'Removes a sound the console put there, and the file it wrote for it',
        inputSchema: z.toJSONSchema(DeletePadArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PadList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, DeletePadArgs);
        const result = await container.get(RenderService).deletePad(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L616)
 */
@Injectable()
export class SetPadStateMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'set_pad_state',
        description:
            'Turns a sound down, or puts one back. Answers the whole rack, since one pad changing state is one row moving between two sections of the same page',
        inputSchema: z.toJSONSchema(SetPadStateArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PadList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, SetPadStateArgs);
        const result = await container.get(RenderService).setPadState(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L666)
 */
@Injectable()
export class CreatePadSetMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'create_pad_set',
        description: 'Names a new set, or answers the one already under that key',
        inputSchema: z.toJSONSchema(CreatePadSetArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PadList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { body } = await parseAndValidate(args, CreatePadSetArgs);
        const result = await container.get(RenderService).createPadSet(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L687)
 */
@Injectable()
export class UpdatePadSetMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'update_pad_set',
        description: 'Renames a set. The KEY moves with it, so every persona naming the old one stops finding it',
        inputSchema: z.toJSONSchema(UpdatePadSetArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PadList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, UpdatePadSetArgs);
        const result = await container.get(RenderService).updatePadSet(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L702)
 */
@Injectable()
export class DeletePadSetMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_pad_set',
        description: 'Removes a set and its memberships, and no pads at all',
        inputSchema: z.toJSONSchema(DeletePadSetArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PadList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, DeletePadSetArgs);
        const result = await container.get(RenderService).deletePadSet(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [render.ck](../../data/contracts/render/render.ck#L720)
 */
@Injectable()
export class SetPadMembershipMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'set_pad_membership',
        description: 'Puts a pad on a set or takes it off. Refused where the set already answers to that name, because a script writes a name',
        inputSchema: z.toJSONSchema(SetPadMembershipArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(PadList, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, SetPadMembershipArgs);
        const result = await container.get(RenderService).setPadMembership(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerRenderMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_segments', container.get(ListSegmentsMcpTool));
    map.set('create_segment', container.get(CreateSegmentMcpTool));
    map.set('scan_the_segment_inbox', container.get(ScanTheSegmentInboxMcpTool));
    map.set('read_script_history', container.get(ReadScriptHistoryMcpTool));
    map.set('rate_script', container.get(RateScriptMcpTool));
    map.set('read_script_summary', container.get(ReadScriptSummaryMcpTool));
    map.set('list_voices', container.get(ListVoicesMcpTool));
    map.set('delete_segment', container.get(DeleteSegmentMcpTool));
    map.set('list_pronunciations', container.get(ListPronunciationsMcpTool));
    map.set('create_pronunciation', container.get(CreatePronunciationMcpTool));
    map.set('update_pronunciation', container.get(UpdatePronunciationMcpTool));
    map.set('delete_pronunciation', container.get(DeletePronunciationMcpTool));
    map.set('set_pronunciation_state', container.get(SetPronunciationStateMcpTool));
    map.set('list_pads', container.get(ListPadsMcpTool));
    map.set('scan_the_pad_library', container.get(ScanThePadLibraryMcpTool));
    map.set('fetch_pad', container.get(FetchPadMcpTool));
    map.set('delete_pad', container.get(DeletePadMcpTool));
    map.set('set_pad_state', container.get(SetPadStateMcpTool));
    map.set('create_pad_set', container.get(CreatePadSetMcpTool));
    map.set('update_pad_set', container.get(UpdatePadSetMcpTool));
    map.set('delete_pad_set', container.get(DeletePadSetMcpTool));
    map.set('set_pad_membership', container.get(SetPadMembershipMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerRenderMcpToolClasses(registry: Registry): void {
    registry.register(ListSegmentsMcpTool).useClass(ListSegmentsMcpTool).asSingleton();
    registry.register(CreateSegmentMcpTool).useClass(CreateSegmentMcpTool).asSingleton();
    registry.register(ScanTheSegmentInboxMcpTool).useClass(ScanTheSegmentInboxMcpTool).asSingleton();
    registry.register(ReadScriptHistoryMcpTool).useClass(ReadScriptHistoryMcpTool).asSingleton();
    registry.register(RateScriptMcpTool).useClass(RateScriptMcpTool).asSingleton();
    registry.register(ReadScriptSummaryMcpTool).useClass(ReadScriptSummaryMcpTool).asSingleton();
    registry.register(ListVoicesMcpTool).useClass(ListVoicesMcpTool).asSingleton();
    registry.register(DeleteSegmentMcpTool).useClass(DeleteSegmentMcpTool).asSingleton();
    registry.register(ListPronunciationsMcpTool).useClass(ListPronunciationsMcpTool).asSingleton();
    registry.register(CreatePronunciationMcpTool).useClass(CreatePronunciationMcpTool).asSingleton();
    registry.register(UpdatePronunciationMcpTool).useClass(UpdatePronunciationMcpTool).asSingleton();
    registry.register(DeletePronunciationMcpTool).useClass(DeletePronunciationMcpTool).asSingleton();
    registry.register(SetPronunciationStateMcpTool).useClass(SetPronunciationStateMcpTool).asSingleton();
    registry.register(ListPadsMcpTool).useClass(ListPadsMcpTool).asSingleton();
    registry.register(ScanThePadLibraryMcpTool).useClass(ScanThePadLibraryMcpTool).asSingleton();
    registry.register(FetchPadMcpTool).useClass(FetchPadMcpTool).asSingleton();
    registry.register(DeletePadMcpTool).useClass(DeletePadMcpTool).asSingleton();
    registry.register(SetPadStateMcpTool).useClass(SetPadStateMcpTool).asSingleton();
    registry.register(CreatePadSetMcpTool).useClass(CreatePadSetMcpTool).asSingleton();
    registry.register(UpdatePadSetMcpTool).useClass(UpdatePadSetMcpTool).asSingleton();
    registry.register(DeletePadSetMcpTool).useClass(DeletePadSetMcpTool).asSingleton();
    registry.register(SetPadMembershipMcpTool).useClass(SetPadMembershipMcpTool).asSingleton();
}
