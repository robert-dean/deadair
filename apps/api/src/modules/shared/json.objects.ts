/**
 * Reading JSON out of an answer that is not only JSON.
 *
 * A local model told to answer in JSON frequently answers in JSON wrapped in prose, or in JSON that
 * stops mid-sentence because it hit its token ceiling. Both are ordinary rather than exceptional, so
 * every caller that asks a model for a structured answer needs the same scanner — and reimplementing
 * it per caller is how two of them end up disagreeing about what a truncated answer means.
 *
 * Shared rather than private to the first caller that needed it (`set.prompt.ts`), because the
 * second one wants exactly the same rule: take the complete objects and leave the unterminated one.
 */

/**
 * The complete `{...}` spans in a string, ignoring braces inside JSON strings.
 *
 * A scanner rather than a regex because a title legitimately contains a brace, a quote or an escaped
 * quote, and because the LAST object is frequently the one that matters: it is where a truncated
 * answer stops, and an unterminated span must be left out rather than half-read.
 *
 * Depth is tracked so a nested brace closes its own object rather than its parent's, which means
 * what comes back is the OUTERMOST objects. That is right for a flat array of `{title, artist}` and
 * it is also right for one whole object with nested fields; an answer wrapped in `{"picks": [...]}`
 * would read as one span holding the lot, which the caller then parses and reads as it likes.
 */
export function jsonObjects(text: string): string[] {
    const spans: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index]!;

        if (inString) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') inString = false;
            continue;
        }

        if (character === '"') inString = true;
        else if (character === '{') {
            if (depth === 0) start = index;
            depth += 1;
        } else if (character === '}' && depth > 0) {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                spans.push(text.slice(start, index + 1));
                start = -1;
            }
        }
    }

    return spans;
}

/**
 * Whatever a model put before its answer, removed.
 *
 * A reasoning model told not to think out loud does anyway, and the words after the last close tag
 * are the actual answer. The same treatment `readAnswer` gives a script, applied here so a structured
 * answer and a spoken one agree about where a model's thinking ends.
 */
export function withoutThinking(text: string): string {
    return text.replace(/^[\s\S]*<\/think>/i, '').trim();
}
