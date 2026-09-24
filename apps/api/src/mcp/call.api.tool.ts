import { Injectable } from 'injectkit';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { getOAuthSessionClaim } from '@maroonedsoftware/authentication';
import { requireMcpAuthenticationSession, type McpToolContext, type McpToolHandler } from '@maroonedsoftware/mcp';
import { McpToolCatalog } from './mcp.tools.js';

export const CALL_API_TOOL = 'call_api';

/** The most a result may carry before whole records are dropped from its end. */
export const RESULT_CHAR_LIMIT = 12_000;

type Json = Record<string, unknown>;

/**
 * Runs any station operation `search_api` found, as the caller, with the same checks the operation's
 * own route makes: the handler is the generated one, so its policy, its validation and its service all
 * run exactly as they would for a listed tool, and every one is wrapped by `explainToolErrors`, so a
 * refusal comes back as a result the model can read ("not allowed, it needs the manage scope").
 *
 * What it adds is what a model needs from an API it did not choose the shape of: `fields` to keep
 * only the parts of each record it asked for, and a ceiling on the size of an answer that drops whole
 * records from the end and says how many there were, rather than cutting one in half.
 *
 * Every call is logged once, with the operation, the grant and the outcome, so what connected apps
 * actually do with the station can be read back and the listed set grown from it.
 */
@Injectable()
export class CallApiTool implements McpToolHandler {
    readonly definition: Tool = {
        name: CALL_API_TOOL,
        title: 'Call a station operation',
        description:
            "Runs one station operation found with search_api, as the person who connected this app. Get the operation's arguments from search_api with its name first. Before running one whose index entry says destructive: true, confirm with the person. Pass fields to keep only those keys of each record in a long answer; an answer too long to return whole keeps as many records as fit and says how many there were.",
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The operation, exactly as search_api names it.' },
                arguments: {
                    type: 'object',
                    description: 'Its arguments: path parameters at the top level, a request body under body, query parameters under query.',
                },
                fields: { type: 'array', items: { type: 'string' }, description: 'Keep only these keys of each record in the answer.' },
            },
            required: ['name'],
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    };

    constructor(private readonly catalog: McpToolCatalog) {}

    async handle(args: Json, context: McpToolContext): Promise<CallToolResult> {
        const session = requireMcpAuthenticationSession(context);
        const name = typeof args.name === 'string' ? args.name : '';
        const handler = this.catalog.get(name);
        if (!handler) {
            return { isError: true, content: [{ type: 'text', text: `No operation is called ${name || '(no name)'}. Use search_api to find one.` }] };
        }

        const started = Date.now();
        const result = await handler.handle(isObject(args.arguments) ? args.arguments : {}, { ...context, toolName: name });
        context.logger.info('mcp: call_api', {
            operation: name,
            grantId: getOAuthSessionClaim(session)?.grantId,
            outcome: result.isError ? 'refused' : 'ok',
            ms: Date.now() - started,
        });

        if (result.isError || !isObject(result.structuredContent)) return result;
        const fields = Array.isArray(args.fields) ? args.fields.filter((field): field is string => typeof field === 'string') : [];
        return shape(result.structuredContent, fields);
    }
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Where the records of an answer are: a list result's `items`, or else the first array-valued key of a
 * page (`{ items, total }`, `{ tracks, ... }`). An answer with none is one record, and is left whole.
 */
const recordsKey = (answer: Json): string | undefined => Object.keys(answer).find(key => Array.isArray(answer[key]));

const pick = (record: unknown, fields: ReadonlyArray<string>): unknown =>
    fields.length === 0 || !isObject(record)
        ? record
        : Object.fromEntries(fields.filter(field => field in record).map(field => [field, record[field]]));

/** The answer with its records projected to `fields`, and cut to whole records under the limit. */
export function shape(answer: Json, fields: ReadonlyArray<string>): CallToolResult {
    const key = recordsKey(answer);
    if (key === undefined) return reply(fields.length === 0 ? answer : (pick(answer, fields) as Json));

    const records = (answer[key] as unknown[]).map(record => pick(record, fields));
    let shown = records.length;
    let shaped: Json = { ...answer, [key]: records };
    while (JSON.stringify(shaped).length > RESULT_CHAR_LIMIT && shown > 0) {
        // Halving then stepping keeps a very long list from being measured once per record.
        shown = JSON.stringify(shaped).length > RESULT_CHAR_LIMIT * 2 ? Math.floor(shown / 2) : shown - 1;
        shaped = {
            ...answer,
            [key]: records.slice(0, shown),
            truncated: { shown, of: records.length, hint: 'Pass fields, or narrow the query, to see more.' },
        };
    }
    return reply(shaped);
}

const reply = (answer: Json): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(answer) }], structuredContent: answer });
