/**
 * The Cast v2 wire message, encoded and decoded by hand.
 *
 * A Chromecast speaks protobuf, and the whole schema it speaks on the control channel is one
 * message of seven fields (`cast_channel.proto`'s `CastMessage`). A protobuf library for that would
 * be a runtime dependency, and a bundled plugin with one fails `plugin:prove`, which simulates the
 * installed path; so this is the ~80 lines a library would have generated, for exactly this message:
 *
 * ```proto
 * message CastMessage {
 *   required ProtocolVersion protocol_version = 1;  // always 0, CASTV2_1_0
 *   required string source_id = 2;
 *   required string destination_id = 3;
 *   required string namespace = 4;
 *   required PayloadType payload_type = 5;          // 0 STRING, 1 BINARY
 *   optional string payload_utf8 = 6;
 *   optional bytes payload_binary = 7;
 * }
 * ```
 *
 * Only string payloads are sent, because every namespace this plugin uses carries JSON. A binary
 * payload is decoded far enough to be skipped rather than misread.
 */
export interface CastMessage {
    sourceId: string;
    destinationId: string;
    namespace: string;
    /** The JSON payload, as text. Absent for a binary payload, which nothing here reads. */
    payload?: string;
}

const WIRE_VARINT = 0;
const WIRE_LENGTH_DELIMITED = 2;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Encodes one message: the protobuf body, without the length prefix (see `cast.frame.ts`). */
export function encodeCastMessage(message: CastMessage): Uint8Array {
    const parts: number[][] = [];
    const varintField = (field: number, value: number): void => void parts.push([...varint((field << 3) | WIRE_VARINT), ...varint(value)]);
    const bytesField = (field: number, bytes: Uint8Array): void =>
        void parts.push([...varint((field << 3) | WIRE_LENGTH_DELIMITED), ...varint(bytes.length), ...bytes]);

    varintField(1, 0);
    bytesField(2, encoder.encode(message.sourceId));
    bytesField(3, encoder.encode(message.destinationId));
    bytesField(4, encoder.encode(message.namespace));
    varintField(5, 0);
    if (message.payload !== undefined) bytesField(6, encoder.encode(message.payload));

    return Uint8Array.from(parts.flat());
}

/**
 * Decodes one message body. Throws on bytes that are not a well-formed message, because a framing
 * error means the stream is out of step and nothing after it can be trusted: the caller drops the
 * connection rather than guessing where the next message starts.
 */
export function decodeCastMessage(bytes: Uint8Array): CastMessage {
    const message: Partial<CastMessage> = {};
    let offset = 0;

    while (offset < bytes.length) {
        const [key, afterKey] = readVarint(bytes, offset);
        offset = afterKey;
        const field = key >>> 3;
        const wireType = key & 0x7;

        if (wireType === WIRE_VARINT) {
            offset = readVarint(bytes, offset)[1];
            continue;
        }
        if (wireType !== WIRE_LENGTH_DELIMITED) throw new Error(`cast message: unsupported wire type ${wireType} on field ${field}`);

        const [length, afterLength] = readVarint(bytes, offset);
        const end = afterLength + length;
        if (end > bytes.length) throw new Error('cast message: a field runs past the end of the message');
        const value = bytes.subarray(afterLength, end);
        offset = end;

        if (field === 2) message.sourceId = decoder.decode(value);
        else if (field === 3) message.destinationId = decoder.decode(value);
        else if (field === 4) message.namespace = decoder.decode(value);
        else if (field === 6) message.payload = decoder.decode(value);
    }

    if (message.sourceId === undefined || message.destinationId === undefined || message.namespace === undefined) {
        throw new Error('cast message: a required field is missing');
    }
    return message as CastMessage;
}

function varint(value: number): number[] {
    const out: number[] = [];
    let rest = value >>> 0;
    while (rest >= 0x80) {
        out.push((rest & 0x7f) | 0x80);
        rest >>>= 7;
    }
    out.push(rest);
    return out;
}

/** Reads a varint at `offset`, answering the value and the offset after it. Values above 2^32 are not used by this schema. */
function readVarint(bytes: Uint8Array, offset: number): [number, number] {
    let value = 0;
    let shift = 0;
    for (let at = offset; at < bytes.length; at++) {
        const byte = bytes[at] as number;
        if (shift < 32) value |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) return [value >>> 0, at + 1];
        shift += 7;
        if (shift > 63) break;
    }
    throw new Error('cast message: a varint runs past the end of the message');
}
