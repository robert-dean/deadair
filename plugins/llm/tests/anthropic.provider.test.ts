// Claude over its own Messages API rather than as an address on the OpenAI-compatible arm, and
// every claim here is one of the two reasons that is worth a second dependency: thinking is a token
// budget rather than a word, and a thinking block comes back SIGNED — a tool round trip whose
// earlier turns arrive without their signatures is refused, which is what `providerState` carries.

import { describe, expect, it } from 'vitest';
import { collectGeneration, isPluginError } from '@deadair/plugin-sdk';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { LlmPlugin } from '../src/llm.plugin.js';

/** One streamed Messages response, in the shape `@ai-sdk/anthropic` parses. */
function sseResponse(options: { text?: string; thinking?: { text: string; signature: string }; stopReason?: string } = {}): Response {
    const { text = 'that was Roygbiv', thinking, stopReason = 'end_turn' } = options;

    const events: { event: string; data: unknown }[] = [
        { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 11, output_tokens: 0 } } } },
    ];

    let index = 0;
    if (thinking !== undefined) {
        events.push(
            { event: 'content_block_start', data: { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } } },
            {
                event: 'content_block_delta',
                data: { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: thinking.text } },
            },
            {
                event: 'content_block_delta',
                data: { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: thinking.signature } },
            },
            { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
        );
        index += 1;
    }

    events.push(
        { event: 'content_block_start', data: { type: 'content_block_start', index, content_block: { type: 'text', text: '' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } } },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
        {
            event: 'message_delta',
            data: { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 7 } },
        },
        { event: 'message_stop', data: { type: 'message_stop' } },
    );

    const body = events.map(entry => `event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`).join('');
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** What this service says to a model that will not take the thinking field it was handed. */
function thinkingRefusal(): Response {
    return new Response(
        JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: '`thinking.budget_tokens` is not supported by this model' },
        }),
        {
            status: 400,
            headers: { 'content-type': 'application/json' },
        },
    );
}

