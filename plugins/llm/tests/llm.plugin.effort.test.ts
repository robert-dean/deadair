// `reasoningEffort` used to go out on every call with nothing an operator could do about it, and a
// strict server refusing the field 400ed the whole break. This is the setting, the one re-attempt
// without the field, and the one server-sanctioned retry layer: `maxRetries: 0` means a plain 500
// is fetched once, not the SDK's own three tries on top of the host's.

import { describe, expect, it } from 'vitest';
import { collectGeneration } from '@deadair/plugin-sdk';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { LlmPlugin } from '../src/llm.plugin.js';

/** One SSE chat-completion stream, in the shape `@ai-sdk/openai-compatible` parses. */
function sseResponse(text: string): Response {
    const chunks = [
        { id: '1', choices: [{ delta: { role: 'assistant' }, finish_reason: null }] },
        { id: '1', choices: [{ delta: { content: text }, finish_reason: null }] },
        {
            id: '1',
            choices: [{ delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
    ];
    const body = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** What a strict OpenAI-compatible server says to a field it has never heard of. */
function refusalResponse(): Response {
    return new Response(JSON.stringify({ error: { message: 'Unrecognized request argument supplied: reasoning_effort' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
    });
}

function plainErrorResponse(status: number): Response {
    return new Response(JSON.stringify({ error: { message: 'internal error' } }), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

/** A host that answers each `fetch` from a scripted queue, holding the last entry once it runs out. */
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

async function loadedPlugin(host: FakePluginHost, config: Record<string, unknown> = {}): Promise<LlmPlugin> {
    host.seedConfig({
        providers: JSON.stringify([{ $id: 'r1', name: 'srv', kind: 'openai-compat', baseUrl: 'https://models.test/v1' }]),
        model: 'srv:gpt-x',
        ...config,
    });
    const plugin = new LlmPlugin();
    await plugin.init(host);
    return plugin;
}

/** Whether a recorded call's JSON body carries `reasoning_effort`, and what it says if so. */
function reasoningEffortSent(host: FakePluginHost, callIndex: number): string | undefined {
    const body = host.calls[callIndex]?.body;
    if (body === undefined) return undefined;
    const parsed = JSON.parse(body) as { reasoning_effort?: string };
    return parsed.reasoning_effort;
}

const request = { messages: [{ role: 'user' as const, content: 'say something' }] };

describe('reasoning effort', () => {
    it('retries once without the field when a server refuses it, and the words still arrive', async () => {
        const host = scriptedHost([refusalResponse, () => sseResponse('Hello.')]);
        const plugin = await loadedPlugin(host, { reasoningEffort: 'low' });

        const handle = await plugin.generate(request);
        const result = await collectGeneration(handle);

        expect(result.text).toBe('Hello.');
        expect(host.calls).toHaveLength(2);
        expect(reasoningEffortSent(host, 0)).toBe('low');
        expect(reasoningEffortSent(host, 1)).toBeUndefined();
    });

    it('sends the field on no further call once a server has refused it once', async () => {
        const host = scriptedHost([refusalResponse, () => sseResponse('first'), () => sseResponse('second')]);
        const plugin = await loadedPlugin(host, { reasoningEffort: 'low' });

        await collectGeneration(await plugin.generate(request));
        const second = await collectGeneration(await plugin.generate(request));

        expect(second.text).toBe('second');
        // Two from the first call (refused, then retried) plus one more for the second call.
        expect(host.calls).toHaveLength(3);
        expect(reasoningEffortSent(host, 2)).toBeUndefined();
    });

    it('off sends the field as none, overriding whatever the caller asked for', async () => {
        const host = scriptedHost([() => sseResponse('quiet')]);
        const plugin = await loadedPlugin(host, { reasoningEffort: 'off' });

        const result = await collectGeneration(await plugin.generate({ ...request, reasoningEffort: 'high' }));

        expect(result.text).toBe('quiet');
        expect(host.calls).toHaveLength(1);
        expect(reasoningEffortSent(host, 0)).toBe('none');
    });

    it('surfaces a second refusal rather than retrying again', async () => {
        const host = scriptedHost([refusalResponse, refusalResponse]);
        const plugin = await loadedPlugin(host, { reasoningEffort: 'low' });

        const handle = await plugin.generate(request);

        await expect(collectGeneration(handle)).rejects.toThrow();
        expect(host.calls).toHaveLength(2);
    });

    it('is fetched once on a plain 500, which is what maxRetries: 0 buys', async () => {
        const host = scriptedHost([() => plainErrorResponse(500)]);
        const plugin = await loadedPlugin(host);

        const handle = await plugin.generate(request);

        await expect(collectGeneration(handle)).rejects.toThrow();
        expect(host.calls).toHaveLength(1);
    });
});
