// A gateway sitting in front of the real OpenAI-compatible endpoint that insists on a header of its
// own (an internal proxy's auth token, a routing hint) which is not what the `apiKey` cell is for,
// since that one is always sent as `Authorization: Bearer`. `parseHeaderLines` is the pure read of
// the row's `headers` cell, and the rest of this file is that a configured header actually reaches
// both a generation call and the `/models` probe, on the wire.

import { describe, expect, it } from 'vitest';
import { streamText } from 'ai';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { openAiCompatibleArm, parseHeaderLines } from '../src/openai.compat.provider.js';

/** One SSE chat-completion stream, in the shape `@ai-sdk/openai-compatible` parses. */
function sseResponse(text: string): Response {
    const chunks = [
        { id: '1', choices: [{ delta: { role: 'assistant' }, finish_reason: null }] },
        { id: '1', choices: [{ delta: { content: text }, finish_reason: null }] },
        { id: '1', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    ];
    const body = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** The model list, as `GET /models` answers it. */
function modelsResponse(ids: string[]): Response {
    return new Response(JSON.stringify({ data: ids.map(id => ({ id })) }), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A host answering each `fetch` from a scripted queue, holding the last entry once it runs out. */
function scriptedHost(responses: (() => Response)[]): FakePluginHost {
    const host = createFakePluginHost();
    let call = 0;
    host.setFetchImpl(async () => {
        const build = responses[Math.min(call, responses.length - 1)];
        call += 1;
        return build();
    });
    return host;
}

describe('parseHeaderLines', () => {
    it('reads one header per line, split at the first colon', () => {
        expect(parseHeaderLines('X-One: a\nX-Two: b')).toEqual({ 'X-One': 'a', 'X-Two': 'b' });
    });

    it('keeps everything after the first colon, for a value that has one of its own', () => {
        expect(parseHeaderLines('Authorization: Bearer abc:123')).toEqual({ Authorization: 'Bearer abc:123' });
    });

    it('trims whitespace off both the name and the value', () => {
        expect(parseHeaderLines('  X-One  :   a  ')).toEqual({ 'X-One': 'a' });
    });

    it('skips a blank line and a line with nothing before the colon', () => {
        expect(parseHeaderLines('\n: nameless\nX-One: a\n')).toEqual({ 'X-One': 'a' });
    });

    it('skips a line with no colon at all', () => {
        expect(parseHeaderLines('not a header\nX-One: a')).toEqual({ 'X-One': 'a' });
    });

    it('lets a later line win over an earlier one naming the same header, case-insensitively', () => {
        expect(parseHeaderLines('X-One: a\nx-one: b')).toEqual({ 'x-one': 'b' });
    });

    it('answers empty for text that is not there', () => {
        expect(parseHeaderLines(undefined)).toEqual({});
    });
});

describe('a header the row configures', () => {
    it('reaches the generation request', async () => {
        const host = scriptedHost([() => sseResponse('hi')]);
        const arm = openAiCompatibleArm(host, { baseUrl: 'https://gateway.test/v1', headers: { 'X-Gateway-Key': 'shh' } });

        const stream = streamText({ model: arm.languageModel('gpt-x'), messages: [{ role: 'user', content: 'hi' }], maxRetries: 0 });
        await stream.text;

        // Lower-cased by the host's own fetch wrapper on the way out, the same as every other
        // header a model call carries: see `toHeaderRecord` in `llm.fetch.ts`.
        expect(host.calls[0]?.headers?.['x-gateway-key']).toBe('shh');
    });

    it('reaches the /models probe', async () => {
        const host = scriptedHost([() => modelsResponse(['gpt-x'])]);
        const arm = openAiCompatibleArm(host, { baseUrl: 'https://gateway.test/v1', headers: { 'X-Gateway-Key': 'shh' } });

        await arm.fetchModels();

        expect(host.calls[0]?.headers?.['X-Gateway-Key']).toBe('shh');
    });

    it('keeps the row authorization header on the probe rather than the key-derived one', async () => {
        const host = scriptedHost([() => modelsResponse(['gpt-x'])]);
        const arm = openAiCompatibleArm(host, {
            baseUrl: 'https://gateway.test/v1',
            apiKey: 'sk-test',
            headers: { Authorization: 'Gateway token-1' },
        });

        await arm.fetchModels();

        expect(host.calls[0]?.headers?.Authorization).toBe('Gateway token-1');
    });

    it('falls back to the key-derived authorization on the probe when the row sets no header of its own', async () => {
        const host = scriptedHost([() => modelsResponse(['gpt-x'])]);
        const arm = openAiCompatibleArm(host, { baseUrl: 'https://gateway.test/v1', apiKey: 'sk-test' });

        await arm.fetchModels();

        expect(host.calls[0]?.headers?.authorization).toBe('Bearer sk-test');
    });
});
