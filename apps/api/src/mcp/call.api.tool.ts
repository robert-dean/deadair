import { Injectable } from 'injectkit';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { getOAuthSessionClaim } from '@maroonedsoftware/authentication';
import { requireMcpAuthenticationSession, type McpToolContext, type McpToolHandler } from '@maroonedsoftware/mcp';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { McpToolCatalog } from './mcp.tools.js';
import { catalogEntries, closestNames, didYouMean, mayUse, type CatalogEntry } from './api.catalog.js';

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
 * Several READS may go in one call, under `calls`, because "what is on now, what is next and what is
 * queued" is three round trips otherwise and a model answering a person pays each one. Writes stay one
 * to a call: a batch the person agreed to as a whole would turn "confirm before anything destructive"
 * into one yes for several changes, so a batch naming anything that is not read-only is refused before
 * any of it runs. Each read answers on its own, a refusal beside a success, and they share the size
 * ceiling, so a batch costs no more context than one call may.
 *
 * Every call is logged once, with the operation, the grant and the outcome, so what connected apps
 * actually do with the station can be read back and the listed set grown from it. A batch logs each
 * read it ran.
 */
@Injectable()
export class CallApiTool implements McpToolHandler {
    readonly definition: Tool = {
        name: CALL_API_TOOL,
        title: 'Call a station operation',
        description: `Runs a station operation found with search_api, as the person who connected this app. Get the operation's arguments from search_api with its name first. Before running one whose index entry says destructive: true, confirm with the person. Pass fields to keep only those keys of each record in a long answer; an answer too long to return whole keeps as many records as fit and says how many there were. To run up to ${BATCH_LIMIT} read-only operations at once, pass calls instead of name; each answers on its own, and a batch with anything that changes the station in it is refused.`,
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The operation, exactly as search_api names it.' },
                arguments: {
                    type: 'object',
                    description: 'Its arguments: path parameters at the top level, a request body under body, query parameters under query.',
                },
                fields: { type: 'array', items: { type: 'string' }, description: 'Keep only these keys of each record in the answer.' },
                calls: {
                    type: 'array',
                    maxItems: BATCH_LIMIT,
                    description: `Up to ${BATCH_LIMIT} read-only operations to run together, in place of name, each with its own arguments and fields.`,
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            arguments: { type: 'object' },
                            fields: { type: 'array', items: { type: 'string' } },
                        },
                        required: ['name'],
                    },
                },
            },
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    };

    private entries?: CatalogEntry[];

    constructor(private readonly catalog: McpToolCatalog) {}

    async handle(args: Json, context: McpToolContext): Promise<CallToolResult> {
        requireMcpAuthenticationSession(context);
        if (args.calls !== undefined) return this.batch(args.calls, context);
        return this.one(asCall(args), context, RESULT_CHAR_LIMIT);
    }

    /** One operation, run, logged and shaped to `limit` characters. */
    private async one(call: Call, context: McpToolContext, limit: number): Promise<CallToolResult> {
        const handler = this.catalog.get(call.name);
        if (!handler) return this.unknown(call.name, context);

        const started = Date.now();
        const result = await handler.handle(call.arguments, { ...context, toolName: call.name });
        context.logger.info('mcp: call_api', {
            operation: call.name,
            grantId: getOAuthSessionClaim(requireMcpAuthenticationSession(context))?.grantId,
            outcome: result.isError ? 'refused' : 'ok',
            ms: Date.now() - started,
        });

        if (result.isError || !isObject(result.structuredContent)) return result;
        return shape(result.structuredContent, call.fields, limit);
    }

    /**
     * Several reads, checked whole before any runs: too many, or one that is not read-only, refuses the
     * batch. Run one after another rather than at once, since they share the request's one transaction.
     */
    private async batch(calls: unknown, context: McpToolContext): Promise<CallToolResult> {
        if (!Array.isArray(calls) || calls.length === 0) return refusal('calls must be a list of at least one { name, arguments, fields }.');
        if (calls.length > BATCH_LIMIT) return refusal(`A batch takes at most ${BATCH_LIMIT} calls; this one had ${calls.length}. Split it.`);

        const parsed = calls.map(call => asCall(isObject(call) ? call : {}));
        const entries = this.allEntries();
        const writes = parsed.filter(call => {
            const entry = entries.find(candidate => candidate.name === call.name);
            return entry !== undefined && !entry.readOnly;
        });
        if (writes.length > 0) {
            return refusal(
                `A batch may only read, and ${writes.map(call => call.name).join(', ')} changes the station. Run each change on its own with name, after confirming it with the person.`,
            );
        }

        const share = Math.floor(RESULT_CHAR_LIMIT / parsed.length);
        const results: Json[] = [];
        for (const call of parsed) {
            const result = await this.one(call, context, share);
            results.push(
                result.isError
                    ? { name: call.name, ok: false, error: textOf(result), ...(isObject(result.structuredContent) ? result.structuredContent : {}) }
                    : { name: call.name, ok: true, answer: result.structuredContent ?? textOf(result) },
            );
        }
        return reply({ results });
    }

    /**
     * A name that is no operation, answered with the closest ones this caller may use, so a near miss
     * (`list_album`) costs the model one corrected call rather than a search first. Only operations the
     * caller's role and grant allow are suggested, as `search_api` offers only those.
     */
    private unknown(name: string, context: McpToolContext): CallToolResult {
        const actor = context.container?.get(AuthorizationContext).requireUser();
        const usable = actor === undefined ? [] : this.allEntries().filter(entry => mayUse(actor, entry.access));
        const suggestions = name === '' ? [] : closestNames(usable, name);
        return {
            isError: true,
            content: [{ type: 'text', text: `No operation is called ${name || '(no name)'}.${didYouMean(suggestions)} Use search_api to find one.` }],
            structuredContent: { suggestions },
        };
    }

    private allEntries(): CatalogEntry[] {
        this.entries ??= catalogEntries(this.catalog.values());
        return this.entries;
    }
}

/** The most reads one batch may hold. */
export const BATCH_LIMIT = 5;

interface Call {
    name: string;
    arguments: Json;
    fields: string[];
}

const asCall = (args: Json): Call => ({
    name: typeof args.name === 'string' ? args.name : '',
    arguments: isObject(args.arguments) ? args.arguments : {},
    fields: Array.isArray(args.fields) ? args.fields.filter((field): field is string => typeof field === 'string') : [],
});

const textOf = (result: CallToolResult): string => result.content.map(part => (part.type === 'text' ? part.text : '')).join('\n');

const refusal = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] });

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

/** The answer with its records projected to `fields`, and cut to whole records under `limit` characters. */
export function shape(answer: Json, fields: ReadonlyArray<string>, limit = RESULT_CHAR_LIMIT): CallToolResult {
    const key = recordsKey(answer);
    if (key === undefined) return reply(fields.length === 0 ? answer : (pick(answer, fields) as Json));

    const records = (answer[key] as unknown[]).map(record => pick(record, fields));
    let shown = records.length;
    let shaped: Json = { ...answer, [key]: records };
    while (JSON.stringify(shaped).length > limit && shown > 0) {
        // Halving then stepping keeps a very long list from being measured once per record.
        shown = JSON.stringify(shaped).length > limit * 2 ? Math.floor(shown / 2) : shown - 1;
        shaped = {
            ...answer,
            [key]: records.slice(0, shown),
            truncated: { shown, of: records.length, hint: 'Pass fields, or narrow the query, to see more.' },
        };
    }
    return reply(shaped);
}

const reply = (answer: Json): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(answer) }], structuredContent: answer });
