/**
 * A response body read no further than a ceiling, counted as it arrives.
 *
 * Two doors fetch audio from an address somebody else chose: a pad an operator typed the address of,
 * which is buffered because the pad library takes bytes, and a podcast episode a feed named, which is
 * streamed to disk because it is a hundred times the size. They share this so they share the one rule
 * that matters: **`content-length` is a claim the far end makes and may not make at all**, so a station
 * that trusted it would buffer a gigabyte before discovering it had been lied to. The count is of the
 * bytes actually received, and the transfer is cancelled the moment it goes over, which stops the
 * download as well as the reading.
 */

/** What {@link boundedChunks} throws when a body goes past its ceiling. */
export class BodyTooLargeError extends Error {
    constructor(readonly maxBytes: number) {
        super(`larger than ${maxBytes} bytes`);
        this.name = 'BodyTooLargeError';
    }
}

/**
 * A body's chunks, in order, throwing {@link BodyTooLargeError} once more than `maxBytes` have arrived.
 *
 * The body is cancelled before the throw, so the socket is let go rather than drained, and the lock is
 * released however the loop ends, including when the caller stops iterating early.
 */
export async function* boundedChunks(body: ReadableStream<Uint8Array>, maxBytes: number): AsyncGenerator<Uint8Array> {
    const reader = body.getReader();
    let held = 0;
    let finished = false;

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                finished = true;
                return;
            }

            held += value.byteLength;
            if (held > maxBytes) {
                finished = true;
                await reader.cancel().catch(() => {});
                throw new BodyTooLargeError(maxBytes);
            }

            yield value;
        }
    } finally {
        // A caller that stopped early (its own failure, a size it did not like) leaves the rest of
        // the body unread; cancelling is what lets the connection go.
        if (!finished) await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

/**
 * A whole body, up to the ceiling, and `undefined` past it.
 *
 * For a caller that needs the bytes in hand. Anything large should stream {@link boundedChunks}
 * somewhere instead of holding it.
 */
export async function readBounded(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Buffer | undefined> {
    if (body === null) return Buffer.alloc(0);

    const chunks: Buffer[] = [];
    try {
        for await (const chunk of boundedChunks(body, maxBytes)) chunks.push(Buffer.from(chunk));
    } catch (error) {
        if (error instanceof BodyTooLargeError) return undefined;
        throw error;
    }

    return Buffer.concat(chunks);
}
