// A generation outlives the `generate` call that started it, and an operator saving the plugin's
// config disposes the instance in the meantime, after which `this.host` throws. Read after an await,
// that turned a generation that had merely failed (or a refusal it was about to retry) into
// "used before init() or after dispose()", an INVOKER failure, and three of those quarantine the
// plugin. These dispose mid-stream and check the generation still ends the way it would have.

import { describe, expect, it } from 'vitest';
import { collectGeneration, PluginError } from '@deadair/plugin-sdk';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { LlmPlugin } from '../src/llm.plugin.js';

/** One SSE chat-completion stream, in the shape `@ai-sdk/openai-compatible` parses. No text at all when `text` is undefined. */
function sseResponse(text: string | undefined): Response {
    const chunks = [
        { id: '1', choices: [{ delta: { role: 'assistant' }, finish_reason: null }] },
        ...(text === undefined ? [] : [{ id: '1', choices: [{ delta: { content: text }, finish_reason: null }] }]),
        {
            id: '1',
            choices: [{ delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
    ];
    const body = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function jsonResponse(status: number, message: string): Response {
    return new Response(JSON.stringify({ error: { message } }), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * A host whose FIRST fetch waits until `release` is called, then answers from the scripted queue.
 * The wait is the window an operator's Save lands in.
 */
function gatedHost(responses: (() => Response)[]): { host: FakePluginHost; release: () => void } {
    const host = createFakePluginHost();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
        release = resolve;
    });
    let call = 0;
    host.setFetchImpl(async () => {
        const build = responses[Math.min(call, responses.length - 1)];
        call += 1;
        await gate;
        return build();
    });
    return { host, release };
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

const request = { messages: [{ role: 'user' as const, content: 'say something' }] };

describe('a generation the plugin was disposed under', () => {
    it('still retries a refused thinking field and delivers the words', async () => {
        const { host, release } = gatedHost([
            () => jsonResponse(400, 'Unrecognized request argument supplied: reasoning_effort'),
            () => sseResponse('Hello.'),
        ]);
        const plugin = await loadedPlugin(host, { reasoningEffort: 'low' });

        const handle = await plugin.generate(request);
        await plugin.dispose();
        release();

        const result = await collectGeneration(handle);

        expect(result.text).toBe('Hello.');
        expect(host.calls).toHaveLength(2);
    });

    it('still finishes an answer with no words in it', async () => {
        const { host, release } = gatedHost([() => sseResponse(undefined)]);
        const plugin = await loadedPlugin(host);

        const handle = await plugin.generate(request);
        await plugin.dispose();
        release();

        const result = await collectGeneration(handle);

        expect(result.text).toBe('');
    });

    it("fails with the provider's own PluginError rather than the disposed-host one", async () => {
        const { host, release } = gatedHost([() => jsonResponse(500, 'internal error')]);
        const plugin = await loadedPlugin(host);

        const handle = await plugin.generate(request);
        await plugin.dispose();
        release();

        const error = await collectGeneration(handle).then(
            () => undefined,
            (caught: unknown) => caught,
        );

        expect(error).toBeInstanceOf(PluginError);
        expect((error as PluginError).message).not.toContain('after dispose()');
        expect((error as PluginError).code).not.toBe('internal');
    });
});
