// Gemini over the Generative Language API rather than as an address on the OpenAI-compatible arm,
// and the reason is what the compatible endpoint drops: Gemini signs its function calls, and a tool
// round trip that replays them without the signature is a turn the service does not trust. The
// signature has nowhere to live on the compatible path, which is what `providerState` is for.

import { describe, expect, it } from 'vitest';
import { collectGeneration, isPluginError } from '@deadair/plugin-sdk';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { LlmPlugin } from '../src/llm.plugin.js';
import { toModelMessages } from '../src/llm.messages.js';

/** One `streamGenerateContent?alt=sse` response, in the shape `@ai-sdk/google` parses. */
function sseResponse(options: { text?: string; call?: { name: string; signature?: string } } = {}): Response {
    const { text = 'that was Roygbiv', call } = options;

    const parts: Record<string, unknown>[] = [{ text }];
    if (call !== undefined) {
        parts.push({
            functionCall: { name: call.name, args: { query: 'boc' } },
            ...(call.signature === undefined ? {} : { thoughtSignature: call.signature }),
        });
    }

    const chunk = {
        candidates: [{ content: { role: 'model', parts }, finishReason: call === undefined ? 'STOP' : 'STOP', index: 0 }],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 },
    };

    return new Response(`data: ${JSON.stringify(chunk)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** What this service says to a 2.5-era model handed a 3-era thinking field. */
function thinkingRefusal(): Response {
    return new Response(JSON.stringify({ error: { code: 400, message: 'Unknown name "thinkingLevel" in thinkingConfig' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
    });
}

/** The model list, as `GET /v1beta/models` answers it. */
function modelsResponse(models: { name: string; methods?: string[] }[], nextPageToken?: string): Response {
    const body = {
        models: models.map(model => ({ name: model.name, supportedGenerationMethods: model.methods ?? ['generateContent'] })),
        ...(nextPageToken === undefined ? {} : { nextPageToken }),
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

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
    host.seedConfig({ providerKind: 'google', model: 'gemini-x', ...config });
    host.seedSecret('apiKey', config.apiKey === null ? '' : 'goog-test');
    const plugin = new LlmPlugin();
    await plugin.init(host);
    return plugin;
}

const ask = { messages: [{ role: 'user' as const, content: 'back-announce it' }] };
const sentBody = (host: FakePluginHost, index: number): Record<string, any> => JSON.parse(String(host.calls[index]?.body ?? '{}'));

describe('speaking to Gemini', () => {
    it('sends the key in this service header and streams from its own path', async () => {
        const host = scriptedHost([() => sseResponse()]);
        const plugin = await loadedPlugin(host);

        await collectGeneration(await plugin.generate(ask));

        expect(host.calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse');
        expect(host.calls[0]?.headers?.['x-goog-api-key']).toBe('goog-test');
    });

    it('asks for thinking as a level, which is the word this API takes', async () => {
        const host = scriptedHost([() => sseResponse()]);
        const plugin = await loadedPlugin(host, { reasoningEffort: 'medium' });

        await collectGeneration(await plugin.generate(ask));

        expect(sentBody(host, 0).generationConfig?.thinkingConfig).toEqual({ thinkingLevel: 'medium' });
    });

    it('says off as a budget of zero, because the level vocabulary has no off in it', async () => {
        const host = scriptedHost([() => sseResponse()]);
        const plugin = await loadedPlugin(host, { reasoningEffort: 'off' });

        await collectGeneration(await plugin.generate(ask));

        expect(sentBody(host, 0).generationConfig?.thinkingConfig).toEqual({ thinkingBudget: 0 });
    });

    it('retries once without the field when a model does not know it', async () => {
        // A 2.5-era model handed a 3-era field. One silent re-attempt is a break written rather
        // than a break lost.
        const host = scriptedHost([thinkingRefusal, () => sseResponse()]);
        const plugin = await loadedPlugin(host, { reasoningEffort: 'high' });

        const result = await collectGeneration(await plugin.generate(ask));

        expect(result.text).toBe('that was Roygbiv');
        expect(host.calls).toHaveLength(2);
        expect(sentBody(host, 1).generationConfig?.thinkingConfig).toBeUndefined();
    });
});

describe('the signature on a function call', () => {
    it('keeps it against the id of the call it belongs to', async () => {
        const host = scriptedHost([() => sseResponse({ call: { name: 'search_catalog', signature: 'sig-2' } })]);
        const plugin = await loadedPlugin(host);

        const result = await collectGeneration(
            await plugin.generate({
                ...ask,
                tools: [{ name: 'search_catalog', description: 'the records the station has', parameters: { type: 'object', properties: {} } }],
            }),
        );

        const [call] = result.toolCalls;
        expect(call?.name).toBe('search_catalog');
        expect(result.providerState).toEqual({ toolCalls: { [call!.id]: { google: { thoughtSignature: 'sig-2' } } } });
    });

    it('goes back out on the turn it was made on', async () => {
        // The whole point of carrying it. This is the mapping the host's replayed transcript hits.
        const [message] = toModelMessages([
            {
                role: 'assistant',
                content: '',
                toolCalls: [{ id: 'call_1', name: 'search_catalog', arguments: { query: 'boc' } }],
                providerState: { toolCalls: { call_1: { google: { thoughtSignature: 'sig-2' } } } },
            },
        ]);

        expect(message).toEqual({
            role: 'assistant',
            content: [
                {
                    type: 'tool-call',
                    toolCallId: 'call_1',
                    toolName: 'search_catalog',
                    input: { query: 'boc' },
                    providerOptions: { google: { thoughtSignature: 'sig-2' } },
                },
            ],
        });
    });

    it('carries nothing back from a call the service did not sign', async () => {
        const host = scriptedHost([() => sseResponse({ call: { name: 'search_catalog' } })]);
        const plugin = await loadedPlugin(host);

        const result = await collectGeneration(
            await plugin.generate({
                ...ask,
                tools: [{ name: 'search_catalog', description: 'the records the station has', parameters: { type: 'object', properties: {} } }],
            }),
        );

        expect(result.providerState).toBeUndefined();
    });
});

describe('what Gemini has', () => {
    it('lists only the models that can hold a conversation, without their path prefix', async () => {
        // The same list carries embedding models, and offering one as something to write a break
        // with is offering a choice that fails on first use.
        const host = scriptedHost([
            () =>
                modelsResponse([
                    { name: 'models/gemini-x' },
                    { name: 'models/embedding-001', methods: ['embedContent'] },
                    { name: 'models/gemini-y' },
                ]),
        ]);
        const plugin = await loadedPlugin(host);

        expect(await plugin.listModels()).toEqual([
            { id: 'gemini-x', label: 'gemini-x', tools: true, default: true },
            { id: 'gemini-y', label: 'gemini-y', tools: true },
        ]);
    });

    it('follows the page token, and stops when it stops advancing', async () => {
        let call = 0;
        const host = createFakePluginHost();
        host.setFetchImpl(async () => {
            call += 1;
            return call === 1 ? modelsResponse([{ name: 'models/gemini-x' }], 'page-2') : modelsResponse([{ name: 'models/gemini-y' }]);
        });
        host.seedConfig({ providerKind: 'google', model: 'gemini-x' });
        host.seedSecret('apiKey', 'goog-test');
        const plugin = new LlmPlugin();
        await plugin.init(host);

        expect((await plugin.listModels()).map(model => model.id)).toEqual(['gemini-x', 'gemini-y']);
        expect(host.calls[1]?.url).toContain('pageToken=page-2');
    });

    it('names a refused key rather than reporting a status nobody can act on', async () => {
        const host = scriptedHost([() => new Response('nope', { status: 400 })]);
        const plugin = await loadedPlugin(host);

        expect(await plugin.testConnection()).toEqual({ ok: false, message: 'The API key was refused.' });
    });
});

describe('a Gemini provider with no key', () => {
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
