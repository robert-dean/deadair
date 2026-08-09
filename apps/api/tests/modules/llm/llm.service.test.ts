// Two claims under test. First, that "no model" is a state rather than a fault, because a station
// with no model plugin is every fresh install and it still writes its own breaks. Second, that tool
// support is decided per MODEL and errs toward sending none, because the cost of being wrong is a
// failed generation and the cost of being cautious is a line written without facts.

import { describe, expect, it, vi } from 'vitest';
import { isPluginError, type LlmModelInfo, type LlmPluginInstance } from '@deadair/plugin-sdk';

import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { LlmGate } from '../../../src/modules/llm/llm.gate.js';
import { LlmService } from '../../../src/modules/llm/llm.service.js';
import { ToolRegistry } from '../../../src/modules/llm/llm.tools.js';
import { LLM_PLUGIN_KEY } from '../../../src/modules/llm/llm.settings.js';
import { settingsConfig } from '../../utils/settings.config.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

/** Runs the work, like the real invoker does on the happy path. The breaker is its own file's business. */
const passthroughInvoker = () =>
    ({ invoke: vi.fn(async (_id: string, _op: string, work: () => Promise<unknown>) => work()) }) as unknown as PluginInvoker;

interface FakeOptions {
    id?: string;
    models?: LlmModelInfo[];
    /** Omit `listModels` entirely, as a plugin that never wrote it does. */
    listsModels?: boolean;
}

function fakeLlmPlugin(options: FakeOptions = {}): PluginRecord {
    const instance: Partial<LlmPluginInstance> = {
        generate: vi.fn(async () => ({
            text: new ReadableStream<string>({
                start(controller) {
                    controller.enqueue('words');
                    controller.close();
                },
            }),
            result: Promise.resolve({ text: 'words', toolCalls: [], finishReason: 'stop' as const }),
        })),
    };

    if (options.listsModels !== false) {
        instance.listModels = vi.fn(async () => options.models ?? []);
    }

    return {
        id: options.id ?? 'deadair.llm',
        dir: '/plugins/llm',
        status: 'active',
        manifest: { capabilities: ['llm'] },
        instance,
    } as unknown as PluginRecord;
}

function serviceFor(records: PluginRecord[], settings: Record<string, string> = {}) {
    const { config, set } = settingsConfig(settings);
    const gate = new LlmGate(logger());
    const service = new LlmService(
        { list: () => records } as unknown as PluginRegistry,
        passthroughInvoker(),
        gate,
        // No sources: what the loop does with tools is `llm.conversation.test.ts`'s business.
        new ToolRegistry([], logger()),
        config,
        logger(),
    );
    return { service, set, gate };
}

describe('choosing a generator', () => {
    it('answers undefined rather than throwing when nothing is installed', () => {
        const { service } = serviceFor([]);

        expect(service.generator()).toBeUndefined();
        expect(service.canGenerate()).toBe(false);
    });

    it('picks the only candidate with nothing configured', () => {
        const { service } = serviceFor([fakeLlmPlugin()]);

        expect(service.generator()?.record.id).toBe('deadair.llm');
        expect(service.canGenerate()).toBe(true);
    });

    it('follows the setting when it changes underneath a live service', () => {
        // The config is read per call rather than cached, so an operator's write is live on the
        // next generation instead of on the next restart.
        const { service, set } = serviceFor([fakeLlmPlugin({ id: 'a' }), fakeLlmPlugin({ id: 'b' })]);

        expect(service.generator()).toBeUndefined();

        set(LLM_PLUGIN_KEY, 'b');
        expect(service.generator()?.record.id).toBe('b');
    });

    it('throws `unavailable` from generate, with the reason in the message', async () => {
        const { service } = serviceFor([]);

        try {
            await service.generate({ messages: [{ role: 'user', content: 'hi' }] });
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(isPluginError(error)).toBe(true);
            if (isPluginError(error)) {
                expect(error.code).toBe('unavailable');
                expect(error.message).toContain('install');
            }
        }
    });

    it('generates through the chosen plugin', async () => {
        const { service } = serviceFor([fakeLlmPlugin()]);

        const handle = await service.generate({ messages: [{ role: 'user', content: 'hi' }] });

        await expect(handle.result).resolves.toMatchObject({ text: 'words', finishReason: 'stop' });
    });

    it('runs every generation through the gate, so nothing bypasses the one slot', async () => {
        // Asserted rather than assumed: a path that reached the plugin directly would work
        // perfectly in isolation and overlap generations on a live station.
        const { service, gate } = serviceFor([fakeLlmPlugin()]);

        const handle = await service.generate({ messages: [{ role: 'user', content: 'hi' }] });
        expect(gate.generating()).toBe(true);

        await handle.text.cancel();
        expect(gate.generating()).toBe(false);
    });

    it('holds the slot across a preview too, which is the path most likely to be special-cased', async () => {
        const { service, gate } = serviceFor([fakeLlmPlugin()]);
        const plugin = service.generator()!;

        const handle = await service.generateWith(plugin, { messages: [{ role: 'user', content: 'hi' }] });
        expect(gate.generating()).toBe(true);

        await handle.text.cancel();
        expect(gate.generating()).toBe(false);
    });
});

