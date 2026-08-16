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

/**
 * A span a model meant as JSON, made parseable, or `undefined` when it is not JSON at all.
 *
 * The one repair worth making, and it is a SHAPE repair rather than a content one — which is the
 * line every reader here already draws. A local model writing a long string frequently wraps it
 * across lines:
 *
 * ```
 * "diction": [
 *     "use colloquial contractions,
 *     drop final consonants in verb endings"
 * ```
 *
 * A literal newline inside a string is invalid JSON, so `JSON.parse` throws over what is otherwise a
 * complete and perfectly readable answer. Measured on this station: an answer that stopped cleanly at
 * 1001 tokens, wanted nothing, and was thrown away entirely for a line break.
 *
 * So a newline inside a string becomes a space, which is what the model meant by it. Nothing outside
 * a string is touched, so the object's own structure is exactly as it arrived — this cannot invent a
 * field, close an unterminated object, or change a value into a different value.
 *
 * Tried only after a strict parse has failed, so a well-formed answer never goes near it.
 */
export function parseLooseJson(span: string): unknown {
    try {
        return JSON.parse(span);
    } catch {
        // Fall through to the one repair.
    }

    let repaired = '';
    let inString = false;
    let escaped = false;

    for (let index = 0; index < span.length; index += 1) {
        const character = span[index]!;

        if (inString && !escaped && (character === '\n' || character === '\r')) {
            // The whole run of whitespace around the break collapses to ONE space, indentation
            // included. A wrapped line means a word boundary and nothing else; keeping the four
            // spaces that formatted the source would put them in the middle of the sentence.
            while (index + 1 < span.length && /\s/.test(span[index + 1]!)) index += 1;
            repaired = `${repaired.replace(/\s+$/, '')} `;
            continue;
        }

        if (inString) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') inString = false;
        } else if (character === '"') {
            inString = true;
        }

        repaired += character;
    }

    try {
        return JSON.parse(repaired);
    } catch {
        return undefined;
    }
}
