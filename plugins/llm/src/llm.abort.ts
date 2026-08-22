/**
 * Making a generation stoppable, which the platform cannot arrange on the plugin's behalf.
 *
 * `LlmHandle.text` says cancelling the stream stops the generation, and both halves of keeping that
 * promise live here because both are easy to get wrong in ways nothing reports:
 *
 * - The host's own signal is the wrong thing to hand a provider. `PluginInvoker` disposes it as
 *   soon as `generate` resolves, and `generate` resolves when the request is away rather than when
 *   the words are done — so a generation carrying it has no live abort for the whole time it is
 *   actually running.
 * - Forwarding a provider's stream is not the same as forwarding control of it. The SDK's
 *   `textStream` is one branch of a tee and the result promises read the other, so closing the
 *   branch the host holds ends nothing.
 */

/** Abort `controller` when `signal` fires, now or later. Nothing happens if `signal` is absent. */
export function abortWith(signal: AbortSignal | undefined, controller: AbortController): void {
    if (signal === undefined) return;
    if (signal.aborted) {
        controller.abort();
        return;
    }

    // `once`, so a long-lived controller cannot accumulate listeners on a signal it outlives.
    signal.addEventListener('abort', () => controller.abort(), { once: true });
}

/**
 * The same stream, with `onCancel` run when the reader cancels it.
 *
 * A pass-through rather than a wrapper around the source's own `cancel`, because the source here is
 * a tee branch whose cancellation the provider never learns about. Chunks are forwarded untouched;
 * the only thing added is the side effect.
 */
export function withCancel<T>(source: ReadableStream<T>, onCancel: () => void): ReadableStream<T> {
    const reader = source.getReader();

    return new ReadableStream<T>({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    controller.close();
                    return;
                }
                controller.enqueue(value);
            } catch (error) {
                controller.error(error);
            }
        },

        cancel(reason) {
            // The side effect first: it is the whole point of this, and a `cancel` that threw
            // afterwards must not be what decides whether the generation was stopped.
            onCancel();
            return reader.cancel(reason).catch(() => undefined);
        },
    });
}
