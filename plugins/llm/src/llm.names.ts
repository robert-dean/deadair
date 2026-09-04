import { PROVIDER_KINDS, type ProviderKind } from './llm.manifest.js';

/**
 * Which provider a model name says it lives on.
 *
 * ## Why a name carries this at all
 *
 * The station picks a MODEL per call and a plugin per station: `LlmRequest.model`
 * travels with every generation, and `llm.pluginId` is one setting. So a station
 * that wants a hosted model for the words listeners hear and a local one for the
 * volume nobody hears has exactly one place to say so, and it is the model name.
 * Anything else — a second setting beside each of the six model keys, a plugin
 * installed per provider — is a new axis for a distinction the existing one
 * already carries.
 *
 * ## Bare means the OpenAI-compatible server, permanently
 *
 * Not "the default", which would make a name mean different things on different
 * days. It is fixed, and that is what lets an install configured before any of
 * this go on working untouched: its stored model, its ticked tool-capable
 * models, and every writer setting still name what they always named.
 *
 * ## Why a colon does not collide
 *
 * Ollama's own ids are `name:tag` (`gpt-oss-radio:latest`) and OpenRouter's are
 * `vendor/model`, so both live on the OpenAI-compatible arm and both would be
 * ambiguous against a general "split on the separator" rule. This is not that
 * rule: only the two exact prefixes below are read, and everything else is bare
 * without being parsed at all. An Ollama model genuinely named `anthropic:…`
 * would be misread, and that is the one case this trades away knowingly.
 */

/** The prefixes, per arm. The OpenAI-compatible arm has none, which is the whole rule. */
export const ARM_PREFIXES = { anthropic: 'anthropic:', google: 'google:' } as const satisfies Partial<Record<ProviderKind, string>>;

/** The arm a bare name belongs to. */
export const BARE_ARM: ProviderKind = 'openai-compat';

/** A model name with its arm, as {@link readModelName} reads it. */
export interface ModelName {
    kind: ProviderKind;

    /** The name as that provider knows it, with any prefix taken off. Empty when there was nothing but a prefix. */
    id: string;
}

/**
 * The name a station uses for one of this arm's models.
 *
 * Idempotent on an already-qualified name, so a caller that qualifies twice gets
 * one prefix rather than two: the ids this produces are also the ids that come
 * back in `LlmRequest.model`, and a round trip through a settings form is the
 * ordinary path rather than an edge case.
 */
export function qualify(kind: ProviderKind, id: string): string {
    const trimmed = id.trim();
    if (trimmed.length === 0) return '';

    const prefix = prefixFor(kind);
    if (prefix === undefined) return trimmed;

    return trimmed.startsWith(prefix) ? trimmed : `${prefix}${trimmed}`;
}

/**
 * Which arm a name is asking for, and what that arm calls it.
 *
 * Never throws and never rejects: an unrecognised prefix is not an error, it is a
 * bare name that happens to contain a colon, which is what most of this station's
 * own models look like.
 */
export function readModelName(name: string | undefined): ModelName {
    const trimmed = name?.trim() ?? '';

    for (const [kind, prefix] of Object.entries(ARM_PREFIXES) as [ProviderKind, string][]) {
        if (trimmed.startsWith(prefix)) return { kind, id: trimmed.slice(prefix.length).trim() };
    }

    return { kind: BARE_ARM, id: trimmed };
}

/** How an arm is named to somebody reading a list, rather than to a provider. */
export function armLabel(kind: ProviderKind): string {
    return PROVIDER_KINDS[kind];
}

/** The prefix an arm's names carry, or `undefined` for the bare one. */
function prefixFor(kind: ProviderKind): string | undefined {
    return kind in ARM_PREFIXES ? ARM_PREFIXES[kind as keyof typeof ARM_PREFIXES] : undefined;
}
