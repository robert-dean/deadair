import { parseMultiSelect, type LlmModelInfo } from '@deadair/plugin-sdk';
import type { ProviderKind } from './llm.manifest.js';
import { armLabel, qualify } from './llm.names.js';

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

/**
 * The models the operator ticked as able to use tools.
 *
 * The field is a `multiselect` now, so the ordinary form is a JSON array. The `name +tools` text it
 * used to be is still read, because an install configured before the field changed should keep
 * working rather than silently losing its tool support — which would present as a DJ that stopped
 * checking the library, with nothing in the log about it.
 */
export function toolCapableModels(raw: string | undefined): string[] {
    const chosen = parseMultiSelect(raw);
    if (chosen.length > 0) return chosen;

    return parseModelList(raw)
        .filter(model => model.tools)
        .map(model => model.id);
}

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

    // An empty multiselect submits `[]`, which is a legitimate answer meaning "none of them".
    if (raw.trim().startsWith('[')) return true;

    return parseModelList(raw).length > 0;
}

/**
 * The list the host sees: what the server reports, annotated with what only the
 * operator knows.
 *
 * The two halves are answering different questions, and conflating them was a
 * mistake worth naming. **Which models exist is discoverable** — every
 * OpenAI-compatible server lists them — and making an operator type that out is
 * asking them for something the machine already knows, before they have any way
 * to find it out. **Which of them accept tools is not**, and no amount of asking
 * the server will change that.
 *
 * So `discovered` comes from `/models` and `raw` supplies only the `+tools`
 * flags. A model the operator annotated that the server did not report is kept
 * anyway: a proxy that serves a model without listing it is a real thing, and
 * dropping the entry would silently disable tools on it.
 *
 * `everyModelTakesTools` is the arm answering the second question outright, and
 * it is not a shortcut: a vendor serving only its own models knows which of them
 * take tools, so asking an operator to tick a box confirming it is asking them
 * to supply something already known — and a box they have not found yet reads,
 * from the console, as a station that will not use its own library. Only an
 * OpenAI-compatible endpoint genuinely cannot say, and that is where the config
 * half earns its place.
 *
 * `defaultModel` is folded in for the same reason it always was: a plugin that
 * names a model it will not admit to having is a confusing thing to debug.
 * Anything not annotated arrives without tools, which is the conservative
 * direction — the cost of being wrong is a failed generation, and the cost of
 * being cautious is a break written without facts a tool would have supplied.
 */
export function describeModels(
    discovered: readonly string[],
    raw: string | undefined,
    defaultModel: string,
    everyModelTakesTools = false,
): LlmModelInfo[] {
    const withTools = new Set(toolCapableModels(raw));

    const ids: string[] = [];
    const add = (id: string) => {
        const trimmed = id.trim();
        if (trimmed.length > 0 && !ids.includes(trimmed)) ids.push(trimmed);
    };

    // Server first, so the console lists them in the order it reported. Then the
    // default, then anything annotated that never came back from `/models`.
    for (const id of discovered) add(id);
    add(defaultModel);
    for (const id of withTools) add(id);

    const fallback = defaultModel.trim();
    return ids.map(id => ({
        id,
        label: id,
        tools: everyModelTakesTools || withTools.has(id),
        // Marked so the host knows which entry an unnamed request will actually reach.
        // Without it the host has to assume the worst model on the server, and would
        // never send tools to a station that has more than a couple installed.
        ...(id === fallback ? { default: true } : {}),
    }));
}

/**
 * A native arm's models, as the host sees them.
 *
 * The counterpart to {@link describeModels} and much shorter, because the two
 * questions that file exists to answer are already answered here. **Which models
 * exist** comes from a vendor listing its own, and **which of them accept tools**
 * is every one: these arms serve one company's models and tool support is a
 * property of the product. So there is no config half at all, and nothing to ask
 * an operator to tick.
 *
 * The ids come back QUALIFIED, which is what makes a union list usable: two
 * providers can and do ship models with similar names, and an unqualified list
 * would leave the host holding ids it cannot route. The label is the plain name
 * with the provider beside it, because the qualified id reads as machinery and
 * this is what a console draws.
 */
export function describeNativeModels(kind: ProviderKind, discovered: readonly string[], defaultModel: string): LlmModelInfo[] {
    const seen: string[] = [];
    for (const id of discovered) {
        const trimmed = id.trim();
        if (trimmed.length > 0 && !seen.includes(trimmed)) seen.push(trimmed);
    }

    return seen.map(id => ({
        id: qualify(kind, id),
        label: `${id} · ${armLabel(kind)}`,
        tools: true,
        // Compared qualified against qualified, so the plugin's own default model
        // marks the entry it actually names rather than one on another arm that
        // happens to share a bare name.
        ...(qualify(kind, id) === defaultModel.trim() ? { default: true } : {}),
    }));
}
