// The tool loop. Three claims worth pinning:
//
// 1. An assistant turn that asked for a tool is replayed WITH its calls, and the tool turn names the
//    id it answers. A model that cannot see its own request has no idea what the result after it is
//    answering, and invents what the question was.
// 2. The whole loop is ONE gate admission. Releasing between round trips would let another
//    generation interleave and evict the cache this loop's next step is about to want.
// 3. The loop always ends in words. Running out of steps must not hand a caller a result whose only
//    content is a request nobody will run, which reads downstream as the model having said nothing.

import { describe, expect, it, vi } from 'vitest';
import { isPluginError, type LlmMessage, type LlmRequest, type LlmResult, type LlmToolCall } from '@deadair/plugin-sdk';

import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { LlmGate } from '../../../src/modules/llm/llm.gate.js';
import { LlmService } from '../../../src/modules/llm/llm.service.js';
import { ToolRegistry, type StationTool, type ToolSource } from '../../../src/modules/llm/llm.tools.js';
import { settingsConfig } from '../../utils/settings.config.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

const passthroughInvoker = () =>
    ({ invoke: vi.fn(async (_id: string, _op: string, work: () => Promise<unknown>) => work()) }) as unknown as PluginInvoker;

/** One scripted answer from the model. */
interface Turn {
    text?: string;
    toolCalls?: LlmToolCall[];
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

/**
 * A plugin that answers with the scripted turns in order, recording what it was asked each time.
 * The recorded requests are the point: this is how the conversation's shape is asserted.
 */
function scriptedPlugin(turns: Turn[], options: { tools?: boolean } = {}) {
    const asked: LlmRequest[] = [];
    let index = 0;

    const record = {
        id: 'deadair.llm',
        dir: '/plugins/llm',
        status: 'active',
        manifest: { capabilities: ['llm'] },
        instance: {
            generate: vi.fn(async (request: LlmRequest) => {
                // Copied, because the service mutates its own message array between steps.
                asked.push({ ...request, messages: [...request.messages] });

                const turn = turns[Math.min(index, turns.length - 1)] ?? {};
                index += 1;

                const result: LlmResult = {
                    text: turn.text ?? '',
                    toolCalls: turn.toolCalls ?? [],
                    ...(turn.usage === undefined ? {} : { usage: turn.usage }),
                    finishReason: (turn.toolCalls?.length ?? 0) > 0 ? 'tool-calls' : 'stop',
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
            listModels: async () => [{ id: 'the-model', label: 'the-model', tools: options.tools ?? true }],
        },
    } as unknown as PluginRecord;

    return { record, asked };
}

const tool = (name: string, run: StationTool['run']): StationTool => ({
    declaration: { name, description: `does ${name}`, parameters: { type: 'object' } },
    run,
});

const source = (tools: StationTool[]): ToolSource => ({ tools: async () => tools });

function serviceFor(record: PluginRecord, tools: StationTool[] = []) {
    const { config } = settingsConfig({});
    const gate = new LlmGate(logger());
    const registry = new ToolRegistry(tools.length > 0 ? [source(tools)] : [], logger());
    const service = new LlmService({ list: () => [record] } as unknown as PluginRegistry, passthroughInvoker(), gate, registry, config, logger());

    return { service, gate };
}

const ask = (content = 'write a back-announce'): LlmRequest => ({ messages: [{ role: 'user', content }], model: 'the-model' });

describe('a conversation with no tools involved', () => {
    it('answers in one step', async () => {
        const { record, asked } = scriptedPlugin([{ text: 'that was Roygbiv' }]);
        const { service } = serviceFor(record);

        const result = await service.converse(ask());

        expect(result.text).toBe('that was Roygbiv');
        expect(asked).toHaveLength(1);
    });

    it('offers no tools when there are none registered', async () => {
        const { record, asked } = scriptedPlugin([{ text: 'done' }]);
        const { service } = serviceFor(record);

        await service.converse(ask());

        expect(asked[0]?.tools).toBeUndefined();
    });

    it('offers no tools to a model that is not declared able to take them', async () => {
        const { record, asked } = scriptedPlugin([{ text: 'done' }], { tools: false });
        const { service } = serviceFor(record, [tool('search', async () => 'found')]);

        await service.converse(ask());

        expect(asked[0]?.tools).toBeUndefined();
    });

    it('offers none when the caller said not to', async () => {
        const { record, asked } = scriptedPlugin([{ text: 'done' }]);
        const { service } = serviceFor(record, [tool('search', async () => 'found')]);

        await service.converse(ask(), { tools: false });

        expect(asked[0]?.tools).toBeUndefined();
    });

    it('throws `unavailable` when there is no model at all', async () => {
        const { config } = settingsConfig({});
        const service = new LlmService(
            { list: () => [] } as unknown as PluginRegistry,
            passthroughInvoker(),
            new LlmGate(logger()),
            new ToolRegistry([], logger()),
            config,
            logger(),
        );

        await expect(service.converse(ask())).rejects.toSatisfy(error => isPluginError(error) && error.code === 'unavailable');
    });
});

describe('a conversation that uses a tool', () => {
    const searchCall: LlmToolCall = { id: 'call_1', name: 'search', arguments: { query: 'boc' } };

    it('runs the tool and asks again with the result', async () => {
        const { record, asked } = scriptedPlugin([{ text: 'let me check', toolCalls: [searchCall] }, { text: 'that was Roygbiv' }]);
        const run = vi.fn(async () => ({ tracks: ['Roygbiv'] }));
        const { service } = serviceFor(record, [tool('search', run)]);

        const result = await service.converse(ask());

        expect(run).toHaveBeenCalledWith({ query: 'boc' }, expect.anything());
        expect(result.text).toBe('that was Roygbiv');
        expect(asked).toHaveLength(2);
    });

    it('replays the assistant turn WITH its calls, and the tool turn naming the id', async () => {
        // The claim that keeps a model from inventing what it asked. Both halves matter.
        const { record, asked } = scriptedPlugin([{ text: 'let me check', toolCalls: [searchCall] }, { text: 'done' }]);
        const { service } = serviceFor(record, [tool('search', async () => 'found')]);

        await service.converse(ask());

        const second = asked[1]?.messages as LlmMessage[];
        expect(second.map(message => message.role)).toEqual(['user', 'assistant', 'tool']);
        expect(second[1]?.toolCalls).toEqual([searchCall]);
        expect(second[1]?.content).toBe('let me check');
        expect(second[2]?.toolCallId).toBe('call_1');
        expect(second[2]?.content).toBe('"found"');
    });

    it('answers several calls in one turn, each against its own id', async () => {
        const two: LlmToolCall[] = [
            { id: 'a', name: 'search', arguments: { query: 'one' } },
            { id: 'b', name: 'search', arguments: { query: 'two' } },
        ];
        const { record, asked } = scriptedPlugin([{ toolCalls: two }, { text: 'done' }]);
        const { service } = serviceFor(record, [tool('search', async args => `hit for ${String(args.query)}`)]);

        await service.converse(ask());

        const second = asked[1]?.messages as LlmMessage[];
        expect(second.filter(message => message.role === 'tool').map(message => message.toolCallId)).toEqual(['a', 'b']);
    });

    it('carries on when the tool fails, handing the failure back as the answer', async () => {
        const { record, asked } = scriptedPlugin([{ toolCalls: [searchCall] }, { text: 'I could not check, but here is a safe line' }]);
        const { service } = serviceFor(record, [
            tool('search', async () => {
                throw new Error('the provider was down');
            }),
        ]);

        const result = await service.converse(ask());

        const toolTurn = (asked[1]?.messages as LlmMessage[]).find(message => message.role === 'tool');
        expect(toolTurn?.content).toContain('the provider was down');
        expect(result.text).toBe('I could not check, but here is a safe line');
    });

    it('sums usage across every step, so a caller sees what the answer really cost', async () => {
        const { record } = scriptedPlugin([
            { toolCalls: [searchCall], usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } },
            { text: 'done', usage: { inputTokens: 150, outputTokens: 20, totalTokens: 170 } },
        ]);
        const { service } = serviceFor(record, [tool('search', async () => 'found')]);

        const result = await service.converse(ask());

        expect(result.usage).toEqual({ inputTokens: 250, outputTokens: 30, totalTokens: 280 });
    });
});

describe('bounding the loop', () => {
    const looping: LlmToolCall = { id: 'call_1', name: 'search', arguments: {} };

    it('stops after the step cap and makes the last call WITHOUT tools', async () => {
        // Otherwise the caller gets a result whose only content is a request nobody will run, which
        // reads downstream as the model having said nothing at all.
        const { record, asked } = scriptedPlugin([{ toolCalls: [looping] }]);
        const { service } = serviceFor(record, [tool('search', async () => 'found')]);

        const result = await service.converse(ask(), { maxToolSteps: 2 });

        expect(asked).toHaveLength(3);
        expect(asked[0]?.tools).toBeDefined();
        expect(asked[1]?.tools).toBeDefined();
        // The last one is asked with none, so the model has to answer in words.
        expect(asked[2]?.tools).toBeUndefined();
        expect(result).toBeDefined();
    });

    it('does not run a tool for the final toolless step', async () => {
        const run = vi.fn(async () => 'found');
        const { record } = scriptedPlugin([{ toolCalls: [looping] }]);
        const { service } = serviceFor(record, [tool('search', run)]);

        await service.converse(ask(), { maxToolSteps: 1 });

        // One round trip of tools, not two: the capped step never gets to ask.
        expect(run).toHaveBeenCalledTimes(1);
    });
});

describe('the gate', () => {
    it('holds the model for the WHOLE loop rather than per round trip', async () => {
        // Asserted from inside a tool, which is the station's own work between two generations. If
        // the slot were released per generation, this is exactly where another one would slip in.
        const { record } = scriptedPlugin([{ toolCalls: [{ id: 'c', name: 'peek', arguments: {} }] }, { text: 'done' }]);

        let heldDuringToolCall: boolean | undefined;
        const { service, gate } = serviceFor(record, [
            tool('peek', async () => {
                heldDuringToolCall = gate.generating();
                return 'looked';
            }),
        ]);

        await service.converse(ask());

        expect(heldDuringToolCall).toBe(true);
        // And it comes back when the conversation ends.
        expect(gate.generating()).toBe(false);
    });

    it('gives the slot back when the conversation throws', async () => {
        const { record } = scriptedPlugin([{ text: 'never got here' }]);
        (record.instance as unknown as { generate: unknown }).generate = async () => {
            throw new Error('the model refused');
        };
        const { service, gate } = serviceFor(record);

        await expect(service.converse(ask())).rejects.toThrow('the model refused');
        expect(gate.generating()).toBe(false);
    });
});
