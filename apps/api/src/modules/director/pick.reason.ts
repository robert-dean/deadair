/**
 * Why the model picked a record, as it said so, made safe to keep.
 *
 * Only `ModelSetGenerator` ever produces one, and only when the operator asked it to
 * (`llm.setReasons`). The station's own draw has no reason and must not be given one: its honest
 * answer is the weights that moved, which is a different kind of sentence, and a draw with an
 * invented rationale would be the first line in the as-run log nobody could trust.
 *
 * Kept and shown, and never read to decide anything. Nothing in the rotation rules, the resolver or
 * the repeat window looks at it.
 */

/** Long enough for one sentence about one record, short enough to sit under a line in a log. */
export const PICK_REASON_MAX = 160;

/**
 * The reason in a model's `why`, as one tidy line, or `undefined` for anything that is not text.
 *
 * Collapsed to a single line with control characters removed, because it is drawn under a record
 * and a model's line breaks are not the console's. Cut on a word when it runs long, with an
 * ellipsis, rather than refused: a reason a few words too long is still a reason.
 */
export function pickReason(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const line = value
        .replace(/\p{Cc}+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (line.length === 0) return undefined;
    if (line.length <= PICK_REASON_MAX) return line;

    const cut = line.slice(0, PICK_REASON_MAX - 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > PICK_REASON_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}
