// A conversation naming several models moves down the list when one fails before answering. Three
// claims worth pinning:
//
// 1. It hands over only on the FIRST generation. After the model has answered a step the transcript
//    carries what that provider signed, which another provider cannot read.
// 2. It never hands over a preemption or a spent budget: those are the station's doing, not the
//    model's.
// 3. A model that failed is asked last for a while, so the calls behind it do not each pay for
//    finding out, and a success clears that at once.

import { describe, expect, it, vi } from 'vitest';
import { PluginError, type LlmRequest, type LlmResult, type LlmToolCall } from '@deadair/plugin-sdk';

import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { LlmGate } from '../../../src/modules/llm/llm.gate.js';
import { LlmService } from '../../../src/modules/llm/llm.service.js';
import { ToolRegistry, type StationTool } from '../../../src/modules/llm/llm.tools.js';
import { MODEL_DOWN_MS, ModelHealth } from '../../../src/modules/llm/model.health.js';
import { settingsConfig } from '../../utils/settings.config.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

const passthroughInvoker = () =>
    ({ invoke: vi.fn(async (_id: string, _op: string, work: () => Promise<unknown>) => work()) }) as unknown as PluginInvoker;

type Behaviour = 'answer' | 'search' | PluginError;

/**
 * A plugin whose models behave as scripted: each model id maps to what its successive generations do.
 * `asked` records which model each generation was asked of.
 */
function plugin(script: Record<string, Behaviour[]>) {
    const asked: string[] = [];
    const calls = new Map<string, number>();

    const record = {
        id: 'deadair.llm',
        dir: '/plugins/llm',
        status: 'active',
        manifest: { capabilities: ['llm'] },
        instance: {
            generate: vi.fn(async (request: LlmRequest) => {
                const model = request.model ?? 'default:model';
                asked.push(model);
                const index = calls.get(model) ?? 0;
                calls.set(model, index + 1);

                const behaviours = script[model] ?? ['answer'];
                const behaviour = behaviours[Math.min(index, behaviours.length - 1)]!;
                if (behaviour instanceof PluginError) throw behaviour;

                const toolCalls: LlmToolCall[] = behaviour === 'search' ? [{ id: `call-${index}`, name: 'search', arguments: {} }] : [];
                const result: LlmResult = {
                    text: behaviour === 'answer' ? `answered by ${model}` : '',
                    toolCalls,
                    finishReason: toolCalls.length > 0 ? 'tool-calls' : 'stop',
                };
                return {
                    text: new ReadableStream<string>({
                        start(controller) {
                            if (result.text.length > 0) controller.enqueue(result.text);
                            controller.close();
                        },
                    }),
                    result: Promise.resolve(result),
                };
            }),
            listModels: async () =>
                ['local:one', 'cloud:two', 'cloud:three', 'default:model'].map(id => ({
                    id,
                    label: id,
                    tools: true,
                    ...(id === 'default:model' ? { default: true } : {}),
                })),
        },
    } as unknown as PluginRecord;

    return { record, asked };
}

const search: StationTool = {
    declaration: { name: 'search', description: 'searches', parameters: { type: 'object' } },
    freshness: 'timeless',
    run: async () => 'found',
};

function serviceFor(record: PluginRecord, health = new ModelHealth(), tools: StationTool[] = []) {
    const { config } = settingsConfig({});
    const log = logger();
    const service = new LlmService(
        { list: () => [record] } as unknown as PluginRegistry,
        passthroughInvoker(),
        new LlmGate(log as never),
        new ToolRegistry(tools.length > 0 ? [{ tools: async () => tools }] : [], log as never),
        config,
        log as never,
        health,
    );
    return { service, log, health };
}

const ask: LlmRequest = { messages: [{ role: 'user', content: 'write a back-announce' }] };
const down = (code: 'upstream' | 'unavailable' | 'timeout' | 'rate_limited' | 'not_found' | 'auth' | 'config') =>
    new PluginError(`the model failed (${code})`).withCode(code);