/** The model list, as `GET /v1/models` answers it. */
function modelsResponse(ids: string[]): Response {
    return new Response(JSON.stringify({ data: ids.map(id => ({ id, display_name: id })) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
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

async function loadedPlugin(host: FakePluginHost, config: Record<string, unknown> = {}): Promise<LlmPlugin> {
    host.seedConfig({ providerKind: 'anthropic', model: 'claude-x', ...config });
    host.seedSecret('apiKey', config.apiKey === null ? '' : 'sk-test');
    const plugin = new LlmPlugin();
    await plugin.init(host);
    return plugin;
}

const ask = { messages: [{ role: 'user' as const, content: 'back-announce it' }] };

/** The JSON body of the nth call, for asserting what actually went on the wire. */
const sentBody = (host: FakePluginHost, index: number): Record<string, unknown> => JSON.parse(String(host.calls[index]?.body ?? '{}'));

describe('speaking to Anthropic', () => {
    it('sends the key and the API version as this service wants them', async () => {
        const host = scriptedHost([() => sseResponse()]);
        const plugin = await loadedPlugin(host);

        await collectGeneration(await plugin.generate(ask));

        expect(host.calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
        expect(host.calls[0]?.headers?.['x-api-key']).toBe('sk-test');
        expect(host.calls[0]?.headers?.['anthropic-version']).toBe('2023-06-01');
    });

    it('asks for thinking as a token budget, because that is the only dial this API has', async () => {
        const host = scriptedHost([() => sseResponse()]);
        const plugin = await loadedPlugin(host, { reasoningEffort: 'high' });

        await collectGeneration(await plugin.generate(ask));

        expect(sentBody(host, 0).thinking).toEqual({ type: 'enabled', budget_tokens: 24_576 });
    });

    it('asks for no thinking by saying nothing, because the SDK will not carry a disabled block', async () => {
        // The API takes `thinking: { type: 'disabled' }` and this SDK drops it: the whole field is
        // spread behind a check that the type ENABLES thinking. Sending it would be a no-op dressed
        // up as a setting. So Off is expressed by omission, which is genuinely off on a model whose
        // thinking is opt-in and is not on one that thinks adaptively by default.
        const host = scriptedHost([() => sseResponse()]);
        const plugin = await loadedPlugin(host, { reasoningEffort: 'off' });

        await collectGeneration(await plugin.generate(ask));

        expect(sentBody(host, 0).thinking).toBeUndefined();
    });

    it('says nothing about thinking when nobody asked', async () => {
        const host = scriptedHost([() => sseResponse()]);
        const plugin = await loadedPlugin(host, { reasoningEffort: 'auto' });

        await collectGeneration(await plugin.generate(ask));

        expect(sentBody(host, 0).thinking).toBeUndefined();
    });

    it('retries once without the field when a model will not take it', async () => {
        const host = scriptedHost([thinkingRefusal, () => sseResponse()]);
        const plugin = await loadedPlugin(host, { reasoningEffort: 'medium' });

        const result = await collectGeneration(await plugin.generate(ask));

        expect(result.text).toBe('that was Roygbiv');
        expect(host.calls).toHaveLength(2);
        expect(sentBody(host, 1).thinking).toBeUndefined();
    });

    it('keeps the signature off a thinking block, because a tool round trip is refused without it', async () => {
        const host = scriptedHost([() => sseResponse({ thinking: { text: 'they last played it in March', signature: 'sig-1' } })]);
        const plugin = await loadedPlugin(host);

        const result = await collectGeneration(await plugin.generate(ask));

        expect(result.providerState).toEqual({
            reasoning: [{ text: 'they last played it in March', providerMetadata: { anthropic: { signature: 'sig-1' } } }],
        });
    });

    it('carries nothing back when the turn had no thinking in it', async () => {
        const host = scriptedHost([() => sseResponse()]);
        const plugin = await loadedPlugin(host);

        expect((await collectGeneration(await plugin.generate(ask))).providerState).toBeUndefined();
    });
});

describe('what Anthropic has', () => {
    it('lists the models and says every one of them takes tools', async () => {
        // The vendor serves only its own models and all of them do, so asking an operator to tick a
        // box confirming it would be asking for something already known.
        const host = scriptedHost([() => modelsResponse(['claude-x', 'claude-y'])]);
        const plugin = await loadedPlugin(host);

        expect(await plugin.listModels()).toEqual([
            { id: 'claude-x', label: 'claude-x', tools: true, default: true },
            { id: 'claude-y', label: 'claude-y', tools: true },
        ]);
        expect(host.calls[0]?.headers?.['x-api-key']).toBe('sk-test');
    });

    it('sends tools without asking anybody to tick anything', async () => {
        const host = scriptedHost([() => sseResponse()]);
        const plugin = await loadedPlugin(host);

        await collectGeneration(
            await plugin.generate({
                ...ask,
                tools: [{ name: 'search_catalog', description: 'the records the station has', parameters: { type: 'object', properties: {} } }],
            }),
        );

        expect(sentBody(host, 0).tools).toBeDefined();
    });

    it('names a refused key rather than reporting a status nobody can act on', async () => {
        const host = scriptedHost([() => new Response('nope', { status: 401 })]);
        const plugin = await loadedPlugin(host);

        expect(await plugin.testConnection()).toEqual({ ok: false, message: 'The API key was refused.' });
    });
});

describe('an Anthropic provider with no key', () => {
    it('says what is missing rather than probing', async () => {
        const host = scriptedHost([() => sseResponse()]);
        const plugin = await loadedPlugin(host, { apiKey: null });

        expect(await plugin.testConnection()).toEqual({ ok: false, message: 'No API key set.' });
        expect(host.calls).toHaveLength(0);
    });

    it('refuses a generation as a configuration fault', async () => {
        const host = scriptedHost([() => sseResponse()]);
        const plugin = await loadedPlugin(host, { apiKey: null });

        const error = await plugin.generate(ask).catch((thrown: unknown) => thrown);

        expect(isPluginError(error) && error.code).toBe('config');
    });
});
