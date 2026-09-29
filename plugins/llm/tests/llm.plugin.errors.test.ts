// A refused generation used to reach the station as "No output generated. Check the stream for
// errors.", whatever the provider had said: the SDK's generic wrapper, with the status and the body
// gone. Eighteen Gemini breaks failed in a row on a live station reading exactly that, and nothing in
// the log could say whether it was a quota, an overloaded model or a bad request.

import { describe, expect, it } from 'vitest';
import { collectGeneration, PluginError } from '@deadair/plugin-sdk';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { LlmPlugin } from '../src/llm.plugin.js';

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** What the Generative Language API answers once a key's per-minute quota is spent. */
const QUOTA = {
    error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.', status: 'RESOURCE_EXHAUSTED' },
};

const OVERLOADED = { error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } };

async function geminiPlugin(response: () => Response): Promise<{ plugin: LlmPlugin; host: FakePluginHost }> {
    const host = createFakePluginHost();
    host.setFetchImpl(async () => response());
    host.seedConfig({
        providers: JSON.stringify([{ $id: 'g1', name: 'gemini', kind: 'google' }]),
        model: 'gemini:gemini-flash-latest',
    });
    host.seedSecret('providers/g1/apiKey', 'test-key');
    const plugin = new LlmPlugin();
    await plugin.init(host);
    return { plugin, host };
}

/** The error a finished generation rejected with. */
async function failureOf(plugin: LlmPlugin, reasoningEffort?: 'low'): Promise<PluginError> {
    const handle = await plugin.generate({ messages: [{ role: 'user', content: 'say something' }], reasoningEffort });
    const error = await collectGeneration(handle).then(
        () => undefined,
        (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PluginError);
    return error as PluginError;
}

describe('a provider refusing a generation', () => {
    it("says what the provider said rather than the SDK's no-output wrapper", async () => {
        const { plugin } = await geminiPlugin(() => jsonResponse(429, QUOTA));

        const error = await failureOf(plugin);

        expect(error.message).toContain('provider "gemini" answered HTTP 429');
        expect(error.message).toContain('You exceeded your current quota');
        expect(error.message).not.toContain('No output generated');
    });

    it('classifies a quota refusal as rate limited, keeping the upstream status', async () => {
        const { plugin } = await geminiPlugin(() => jsonResponse(429, QUOTA));

        const error = await failureOf(plugin);

        expect(error.code).toBe('rate_limited');
        expect(error.upstreamStatus).toBe(429);
        expect(error.retryable).toBe(true);
    });

    it('classifies an overloaded model as unavailable', async () => {
        const { plugin } = await geminiPlugin(() => jsonResponse(503, OVERLOADED));

        const error = await failureOf(plugin);

        expect(error.code).toBe('unavailable');
        expect(error.message).toContain('The model is overloaded');
    });

    it('classifies a refused key as an auth failure', async () => {
        const { plugin } = await geminiPlugin(() =>
            jsonResponse(401, { error: { code: 401, message: 'API key not valid.', status: 'UNAUTHENTICATED' } }),
        );

        expect((await failureOf(plugin)).code).toBe('auth');
    });

    it('still names the fault when an effort field went out and the refusal was not about it', async () => {
        const { plugin, host } = await geminiPlugin(() => jsonResponse(429, QUOTA));

        const error = await failureOf(plugin, 'low');

        expect(error.code).toBe('rate_limited');
        // Not mistaken for a thinking-field refusal, so no second attempt.
        expect(host.calls).toHaveLength(1);
    });
});
