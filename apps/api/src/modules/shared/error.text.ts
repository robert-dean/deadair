/**
 * Turning a caught `unknown` into a sentence, in the two shapes this codebase
 * actually needs.
 *
 * `catch` binds `unknown`, so every place that logs a failure has to narrow it
 * before it can say anything about it. That narrowing was written out around
 * fifty times here — eighteen module-level copies of the plain form and five
 * byte-identical copies of the ServerkitError form, each with its own copy of the
 * comment explaining itself — which is a lot of surface for one expression whose
 * only interesting property is that every caller agrees on it.
 *
 * Neither of these is an error-HANDLING helper. They produce a string for a log
 * line or a stored `last_error` column, and they deliberately lose the stack, the
 * cause chain and the type. Anything deciding what to DO about a failure should
 * be looking at the error itself.
 */

/**
 * The message, or the value itself stringified when something threw a non-Error.
 *
 * The fallback is not defensive padding: a rejected fetch, a thrown string from a
 * plugin and an aborted signal all arrive here, and only some of them are `Error`.
 */
export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The same, but preferring a `ServerkitError`'s `details.message`.
 *
 * A `ServerkitError`'s own `message` is the bare status text ("Forbidden") and
 * the sentence a human wants is in `details.message`. An operator reading a
 * plugin's last error wants the sentence, not the status word, so anything whose
 * output reaches the console goes through this one; anything logging a failure
 * from inside the station can use {@link errorText}.
 */
export const serverkitErrorText = (error: unknown): string => {
    if (!(error instanceof Error)) return String(error);
    const details = (error as { details?: Record<string, unknown> }).details;
    const detail = details?.message;
    return typeof detail === 'string' && detail.length > 0 ? detail : error.message;
};
