import { decodeCastMessage, encodeCastMessage, type CastMessage } from './cast.message.js';

/**
 * The most one message may claim to be. A Chromecast's own limit is 64 KiB, and a length above it
 * is a stream that has lost step rather than a large message.
 */
export const CAST_MAX_MESSAGE_BYTES = 64 * 1024;

/** One message as it goes on the wire: a 4-byte big-endian length, then the body. */
export function frameCastMessage(message: CastMessage): Uint8Array {
    const body = encodeCastMessage(message);
    const framed = new Uint8Array(4 + body.length);
    new DataView(framed.buffer).setUint32(0, body.length);
    framed.set(body, 4);
    return framed;
}

/**
 * Reassembles messages from whatever chunks TLS hands over.
 *
 * A read can end in the middle of a length or a body, or carry several messages at once, so bytes
 * are held until a whole message is there. Throws when a length is impossible, for
 * `decodeCastMessage`'s reason: the stream is out of step, and the connection has to go.
 */
export class CastFrameReader {
    private pending = new Uint8Array(0);

    /** Adds a chunk and answers every message it completed, in order. */
    push(chunk: Uint8Array): CastMessage[] {
        const joined = new Uint8Array(this.pending.length + chunk.length);
        joined.set(this.pending);
        joined.set(chunk, this.pending.length);

        const messages: CastMessage[] = [];
        let offset = 0;
        while (joined.length - offset >= 4) {
            const length = new DataView(joined.buffer, joined.byteOffset + offset, 4).getUint32(0);
            if (length > CAST_MAX_MESSAGE_BYTES)
                throw new Error(`cast frame: a message claims ${length} bytes, over the ${CAST_MAX_MESSAGE_BYTES} limit`);
            if (joined.length - offset - 4 < length) break;
            messages.push(decodeCastMessage(joined.subarray(offset + 4, offset + 4 + length)));
            offset += 4 + length;
        }

        this.pending = joined.slice(offset);
        return messages;
    }
}
