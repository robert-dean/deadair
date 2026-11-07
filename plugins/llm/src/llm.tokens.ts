/**
 * The output cap under whichever name the model will take.
 *
 * ## Why this exists
 *
 * `@ai-sdk/openai-compatible` sends a call's output cap as `max_tokens`, which is what the
 * chat-completions protocol called it for years and what every local server (Ollama, vLLM,
 * llama.cpp) still reads. OpenAI's newer models refuse it outright with a 400 that names the
 * replacement, `max_completion_tokens`, so on those models every call that set a cap failed: the set
 * generator, every break and every article read.
 *
 * Renaming the field for everybody is not the answer, because the servers that only know
 * `max_tokens` would then drop the cap silently rather than refuse it, and an uncapped generation
 * is a slower and dearer one with nothing in the log to say why. Recognising OpenAI by its address
 * is not either: the same models are served from behind Azure, LiteLLM and gateways an operator
 * runs, none of which share a host name.
 *
 * So the model says which it wants. A call goes out as the SDK built it; a 400 whose body names
 * both fields is that model refusing `max_tokens`, and the same request is sent again once with the
 * field renamed. The model id is remembered, so its later calls go out renamed in the first place
 * and the refusal costs one round trip per model for the life of the plugin, not one per call.
 *
 * Done at the fetch rather than in the plugin's retry loop because nothing above the fetch needs to
 * know: the request is identical but for one key, and the caller sees an ordinary answer.
 */

/** The name the protocol has always used, and what the SDK sends. */
const LEGACY_FIELD = 'max_tokens';

/** The name OpenAI's newer models insist on. */
const CURRENT_FIELD = 'max_completion_tokens';

/**
 * Whether a refusal body is a model saying it wants {@link CURRENT_FIELD} instead.
 *
 * Both names are required, so a 400 about something else that happens to mention the cap (a cap
 * above the model's own limit, say) is not mistaken for this and resent pointlessly.
 */
export function isTokenFieldRefusal(status: number, body: string): boolean {
    return status === 400 && body.includes(LEGACY_FIELD) && body.includes(CURRENT_FIELD);
}

/**
 * `body` with {@link LEGACY_FIELD} renamed, or `undefined` when there is nothing to rename: not
 * JSON, not an object, or no cap set on this call at all.
 */
export function renameTokenField(body: string): string | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || !(LEGACY_FIELD in parsed)) return undefined;

    const { [LEGACY_FIELD]: cap, ...rest } = parsed as Record<string, unknown>;
    return JSON.stringify({ ...rest, [CURRENT_FIELD]: cap });
}

/** The `model` a request body names, if it names one. */
function modelOf(body: string): string | undefined {
    try {
        const parsed: unknown = JSON.parse(body);
        if (typeof parsed === 'object' && parsed !== null && 'model' in parsed && typeof parsed.model === 'string') return parsed.model;
    } catch {
        // Not JSON, so not a generation; nothing to remember it under.
    }
    return undefined;
}

/**
 * `inner` with the output cap renamed for any model that has refused it under its old name.
 *
 * The memory belongs to the returned function, so one arm's models are never confused with
 * another's: two rows can name the same model id on two servers that disagree about the field.
 */
export function tokenFieldFetch(inner: typeof fetch): typeof fetch {
    const wantsCurrentField = new Set<string>();

    return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const body = typeof init?.body === 'string' ? init.body : undefined;
        if (body === undefined || !body.includes(LEGACY_FIELD)) return await inner(input, init);

        const model = modelOf(body);
        const renamed = renameTokenField(body);
        if (renamed === undefined) return await inner(input, init);

        if (model !== undefined && wantsCurrentField.has(model)) return await inner(input, { ...init, body: renamed });

        const response = await inner(input, init);
        if (response.status !== 400) return response;

        // Read in full to be judged, so what goes back up when it is NOT this refusal is a fresh
        // response carrying the same text: the SDK still has to read the body to report the fault.
        const text = await response.text();
        if (!isTokenFieldRefusal(response.status, text)) {
            return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
        }

        if (model !== undefined) wantsCurrentField.add(model);
        return await inner(input, { ...init, body: renamed });
    }) as typeof fetch;
}
