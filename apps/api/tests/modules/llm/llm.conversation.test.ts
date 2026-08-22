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

    it('hands back everything the model was shown, results included', async () => {
        // What makes a declining model diagnosable at all. From `toolCallsMade` alone, a model that
        // searched three times and was handed thirty-six records looks exactly like one handed
        // nothing, and the two want opposite fixes. A live run turned on that distinction.
        const { record } = scriptedPlugin([{ text: 'let me check', toolCalls: [searchCall] }, { text: 'done' }]);
        const { service } = serviceFor(record, [tool('search', async () => ({ tracks: ['Roygbiv'] }))]);

        const result = await service.converse(ask());

        expect(result.transcript.map(message => message.role)).toEqual(['user', 'assistant', 'tool']);
        expect(result.transcript.at(-1)?.content).toContain('Roygbiv');
        // It stops before the answer: the conversation as the model last saw it, with what it then
        // said beside it rather than inside it.
        expect(result.transcript.at(-1)?.content).not.toContain('done');
        expect(result.text).toBe('done');
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

    it('TELLS the model the searching is over, because withdrawing the tools says nothing', async () => {
        // Measured: a briefed refill made five productive searches, gathered two dozen usable
        // records, and then the final generation — made with no declarations at all — came back with
        // no text and a `tool-calls` finish reason. It asked for a tool that was not there and spent
        // the one step that existed for answering.
        const { record, asked } = scriptedPlugin([{ toolCalls: [looping] }, { text: 'that was Roygbiv' }]);
        const { service } = serviceFor(record, [tool('search', async () => 'found')]);

        await service.converse(ask(), { maxToolSteps: 1 });

        const last = asked[1]?.messages ?? [];
        expect(last[last.length - 1]).toMatchObject({ role: 'user' });
        expect(String(last[last.length - 1]?.content)).toMatch(/no tools left to call/);
        // The consequence, which is the half that makes a rule land rather than be noted.
        expect(String(last[last.length - 1]?.content)).toMatch(/ends this with nothing/);
    });

    it('tells a conversation that never used a tool nothing at all', async () => {
        // It is not being cut off. A model that answered without searching has nothing to be told,
        // and a sentence about tools it never called is context spent on a situation it is not in.
        const { record, asked } = scriptedPlugin([{ text: 'that was Roygbiv' }]);
        const { service } = serviceFor(record, [tool('search', async () => 'found')]);

        await service.converse(ask(), { maxToolSteps: 0 });

        expect(asked[0]?.messages.some(message => String(message.content).includes('no tools left'))).toBe(false);
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

describe('a model that stopped without answering', () => {
    const searchCall: LlmToolCall = { id: 'call_1', name: 'search', arguments: {} };

    it('asks once more rather than taking an empty reply as an answer', async () => {
        // The loop ends when a generation has no tool calls, because that is what an answer looks
        // like. Measured: a briefed refill made four good searches and then replied with nothing at
        // all, two steps unspent, and the hour went to the floor.
        const { record, asked } = scriptedPlugin([{ text: 'let me check', toolCalls: [searchCall] }, { text: '' }, { text: 'that was Roygbiv' }]);
        const { service } = serviceFor(record, [tool('search', async () => 'found')]);

        const result = await service.converse(ask());

        expect(result.text).toBe('that was Roygbiv');
        const nudged = asked[2]?.messages ?? [];
        expect(String(nudged[nudged.length - 1]?.content)).toMatch(/That was not an answer/);
        // It must NOT say the tools are gone, unlike the last-step turn: searching is still one of
        // the two ways out, and this failure is a model that fell between them.
        expect(String(nudged[nudged.length - 1]?.content)).not.toMatch(/no tools left/);
    });

    it('lets the caller say what an answer is, since only it knows the format', async () => {
        // Prose is a break writer's answer and a set generator's failure. Measured on the second:
        // `Need more. Let's fetch Lost Years.` as a final message, read as an answer by the loop.
        const { record } = scriptedPlugin([{ text: "Need more. Let's fetch Lost Years." }, { text: '[{"title":"Ocean Drive"}]' }]);
        const { service } = serviceFor(record, [tool('search', async () => 'found')]);

        const result = await service.converse(ask(), { answersWith: text => text.trim().startsWith('[') });

        expect(result.text).toBe('[{"title":"Ocean Drive"}]');
    });

    it('asks once and then takes what it gets', async () => {
        // A model asked plainly and still unable to answer is not going to, and every further
        // attempt spends a step the caller's floor could have had.
        const { record, asked } = scriptedPlugin([{ text: '' }]);
        const { service } = serviceFor(record, [tool('search', async () => 'found')]);

        const result = await service.converse(ask(), { maxToolSteps: 4 });

        expect(result.text).toBe('');
        // Two generations, not four: the first, and the one the single nudge bought.
        expect(asked).toHaveLength(2);
    });

    it('leaves an answer the caller accepts alone', async () => {
        const { record, asked } = scriptedPlugin([{ text: 'that was Roygbiv' }]);
        const { service } = serviceFor(record, [tool('search', async () => 'found')]);

        await service.converse(ask());

        expect(asked).toHaveLength(1);
    });
});

describe('a tool call the model wrote as text', () => {
    /** A tool with real properties, since that is what a stray call is matched against. */
    const searchTool = (run: StationTool['run']): StationTool => ({
        declaration: {
            name: 'similar_artists',
            description: 'neighbours',
            parameters: { type: 'object', properties: { artist: { type: 'string' }, limit: { type: 'number' } }, required: ['artist'] },
        },
        run,
    });

    it('re-issues it rather than ending the conversation on a question', async () => {
        // The measured failure: the final message was the arguments of a `similar_artists` call with
        // no call around them, the loop read it as an answer, and a briefed hour was filled by the
        // floor. The model was one step short of answering.
        const { record } = scriptedPlugin([
            { text: '{"artist":"Mitch Murder","limit":12}' },
            { text: '[{"title":"Ocean Drive","artist":"Miami Nights 1984"}]' },
        ]);
        const run = vi.fn(async () => ({ similar: [{ artist: 'Miami Nights 1984' }] }));
        const { service } = serviceFor(record, [searchTool(run)]);

        const result = await service.converse(ask());

        expect(run).toHaveBeenCalledWith({ artist: 'Mitch Murder', limit: 12 }, expect.anything());
        expect(result.text).toBe('[{"title":"Ocean Drive","artist":"Miami Nights 1984"}]');
        // It counts as a search, because one ran.
        expect(result.toolCallsMade).toBe(1);
    });

    it('replays the rescued call as a well-formed one, and the tool turn answers its id', async () => {
        // The transcript is the model's own record of what it just did, so it is shown the shape to
        // repeat rather than the loose object it produced.
        const { record, asked } = scriptedPlugin([{ text: '{"artist":"Mitch Murder"}' }, { text: 'done' }]);
        const { service } = serviceFor(record, [searchTool(async () => ({ similar: [] }))]);

        await service.converse(ask());

        const replayed = asked[1]?.messages ?? [];
        const assistant = replayed.find(message => message.role === 'assistant');
        expect(assistant?.content).toBe('');
        expect(assistant?.toolCalls?.[0]?.name).toBe('similar_artists');
        expect(replayed.find(message => message.role === 'tool')?.toolCallId).toBe(assistant?.toolCalls?.[0]?.id);
    });

    it('leaves an answer that merely looks JSON-ish alone', async () => {
        const answer = '[{"title":"Prime Operator","artist":"Mitch Murder"}]';
        const { record } = scriptedPlugin([{ text: answer }]);
        const run = vi.fn(async () => ({ similar: [] }));
        const { service } = serviceFor(record, [searchTool(run)]);

        const result = await service.converse(ask());

        expect(run).not.toHaveBeenCalled();
        expect(result.text).toBe(answer);
    });

    it('does not rescue on the last step, where withdrawing the tools is the point', async () => {
        // The step cap exists to force words. A rescue there would reopen the loop it closes.
        const { record } = scriptedPlugin([{ text: '{"artist":"Mitch Murder","limit":12}' }]);
        const run = vi.fn(async () => ({ similar: [] }));
        const { service } = serviceFor(record, [searchTool(run)]);

        const result = await service.converse(ask(), { maxToolSteps: 0 });

        expect(run).not.toHaveBeenCalled();
        expect(result.text).toBe('{"artist":"Mitch Murder","limit":12}');
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

// The slot is taken back by aborting the holder's signal, and for a conversation that meant nothing
// until now: the loop only looked at the signal BETWEEN steps, so a refill preempted while the model
// was mid-sentence kept the slot until the model chose to stop. On the station's own host that is
// minutes, and the break that preempted it waits ten seconds and goes to the floor — which is the
// failure preemption exists to prevent, surviving inside the mechanism meant to fix it.
describe('preemption', () => {
    /** A plugin whose generation never ends on its own, which is what a slow model looks like. */
    function endlessPlugin() {
        let cancelled = false;

        const record = {
            id: 'deadair.llm',
            dir: '/plugins/llm',
            status: 'active',
            manifest: { capabilities: ['llm'] },
            instance: {
                generate: vi.fn(async () => ({
                    text: new ReadableStream<string>({
                        // Paced, because a real generation arrives over the network and every read
                        // yields to the event loop. A stream that is always ready would spin the
                        // drain on microtasks and starve the very abort it is being raced against —
                        // which is a property of the test double, not of a model.
                        async pull(controller) {
                            await new Promise(resolve => setTimeout(resolve, 5));
                            controller.enqueue('and another thing ');
                        },
                        cancel() {
                            cancelled = true;
                        },
                    }),
                    // Never settles unless the stream is cancelled, exactly as a real generation's
                    // promises behave: they are fed by the same request the stream is.
                    result: new Promise<LlmResult>(() => undefined),
                })),
                listModels: async () => [{ id: 'the-model', label: 'the-model', tools: true }],
            },
        } as unknown as PluginRecord;

        return { record, cancelled: () => cancelled };
    }

    it('comes back promptly when the model is taken away mid-generation', async () => {
        const { record, cancelled } = endlessPlugin();
        const { service, gate } = serviceFor(record);

        const conversing = service.converse(ask(), { priority: 'background' });
        // Let the generation get under way before anything asks for the slot.
        await new Promise(resolve => setImmediate(resolve));

        // What a break arriving does: outranks a refill, so the gate aborts the holder.
        const broke = gate.hold(async () => 'the break got in', { priority: 'air' });

        const result = await conversing;

        expect(result.preempted).toBe(true);
        // The plugin was actually told, rather than the host merely giving up on it.
        expect(cancelled()).toBe(true);
        await expect(broke).resolves.toBe('the break got in');
    });

    it('hands the slot on rather than holding it until the model finishes', async () => {
        const { record } = endlessPlugin();
        const { service, gate } = serviceFor(record);

        const conversing = service.converse(ask(), { priority: 'background' });
        await new Promise(resolve => setImmediate(resolve));

        let ranSecond = false;
        const second = gate.hold(
            async () => {
                ranSecond = true;
                return 'done';
            },
            { priority: 'air' },
        );

        await conversing;
        await second;

        expect(ranSecond).toBe(true);
        expect(gate.generating()).toBe(false);
    });

    it('says nothing about being preempted when the model answered normally', async () => {
        const { record } = scriptedPlugin([{ text: 'that was Roygbiv' }]);
        const { service } = serviceFor(record);

        const result = await service.converse(ask());

        expect(result.preempted).toBe(false);
        expect(result.text).toBe('that was Roygbiv');
    });
});
