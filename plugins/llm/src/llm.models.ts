import type { LlmModelInfo } from '@deadair/plugin-sdk';

/**
 * The operator's list of models, and which of them can be given tools.
 *
 * ## Why this is typed in rather than discovered
 *
 * An OpenAI-compatible server will happily list its models over `GET /models`,
 * and that list says nothing about tool support. There is no field for it in the
 * protocol, and there is no reliable way to infer it from a model's name: two
 * builds of the same weights differ, and a server can be a proxy for several
 * back ends at once.
 *
 * The alternative to asking the operator is finding out by failing a generation,
 * which costs a break. So this is a small form field, the way the speech
 * engine's voice map is: the thing the protocol cannot tell us, said once by
 * somebody who knows.
 *
 * ## The syntax
 *
 * One model per line (or comma-separated), with an optional `+tools`:
 *
 * ```
 * gpt-oss:20b +tools
 * llama3.2:1b
 * ```
 *
 * Deliberately not a JSON blob in a textarea. This is a list an operator edits
 * by hand while looking at another window, and a missing brace should not be the
 * difference between a station that talks and one that does not.
 */

/** `+tools` at the end of an entry, in any case, with or without the plus. */
const TOOLS_SUFFIX = /\s*\+?tools$/i;

/** What one line meant. */
export interface ParsedModel {
    id: string;
    tools: boolean;
}

/**
 * Parse the configured list. Never throws: an unreadable line is dropped rather
 * than failing the load, because a plugin that will not start is worse than one
 * that offers fewer models than the operator meant.
 */
export function parseModelList(raw: string | undefined): ParsedModel[] {
    if (typeof raw !== 'string' || raw.trim().length === 0) return [];

    const seen = new Map<string, ParsedModel>();
    for (const entry of raw.split(/[\n,]/)) {
        const trimmed = entry.trim();
        if (trimmed.length === 0) continue;

        const tools = TOOLS_SUFFIX.test(trimmed);
        const id = trimmed.replace(TOOLS_SUFFIX, '').trim();
        if (id.length === 0) continue;

        // Last mention wins, so an operator correcting a line lower down gets what
        // they typed rather than whichever copy happened to be first.
        seen.set(id, { id, tools });
    }

    return [...seen.values()];
}

/**
 * Whether the configured list is usable at all, for the config form's own check.
 *
 * Anything parses, so the only genuinely wrong answer is text that yields no
 * models at all — which means the operator typed something and got nothing, and
 * should be told while they are still looking at it.
 */
export function isParseableModelList(raw: string | undefined): boolean {
    if (typeof raw !== 'string' || raw.trim().length === 0) return true;
    return parseModelList(raw).length > 0;
}

/**
 * The list the host sees, with the configured default folded in.
 *
 * The default model is always offered even when the operator did not list it,
 * because a plugin that names a model it will not admit to having is a confusing
 * thing to debug. It arrives without tools unless it was listed WITH them, which
 * is the conservative direction: the cost of being wrong here is a failed
 * generation, and the cost of being cautious is a break written without facts a
 * tool would have supplied.
 */
export function describeModels(raw: string | undefined, defaultModel: string): LlmModelInfo[] {
    const parsed = parseModelList(raw);
    const fallback = defaultModel.trim();

    if (fallback.length > 0 && !parsed.some(model => model.id === fallback)) {
        parsed.unshift({ id: fallback, tools: false });
    }

    return parsed.map(model => ({ id: model.id, label: model.id, tools: model.tools }));
}