describe('supportsTools', () => {
    const withModels = (models: LlmModelInfo[]) => {
        const { service } = serviceFor([fakeLlmPlugin({ models })]);
        return { service, plugin: service.generator()! };
    };

    it('answers for the named model', async () => {
        const { service, plugin } = withModels([
            { id: 'big', tools: true },
            { id: 'small', tools: false },
        ]);

        await expect(service.supportsTools(plugin, 'big')).resolves.toBe(true);
        await expect(service.supportsTools(plugin, 'small')).resolves.toBe(false);
    });

    it('answers false for a model the plugin never listed', async () => {
        const { service, plugin } = withModels([{ id: 'big', tools: true }]);

        await expect(service.supportsTools(plugin, 'unlisted')).resolves.toBe(false);
    });

    it('asks about the marked default when none was named', async () => {
        // Which is the answer that matters once models are discovered rather than typed: a server
        // with a dozen installed would otherwise never be sent tools at all.
        const { service, plugin } = withModels([
            { id: 'big', tools: true, default: true },
            { id: 'small', tools: false },
        ]);

        await expect(service.supportsTools(plugin, undefined)).resolves.toBe(true);
    });

    it('believes a marked default that cannot take tools, even beside ones that can', async () => {
        const { service, plugin } = withModels([
            { id: 'big', tools: true },
            { id: 'small', tools: false, default: true },
        ]);

        await expect(service.supportsTools(plugin, undefined)).resolves.toBe(false);
    });

    it('needs EVERY model to support tools when the plugin marked no default', async () => {
        // The fallback for a plugin that will not say which model an unnamed request reaches.
        // Correct, and increasingly useless the more models a server has, which is why the SDK asks.
        const { service, plugin } = withModels([
            { id: 'big', tools: true },
            { id: 'small', tools: false },
        ]);

        await expect(service.supportsTools(plugin, undefined)).resolves.toBe(false);
    });

    it('allows tools with no model named when every model can take them and none is marked', async () => {
        const { service, plugin } = withModels([
            { id: 'big', tools: true },
            { id: 'also-big', tools: true },
        ]);

        await expect(service.supportsTools(plugin, undefined)).resolves.toBe(true);
        await expect(service.supportsTools(plugin, '  ')).resolves.toBe(true);
    });

    it('answers false for a plugin that cannot list its models at all', async () => {
        // The conservative reading, and the reason a plugin that wants tool calling has to describe
        // itself: there is no other way for the host to learn any model here supports them.
        const { service } = serviceFor([fakeLlmPlugin({ listsModels: false })]);
        const plugin = service.generator()!;

        expect(plugin.listsModels).toBe(false);
        await expect(service.supportsTools(plugin, 'anything')).resolves.toBe(false);
    });

    it('answers false when the plugin lists nothing', async () => {
        const { service, plugin } = withModels([]);

        await expect(service.supportsTools(plugin, undefined)).resolves.toBe(false);
    });
});
