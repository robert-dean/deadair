import type { LlmToolCall, LlmToolDeclaration } from '@deadair/plugin-sdk';
import type { StationTool } from './llm.tools.js';

/**
 * A tool call the model wrote as TEXT instead of as a call, read back out.
 *
 * ## The failure this exists for
 *
 * A conversation ends when a generation comes back with no tool calls, because that is what an
 * answer looks like. A local model does not always agree: measured on a `artists like mitch murder`
 * refill, the final assistant message was, in full,
 *
 * ```
 * {"artist":"Mitch Murder","limit":12}
 * ```
 *
 * which is the ARGUMENTS of a `similar_artists` call with no call around them. The loop read it as
 * an answer and stopped, `readPicks` found no record in it and returned nothing, and the hour was
 * filled by the brief-blind floor. The model had not refused and had not run out of anything: it
 * asked a question in the wrong envelope, one step before it would have answered.
 *
 * ## Why the rescue is here rather than in the parser
 *
 * `readPicks` is right to read that object as no records, and would still be right if it recognised
 * it — the words are not an answer and there is nothing in them to play. What the moment actually
 * wants is the call to be MADE, which only the loop holding the tools can do. So this identifies,
 * `LlmService.runConversation` re-issues, and the model gets its results and carries on with a step
 * spent rather than a refill lost.
 *
 * ## What it will and will not recognise
 *
 * The bar is deliberately high, because a false positive turns a station's real answer into a search
 * and loses it. Three rules do that work:
 *
 * - the whole message must be ONE JSON object and nothing else, so an answer that merely contains
 *   an object (a set generator's array of picks, a break that quotes something) is never touched;
 * - a named form (`{"name":"search_music","arguments":{…}}`) has to name a tool that is actually
 *   on offer;
 * - an unnamed form has to fit EXACTLY ONE offered tool — every key declared by it, every required
 *   parameter present. `{"limit":20}` fits four of them and is left alone, because guessing which
 *   one was meant is how a rescue starts inventing.
 *
 * The last rule is also what keeps a record out of it: `{"title":"…","artist":"…"}` declares a
 * `title` no tool takes, so a one-record answer cannot be mistaken for a `similar_artists` call.
 */

/** Where a named form keeps the tool's name. */
const NAME_KEYS = ['name', 'tool', 'tool_name', 'function'] as const;

/** Where a named form keeps the arguments. */
const ARGUMENT_KEYS = ['arguments', 'parameters', 'args', 'input'] as const;

/**
 * The call the model meant, or nothing.
 *
 * `step` only spells the id, which exists so the `tool` turn answering this can quote something. It
 * is the loop's step rather than a random value so the same transcript reads the same way twice.
 */
export function strayToolCall(text: string, tools: Map<string, StationTool>, step: number): LlmToolCall | undefined {
    if (tools.size === 0) return undefined;

    const object = soleObject(text);
    if (object === undefined) return undefined;

    const named = fromNamed(object, tools);
    if (named !== undefined) return { id: `stray-${step}`, ...named };

    const inferred = fromArguments(object, tools);
    if (inferred !== undefined) return { id: `stray-${step}`, ...inferred };

    return undefined;
}

/**
 * The message as a single JSON object, when that is all it is.
 *
 * The `<think>` strip is the one `readPicks` does, for the same reason: a reasoning model that
 * thought out loud and then emitted its stray call has still emitted a stray call.
 *
 * Anything else — prose, an array, an object with text around it — is not this. A model that wrote a
 * sentence and an object has said something, and taking the object as its intent would throw the
 * sentence away.
 */
function soleObject(text: string): Record<string, unknown> | undefined {
    const trimmed = text.replace(/^[\s\S]*<\/think>/i, '').trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return undefined;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
}

/**
 * `{"name":"similar_artists","arguments":{…}}` and its several spellings.
 *
 * Every provider that has ever formatted a tool call as text has done it roughly this way, and the
 * name makes it unambiguous — so this needs no inference and only has to check that the tool is one
 * the station actually offered. Absent arguments are an empty object rather than a refusal: several
 * tools take none, and `station_taste` with no arguments is a complete call.
 */
function fromNamed(object: Record<string, unknown>, tools: Map<string, StationTool>): Omit<LlmToolCall, 'id'> | undefined {
    const key = NAME_KEYS.find(candidate => typeof object[candidate] === 'string');
    if (key === undefined) return undefined;

    const name = (object[key] as string).trim();
    if (!tools.has(name)) return undefined;

    const carrier = ARGUMENT_KEYS.find(candidate => isPlainObject(object[candidate]));
    const args = carrier === undefined ? {} : (object[carrier] as Record<string, unknown>);
    return { name, arguments: args };
}

/**
 * A bare bag of arguments, matched to the one tool it can belong to.
 *
 * An empty object is refused outright. It fits every tool that requires nothing, which is most of
 * them, and a model that said `{}` has not asked for anything identifiable.
 */
function fromArguments(object: Record<string, unknown>, tools: Map<string, StationTool>): Omit<LlmToolCall, 'id'> | undefined {
    const keys = Object.keys(object);
    if (keys.length === 0) return undefined;

    const fits = [...tools.values()].filter(tool => accepts(tool.declaration, keys)).map(tool => tool.declaration.name);
    // Exactly one, or nothing. Two tools that both fit means the arguments do not say which was
    // meant, and running the wrong search is worse than ending the conversation honestly.
    return fits.length === 1 ? { name: fits[0]!, arguments: object } : undefined;
}

/**
 * Whether a declaration could have produced exactly these argument names.
 *
 * Both directions are checked and both matter. Every key must be one the tool declares, or a pick
 * whose fields happen to overlap a tool's would be run as a search; and every required parameter
 * must be present, or `{"limit":12}` would fit `similar_artists`, whose whole point is the artist.
 */
function accepts(declaration: LlmToolDeclaration, keys: readonly string[]): boolean {
    const schema = declaration.parameters;
    const properties = isPlainObject(schema.properties) ? Object.keys(schema.properties) : [];
    if (properties.length === 0) return false;
    if (!keys.every(key => properties.includes(key))) return false;

    const required = Array.isArray(schema.required) ? schema.required.filter((entry): entry is string => typeof entry === 'string') : [];
    return required.every(entry => keys.includes(entry));
}

/** An object with fields, as opposed to null, an array, or anything else JSON can hold. */
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
