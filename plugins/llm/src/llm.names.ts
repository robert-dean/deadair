/**
 * Which provider a model name says it lives on.
 *
 * ## Why a name carries this at all
 *
 * The station picks a MODEL per call and a plugin per station: `LlmRequest.model` travels with every
 * generation, and `llm.pluginId` is one setting. So a station that wants a hosted model for the words
 * listeners hear and a local one for the volume nobody hears has exactly one place to say so, and it
 * is the model name. Anything else — a second setting beside each of the six model keys, a plugin
 * installed per provider — is a new axis for a distinction the existing one already carries.
 *
 * ## The provider is a name the OPERATOR chose
 *
 * Not a vendor word. The providers are rows in a list, each named by whoever added it, so a station
 * can hold two OpenAI-compatible servers — a local Ollama and a hosted one — and tell them apart.
 * That is the whole reason the qualifier is not `anthropic:` and `google:` any more: those named a
 * protocol, and a protocol is not a thing you can have two of.
 *
 * ## Every name is qualified, and the split is at the FIRST colon
 *
 * `ollama:gpt-oss-radio:latest` is the provider `ollama` and the model `gpt-oss-radio:latest`, which
 * is what makes Ollama's own `name:tag` ids survive intact. A name with no colon names no provider
 * and is refused rather than guessed at: "the first row" would be a rule that changes meaning when
 * somebody reorders the table, and a model quietly reaching the wrong provider is worse than a save
 * that would not go through.
 */

/** How a provider name and a model are joined. */
const SEPARATOR = ':';

/** A model name as {@link readModelName} reads it. */
export interface ModelName {
    /** The row's name, as the operator typed it. */
    provider: string;

    /** The model as that provider knows it. */
    id: string;
}

/**
 * The name a station uses for one of a provider's models.
 *
 * Idempotent on an already-qualified name, so a caller that qualifies twice gets one prefix rather
 * than two: the ids this produces are also the ids that come back in `LlmRequest.model`, and a round
 * trip through a settings form is the ordinary path rather than an edge case.
 */
export function qualify(provider: string, id: string): string {
    const name = provider.trim();
    const model = id.trim();
    if (name.length === 0 || model.length === 0) return '';

    return model.startsWith(`${name}${SEPARATOR}`) ? model : `${name}${SEPARATOR}${model}`;
}

/**
 * Which provider a name asks for and what that provider calls the model, or `undefined` for a name
 * that says neither.
 *
 * Never throws. An unqualified name is not an error here, it is a question this cannot answer, and
 * the caller has a better sentence to say about it than this does — the settings form names the
 * field, and `generate` names what it expected.
 */
export function readModelName(name: string | undefined): ModelName | undefined {
    const trimmed = name?.trim() ?? '';
    const at = trimmed.indexOf(SEPARATOR);
    if (at <= 0) return undefined;

    const provider = trimmed.slice(0, at).trim();
    const id = trimmed.slice(at + SEPARATOR.length).trim();
    if (provider.length === 0 || id.length === 0) return undefined;

    return { provider, id };
}

/**
 * Whether a row's name can be used as a qualifier.
 *
 * No colon, because that is what a name is split on, and no whitespace, because a name with a space
 * in it reads as two words in a setting that holds one token. Lowercase is not enforced and is not
 * assumed: names are matched exactly, so `Ollama` and `ollama` are two providers, which is the
 * honest reading of a table an operator typed.
 */
export function isProviderName(value: string): boolean {
    const name = value.trim();
    return name.length > 0 && !name.includes(SEPARATOR) && !/\s/.test(name);
}
