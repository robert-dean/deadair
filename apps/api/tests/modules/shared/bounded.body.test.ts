import { describe, expect, it } from 'vitest';

import { BodyTooLargeError, boundedChunks, readBounded } from '../../../src/modules/shared/bounded.body.js';

/** A body delivering these chunks, recording whether anybody cancelled it. */
function body(...chunks: number[]): { stream: ReadableStream<Uint8Array>; cancelled: () => boolean } {
    let cancelled = false;
    let at = 0;
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (at >= chunks.length) return controller.close();
            controller.enqueue(new Uint8Array(chunks[at++]!));
        },
        cancel() {
            cancelled = true;
        },
    });
    return { stream, cancelled: () => cancelled };
}

describe('readBounded', () => {
    it('answers the whole body when it fits', async () => {
        const { stream } = body(3, 4);

        expect((await readBounded(stream, 7))?.length).toBe(7);
    });

    // `content-length` is a claim, and this never reads it: the count is of what actually arrived.
    it('answers nothing once the body goes past the ceiling, and lets the connection go', async () => {
        const { stream, cancelled } = body(4, 4, 4);

        expect(await readBounded(stream, 7)).toBeUndefined();
        expect(cancelled()).toBe(true);
    });

    it('answers an empty buffer for a response with no body', async () => {
        expect((await readBounded(null, 7))?.length).toBe(0);
    });
});

describe('boundedChunks', () => {
    it('throws a size refusal rather than truncating', async () => {
        const { stream } = body(5, 5);
        const read = async () => {
            for await (const _chunk of boundedChunks(stream, 8)) void _chunk;
        };

        await expect(read()).rejects.toBeInstanceOf(BodyTooLargeError);
    });

    it('cancels the body when the reader stops early, so an unread tail does not hold a socket', async () => {
        const { stream, cancelled } = body(1, 1, 1);

        for await (const _chunk of boundedChunks(stream, 100)) break;

        expect(cancelled()).toBe(true);
    });
});