describe('a conversation naming several models', () => {
    it.each(['upstream', 'unavailable', 'timeout', 'rate_limited', 'not_found', 'auth', 'config'] as const)(
        'hands over to the next model when the first fails with %s before answering',
        async code => {
            const { record, asked } = plugin({ 'local:one': [down(code)] });
            const { service, log } = serviceFor(record);

            const result = await service.converse(ask, { models: ['local:one', 'cloud:two'] });

            expect(result.text).toBe('answered by cloud:two');
            expect(result.model).toBe('cloud:two');
            expect(asked).toEqual(['local:one', 'cloud:two']);
            expect(log.warn).toHaveBeenCalledWith(
                'llm: a model failed before answering; asking the next one on the list',
                expect.objectContaining({ failed: 'local:one', code, next: 'cloud:two' }),
            );
        },
    );

    it('asks the first model only, when it answers', async () => {
        const { record, asked } = plugin({});
        const { service } = serviceFor(record);

        const result = await service.converse(ask, { models: ['local:one', 'cloud:two'] });

        expect(result.model).toBe('local:one');
        expect(asked).toEqual(['local:one']);
    });

    it('throws the last failure when every model on the list fails', async () => {
        const last = down('upstream');
        const { record, asked } = plugin({ 'local:one': [down('timeout')], 'cloud:two': [last] });
        const { service } = serviceFor(record);

        await expect(service.converse(ask, { models: ['local:one', 'cloud:two'] })).rejects.toBe(last);
        expect(asked).toEqual(['local:one', 'cloud:two']);
    });

    it('never hands over once the model has answered a step', async () => {
        // The first step searched, so the transcript now carries this provider's turn.
        const failure = down('upstream');
        const { record, asked } = plugin({ 'local:one': ['search', failure] });
        const { service } = serviceFor(record, new ModelHealth(), [search]);

        await expect(service.converse(ask, { models: ['local:one', 'cloud:two'] })).rejects.toBe(failure);
        expect(asked).toEqual(['local:one', 'local:one']);
    });

    it('never hands over a conversation the station stopped', async () => {
        const { record, asked } = plugin({ 'local:one': [down('upstream')] });
        const { service } = serviceFor(record);
        const stop = new AbortController();
        stop.abort();

        await expect(service.converse(ask, { models: ['local:one', 'cloud:two'], signal: stop.signal })).rejects.toBeDefined();
        expect(asked).not.toContain('cloud:two');
    });

    it('takes the request’s own model when the list is empty, and the default when that is absent too', async () => {
        const { record, asked } = plugin({});
        const { service } = serviceFor(record);

        await service.converse({ ...ask, model: 'cloud:three' }, { models: [] });
        const fallback = await service.converse(ask, { models: ['  '] });

        expect(asked).toEqual(['cloud:three', 'default:model']);
        expect(fallback.model).toBe('default:model');
    });
});

describe('a model that failed lately', () => {
    it('is asked last while it is remembered, and first again once it has answered', async () => {
        const health = new ModelHealth();
        let now = 1_000_000;
        health.now = () => now;
        const { record, asked } = plugin({ 'local:one': [down('upstream'), 'answer'] });
        const { service } = serviceFor(record, health);

        await service.converse(ask, { models: ['local:one', 'cloud:two'] });
        await service.converse(ask, { models: ['local:one', 'cloud:two'] });
        expect(asked).toEqual(['local:one', 'cloud:two', 'cloud:two']);

        now += MODEL_DOWN_MS + 1;
        await service.converse(ask, { models: ['local:one', 'cloud:two'] });
        expect(asked.at(-1)).toBe('local:one');
        expect(health.isDown('local:one')).toBe(false);
    });

    it('is still tried, in the order written, when every model is remembered as down', () => {
        const health = new ModelHealth();
        health.markDown('local:one');
        health.markDown('cloud:two');

        expect(health.ordered(['local:one', 'cloud:two'])).toEqual(['local:one', 'cloud:two']);
    });

    it('moves only the failed model to the back', () => {
        const health = new ModelHealth();
        health.markDown('cloud:two');

        expect(health.ordered(['local:one', 'cloud:two', 'cloud:three'])).toEqual(['local:one', 'cloud:three', 'cloud:two']);
    });
});
