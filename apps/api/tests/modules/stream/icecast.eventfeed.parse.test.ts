// The event feed is another project's output arriving over a socket that stays open
// for days, so the cases worth pinning are the ones a live server produces and a
// hand-written example never does: a frame split across two reads, a partial frame at
// the end of a chunk, and payloads that are not the event we are looking for.

import { describe, expect, it } from 'vitest';

import { SseFrameReader, isMountUri, listenerEvent } from '../../../src/modules/stream/icecast.eventfeed.parse.js';

/** A frame as Icecast writes one: an id line, a data line, CRLF CRLF. */
const frame = (data: string, id = 'abc') => `id: ${id}\r\ndata: ${data}\r\n\r\n`;

describe('SseFrameReader', () => {
    it('reads the payloads out of several frames in one chunk', () => {
        const reader = new SseFrameReader();

        expect(reader.push(frame('{"a":1}') + frame('{"b":2}'))).toEqual(['{"a":1}', '{"b":2}']);
    });

    it('holds a frame that arrives in pieces until it is whole', () => {
        const reader = new SseFrameReader();
        const whole = frame('{"trigger":"source-listeners-changed"}');

        expect(reader.push(whole.slice(0, 20))).toEqual([]);
        expect(reader.push(whole.slice(20))).toEqual(['{"trigger":"source-listeners-changed"}']);
    });

    it('keeps a partial frame at the end of a chunk for the next one', () => {
        const reader = new SseFrameReader();

        expect(reader.push(frame('{"a":1}') + 'id: next\r\ndata: {"b"')).toEqual(['{"a":1}']);
        expect(reader.push(':2}\r\n\r\n')).toEqual(['{"b":2}']);
    });

    it('reads frames written with bare newlines too', () => {
        const reader = new SseFrameReader();

        expect(reader.push('data: {"a":1}\n\n')).toEqual(['{"a":1}']);
    });

    it('returns nothing for a frame that carries no data line', () => {
        const reader = new SseFrameReader();

        // A comment and a bare id: framing, not an event.
        expect(reader.push(': keepalive\r\n\r\nid: 7\r\n\r\n')).toEqual([]);
    });

    it('joins a frame whose data was written over several lines', () => {
        const reader = new SseFrameReader();

        expect(reader.push('data: one\r\ndata: two\r\n\r\n')).toEqual(['one\ntwo']);
    });
});

describe('listenerEvent, on what Icecast 2.5.0 actually sends', () => {
    /**
     * Captured verbatim from `GET /admin/eventfeed` on Icecast 2.5.0, listener
     * attaching to `/live.mp3`.
     *
     * The two things upstream's source does not tell you, and that the first
     * version of this parser got wrong: the fields are nested under `crude`, and
     * the count is a STRING.
     */
    const attach =
        '{"type":"event","crude":{"trigger":"source-listener-attach","uri":"/live.mp3","source-media-type":"audio/mpeg",' +
        '"source-instance":"d9f92068-9a94-4056-8bfb-8b591234900f","source-listener-count":"1","connection-ip":"172.21.0.1",' +
        '"client-useragent":"curl/8.7.1","connection-id":21,"connection-time":1786368613},"mount":"/live.mp3"}';

    const changed =
        '{"type":"event","crude":{"trigger":"source-listeners-changed","uri":"/live.mp3","source-media-type":"audio/mpeg",' +
        '"source-instance":"d9f92068-9a94-4056-8bfb-8b591234900f","source-listener-count":"1"},"mount":"/live.mp3"}';

    it('reads an attach frame', () => {
        expect(listenerEvent(attach)).toEqual({ trigger: 'source-listener-attach', uri: '/live.mp3', listeners: 1 });
    });

    it('reads a listeners-changed frame', () => {
        expect(listenerEvent(changed)).toEqual({ trigger: 'source-listeners-changed', uri: '/live.mp3', listeners: 1 });
    });

    it('falls back to the envelope mount when the inner uri is absent', () => {
        expect(listenerEvent('{"type":"event","mount":"/live.mp3","crude":{"source-listener-count":"4"}}')?.uri).toBe('/live.mp3');
    });
});

describe('listenerEvent', () => {
    const payload = (fields: Record<string, unknown>) => JSON.stringify(fields);

    it('reads the trigger, the mount and the whole count', () => {
        const event = listenerEvent(payload({ trigger: 'source-listeners-changed', uri: '/live.mp3', 'source-listener-count': 3 }));

        expect(event).toEqual({ trigger: 'source-listeners-changed', uri: '/live.mp3', listeners: 3 });
    });

    it('takes a count Icecast rendered as a string', () => {
        const event = listenerEvent(payload({ trigger: 'source-listener-attach', uri: '/live.mp3', 'source-listener-count': '2' }));

        expect(event?.listeners).toBe(2);
    });

    it('takes an event whose trigger it has never heard of', () => {
        // The trigger set is upstream's to grow. A count on our mount is a count
        // whatever the event was called, and filtering on a list written today would
        // stop hearing about listeners on the version that renames one.
        const event = listenerEvent(payload({ trigger: 'source-listeners-doubled', uri: '/live.mp3', 'source-listener-count': 9 }));

        expect(event?.listeners).toBe(9);
    });

    it('is nothing for an event with no count', () => {
        expect(listenerEvent(payload({ trigger: 'format-metadata-changed', uri: '/live.mp3' }))).toBeUndefined();
    });

    it('is nothing for an event with no mount', () => {
        expect(listenerEvent(payload({ trigger: 'icecast-idle', 'source-listener-count': 0 }))).toBeUndefined();
    });

    it('is nothing for a payload that is not JSON, or not an object', () => {
        expect(listenerEvent('not json at all')).toBeUndefined();
        expect(listenerEvent('"a string"')).toBeUndefined();
        expect(listenerEvent('null')).toBeUndefined();
    });

    it('is nothing for a negative count', () => {
        expect(listenerEvent(payload({ uri: '/live.mp3', 'source-listener-count': -1 }))).toBeUndefined();
    });
});

describe('isMountUri', () => {
    it('matches the mount as a path', () => {
        expect(isMountUri('/live.mp3', '/live.mp3')).toBe(true);
    });

    it('matches the mount written without its slash on either side', () => {
        expect(isMountUri('live.mp3', '/live.mp3')).toBe(true);
        expect(isMountUri('/live.mp3', 'live.mp3')).toBe(true);
    });

    it('matches a whole URL by its path', () => {
        expect(isMountUri('http://localhost:8000/live.mp3', '/live.mp3')).toBe(true);
    });

    it('does not match another mount, or a prefix of ours', () => {
        expect(isMountUri('/other.mp3', '/live.mp3')).toBe(false);
        expect(isMountUri('/live.mp3.backup', '/live.mp3')).toBe(false);
        expect(isMountUri('', '/live.mp3')).toBe(false);
    });
});
