import { describe, expect, it } from 'vitest';

import { CAST_MAX_MESSAGE_BYTES, CastFrameReader, frameCastMessage } from '../../../src/drivers/chromecast/cast.frame.js';
import { decodeCastMessage, encodeCastMessage, type CastMessage } from '../../../src/drivers/chromecast/cast.message.js';

const ping: CastMessage = {
    sourceId: 'sender-0',
    destinationId: 'receiver-0',
    namespace: 'urn:x-cast:com.google.cast.tp.heartbeat',
    payload: '{"type":"PING"}',
};

describe('the Cast message codec', () => {
    it('encodes a heartbeat as the protobuf a Cast device expects', () => {
        // Field by field: version 0, three strings, payload type 0 (string), the JSON.
        const expected = [
            0x08,
            0x00,
            0x12,
            8,
            ...Buffer.from('sender-0'),
            0x1a,
            10,
            ...Buffer.from('receiver-0'),
            0x22,
            39,
            ...Buffer.from('urn:x-cast:com.google.cast.tp.heartbeat'),
            0x28,
            0x00,
            0x32,
            15,
            ...Buffer.from('{"type":"PING"}'),
        ];

        expect([...encodeCastMessage(ping)]).toEqual(expected);
    });

    it('round-trips a payload longer than one varint byte can measure', () => {
        const long: CastMessage = { ...ping, namespace: 'urn:x-cast:com.google.cast.media', payload: JSON.stringify({ title: 'x'.repeat(300) }) };

        expect(decodeCastMessage(encodeCastMessage(long))).toEqual(long);
    });

    it('skips a binary payload rather than misreading it', () => {
        const binary = Uint8Array.from([0x08, 0x00, 0x12, 1, 0x61, 0x1a, 1, 0x62, 0x22, 1, 0x63, 0x28, 0x01, 0x3a, 2, 0xff, 0xfe]);

        expect(decodeCastMessage(binary)).toEqual({ sourceId: 'a', destinationId: 'b', namespace: 'c' });
    });

    it('refuses a message missing a required field', () => {
        expect(() => decodeCastMessage(Uint8Array.from([0x08, 0x00, 0x12, 1, 0x61]))).toThrow(/required/);
    });

    it('refuses a field that runs past the end', () => {
        expect(() => decodeCastMessage(Uint8Array.from([0x12, 9, 0x61]))).toThrow(/past the end/);
    });
});

describe('CastFrameReader', () => {
    it('reassembles a message split across reads at any byte', () => {
        const framed = frameCastMessage(ping);
        for (let cut = 1; cut < framed.length; cut++) {
            const reader = new CastFrameReader();
            expect(reader.push(framed.subarray(0, cut))).toEqual([]);
            expect(reader.push(framed.subarray(cut))).toEqual([ping]);
        }
    });

    it('answers every message in one read, in order', () => {
        const pong = { ...ping, payload: '{"type":"PONG"}' };
        const both = new Uint8Array([...frameCastMessage(ping), ...frameCastMessage(pong)]);

        expect(new CastFrameReader().push(both)).toEqual([ping, pong]);
    });

    it('throws on a length no Cast device would send, since the stream has lost step', () => {
        const bogus = new Uint8Array(4);
        new DataView(bogus.buffer).setUint32(0, CAST_MAX_MESSAGE_BYTES + 1);

        expect(() => new CastFrameReader().push(bogus)).toThrow(/limit/);
    });
});
