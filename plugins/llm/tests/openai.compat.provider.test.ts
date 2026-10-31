// A gateway sitting in front of the real OpenAI-compatible endpoint that insists on a header of its
// own (an internal proxy's auth token, a routing hint) which is not what the `apiKey` cell is for,
// since that one is always sent as `Authorization: Bearer`. `parseHeaderLines` is the pure read of
// the row's `headers` cell, and the rest of this file is that a configured header actually reaches
// both a generation call and the `/models` probe, on the wire.

import { describe, expect, it } from 'vitest';
import { APICallError, streamText } from 'ai';
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

describe('telling a refused value from a refused field', () => {
    /** A 400 as `@ai-sdk/openai-compatible` raises it, with the server's body attached. */
    function refusal(message: string, statusCode = 400): APICallError {
        return new APICallError({
            message: 'Bad Request',
            url: 'https://models.test/v1/chat/completions',
            requestBodyValues: {},
            statusCode,
            responseBody: JSON.stringify({ error: { message } }),
        });
    }

    const arm = openAiCompatibleArm(createFakePluginHost(), { baseUrl: 'https://models.test/v1' });

    it('reads a body quoting the value as a refused value', () => {
        const error = refusal("Unsupported value: 'reasoning_effort' does not support 'none' with this model.");

        expect(arm.isReasoningValueRefusal?.(error, 'none')).toBe(true);
        expect(arm.isReasoningRefusal(error)).toBe(true);
    });

    it('reads a body saying the value is not allowed as a refused value, quoted or not', () => {
        expect(arm.isReasoningValueRefusal?.(refusal('reasoning_effort: none is not allowed for this model'), 'none')).toBe(true);
        expect(arm.isReasoningValueRefusal?.(refusal('Invalid reasoning_effort for this model'), 'none')).toBe(true);
    });

    it('keeps a body that only says the argument is unrecognized a refused field', () => {
        const error = refusal('Unrecognized request argument supplied: reasoning_effort');

        expect(arm.isReasoningValueRefusal?.(error, 'none')).toBe(false);
        expect(arm.isReasoningRefusal(error)).toBe(true);
    });

    it('does not read a body quoting a different value as a refusal of this one', () => {
        expect(arm.isReasoningValueRefusal?.(refusal("reasoning_effort 'high' is too expensive"), 'none')).toBe(false);
    });

    it('takes neither a body that does not name the field nor a status other than 400', () => {
        expect(arm.isReasoningValueRefusal?.(refusal("'none' is not supported"), 'none')).toBe(false);
        expect(arm.isReasoningValueRefusal?.(refusal("reasoning_effort does not support 'none'", 500), 'none')).toBe(false);
        expect(arm.isReasoningValueRefusal?.(new Error("reasoning_effort does not support 'none'"), 'none')).toBe(false);
    });

    it('reads reasoning being mandatory as a refused value, though the body never names the field', () => {
        const error = refusal('Reasoning is mandatory for this endpoint and cannot be disabled.');

        expect(arm.isReasoningValueRefusal?.(error, 'none')).toBe(true);
        expect(arm.isReasoningRefusal(error)).toBe(false);
    });

    it('matches the mandatory wording whatever its case', () => {
        expect(arm.isReasoningValueRefusal?.(refusal('REASONING IS MANDATORY for this endpoint'), 'none')).toBe(true);
    });

    it('takes the mandatory wording only as a 400, and no looser wording in its place', () => {
        const words = 'Reasoning is mandatory for this endpoint and cannot be disabled.';

        expect(arm.isReasoningValueRefusal?.(refusal(words, 500), 'none')).toBe(false);
        expect(arm.isReasoningValueRefusal?.(new Error(words), 'none')).toBe(false);
        expect(arm.isReasoningValueRefusal?.(refusal('Reasoning is not available for this endpoint.'), 'none')).toBe(false);
        expect(arm.isReasoningValueRefusal?.(refusal('A system prompt is mandatory for this endpoint.'), 'none')).toBe(false);
    });
});
