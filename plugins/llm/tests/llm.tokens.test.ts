// OpenAI's newer models refuse `max_tokens` with a 400 that names `max_completion_tokens`, while
// every local server still reads only the old name. The wrapper sends what the SDK built, renames
// the field and resends once on exactly that refusal, and remembers the model so its later calls go
// out renamed from the start.

import { describe, expect, it, vi } from 'vitest';
import { streamText } from 'ai';
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';

import { isTokenFieldRefusal, renameTokenField, tokenFieldFetch } from '../src/llm.tokens.js';
import { openAiCompatibleArm } from '../src/openai.compat.provider.js';

const OPENAI_REFUSAL = JSON.stringify({
    error: {
        message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
        type: 'invalid_request_error',
        param: 'max_tokens',
        code: 'unsupported_parameter',
    },
});

function refusal(body = OPENAI_REFUSAL, status = 400): Response {
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

function ok(): Response {
    return new Response('{}', { status: 200 });
}

function request(model: string, extra: Record<string, unknown> = { max_tokens: 300 }): RequestInit {
    return { method: 'POST', body: JSON.stringify({ model, messages: [], ...extra }) };
}

/** The JSON body of the `n`th call `inner` received. */
function sentBody(inner: ReturnType<typeof vi.fn>, n: number): Record<string, unknown> {
    const init = inner.mock.calls[n]?.[1] as RequestInit | undefined;
    return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe('isTokenFieldRefusal', () => {
    it('reads OpenAI saying it wants the new field', () => {
        expect(isTokenFieldRefusal(400, OPENAI_REFUSAL)).toBe(true);
    });

    it('needs both names, so another complaint about the cap is not taken for it', () => {
        expect(isTokenFieldRefusal(400, 'max_tokens is too large: 999999. This model supports at most 4096.')).toBe(false);
    });

    it('needs a 400', () => {
        expect(isTokenFieldRefusal(500, OPENAI_REFUSAL)).toBe(false);
    });
});

describe('renameTokenField', () => {
    it('moves the cap to the new name and keeps everything else', () => {
        const renamed = renameTokenField(JSON.stringify({ model: 'm', max_tokens: 50, temperature: 0.5 }));

        expect(JSON.parse(renamed ?? '')).toEqual({ model: 'm', max_completion_tokens: 50, temperature: 0.5 });
    });

    it('has nothing to rename on a body without a cap, or one that is not a JSON object', () => {
        expect(renameTokenField(JSON.stringify({ model: 'm' }))).toBeUndefined();
        expect(renameTokenField('not json max_tokens')).toBeUndefined();
        expect(renameTokenField('["max_tokens"]')).toBeUndefined();
    });
});

describe('tokenFieldFetch', () => {
    it('sends the body untouched to a model that takes max_tokens', async () => {
        const inner = vi.fn(async () => ok());
        const send = tokenFieldFetch(inner as unknown as typeof fetch);

        const response = await send('https://x.test/v1/chat/completions', request('llama'));

        expect(response.status).toBe(200);
        expect(inner).toHaveBeenCalledTimes(1);
        expect(sentBody(inner, 0)).toMatchObject({ max_tokens: 300 });
    });

    it('resends once with the field renamed when the model refuses the old name', async () => {
        const inner = vi.fn<(...args: unknown[]) => Promise<Response>>().mockResolvedValueOnce(refusal()).mockResolvedValue(ok());
        const send = tokenFieldFetch(inner as unknown as typeof fetch);

        const response = await send('https://x.test/v1/chat/completions', request('gpt-new'));

        expect(response.status).toBe(200);
        expect(inner).toHaveBeenCalledTimes(2);
        expect(sentBody(inner, 1)).toMatchObject({ max_completion_tokens: 300 });
        expect(sentBody(inner, 1)).not.toHaveProperty('max_tokens');
    });

    it('remembers the model, so its next call goes out renamed with no refusal first', async () => {
        const inner = vi.fn<(...args: unknown[]) => Promise<Response>>().mockResolvedValueOnce(refusal()).mockResolvedValue(ok());
        const send = tokenFieldFetch(inner as unknown as typeof fetch);

        await send('https://x.test/v1/chat/completions', request('gpt-new'));
        await send('https://x.test/v1/chat/completions', request('gpt-new'));

        expect(inner).toHaveBeenCalledTimes(3);
        expect(sentBody(inner, 2)).toMatchObject({ max_completion_tokens: 300 });
    });

    it('remembers per model, leaving another model on the same server as it was', async () => {
        const inner = vi.fn<(...args: unknown[]) => Promise<Response>>().mockResolvedValueOnce(refusal()).mockResolvedValue(ok());
        const send = tokenFieldFetch(inner as unknown as typeof fetch);

        await send('https://x.test/v1/chat/completions', request('gpt-new'));
        await send('https://x.test/v1/chat/completions', request('gpt-old'));

        expect(sentBody(inner, 2)).toMatchObject({ max_tokens: 300 });
    });

    it('hands any other 400 back with its body intact and does not resend', async () => {
        const body = JSON.stringify({ error: { message: 'messages must not be empty' } });
        const inner = vi.fn(async () => refusal(body));
        const send = tokenFieldFetch(inner as unknown as typeof fetch);

        const response = await send('https://x.test/v1/chat/completions', request('gpt-new'));

        expect(inner).toHaveBeenCalledTimes(1);
        expect(response.status).toBe(400);
        expect(await response.text()).toBe(body);
    });

    it('passes a call with no cap straight through, even when it is refused', async () => {
        const inner = vi.fn(async () => refusal());
        const send = tokenFieldFetch(inner as unknown as typeof fetch);

        const response = await send('https://x.test/v1/chat/completions', request('gpt-new', {}));

        expect(inner).toHaveBeenCalledTimes(1);
        expect(response.status).toBe(400);
    });
});

describe('through the OpenAI-compatible arm', () => {
    function sseResponse(text: string): Response {
        const chunks = [
            { id: '1', choices: [{ delta: { role: 'assistant' }, finish_reason: null }] },
            { id: '1', choices: [{ delta: { content: text }, finish_reason: null }] },
            { id: '1', choices: [{ delta: {}, finish_reason: 'stop' }] },
        ];
        const body = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }

    it('answers a capped call from a model that only takes max_completion_tokens', async () => {
        const host = createFakePluginHost();
        host.setFetchImpl(async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return 'max_tokens' in body ? refusal() : sseResponse('hello');
        });
        const arm = openAiCompatibleArm(host, { baseUrl: 'https://api.test/v1', apiKey: 'sk-test' });

        const stream = streamText({
            model: arm.languageModel('gpt-new'),
            messages: [{ role: 'user', content: 'hi' }],
            maxOutputTokens: 64,
            maxRetries: 0,
        });

        expect(await stream.text).toBe('hello');
        expect(host.calls).toHaveLength(2);
        expect(JSON.parse(String(host.calls[1]?.body))).toMatchObject({ max_completion_tokens: 64 });
    });
});
