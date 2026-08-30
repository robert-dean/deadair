// The rule this file exists to pin: a failed tool is an ANSWER, not an exception. The model asked a
// question and "that did not work" is a true reply to it, which it can act on. Throwing instead
// would lose a whole generation over a search that timed out.

import { describe, expect, it, vi } from 'vitest';
import type { LlmToolCall } from '@deadair/plugin-sdk';

import { ToolRegistry, type StationTool, type ToolSource } from '../../../src/modules/llm/llm.tools.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

const tool = (name: string, run: StationTool['run']): StationTool => ({
    declaration: { name, description: `does ${name}`, parameters: { type: 'object' } },
    freshness: 'timeless',
    run,
});

const source = (tools: StationTool[]): ToolSource => ({ tools: async () => tools });

const call = (name: string, args: Record<string, unknown> = {}): LlmToolCall => ({ id: 'call_1', name, arguments: args });

describe('collecting tools', () => {
    it('gathers from every source', async () => {
        const registry = new ToolRegistry([source([tool('a', async () => 1)]), source([tool('b', async () => 2)])], logger());

        expect([...(await registry.tools()).keys()]).toEqual(['a', 'b']);
    });

    it('keeps the first of a duplicated name rather than throwing', async () => {
        // Two sources choosing the same word should be fixed, but not by taking the station's whole
        // ability to write a break with it.
        const registry = new ToolRegistry([source([tool('same', async () => 'first')]), source([tool('same', async () => 'second')])], logger());

        const tools = await registry.tools();

        expect(tools.size).toBe(1);
        await expect(registry.run(call('same'), tools)).resolves.toBe('"first"');
    });

    it('carries on when a source cannot say what it offers', async () => {
        const broken: ToolSource = {
            tools: async () => {
                throw new Error('the registry was mid-reload');
            },
        };
        const registry = new ToolRegistry([broken, source([tool('works', async () => 1)])], logger());

        expect([...(await registry.tools()).keys()]).toEqual(['works']);
    });

    it('answers declarations in the shape the model is sent', async () => {
        const registry = new ToolRegistry([source([tool('a', async () => 1)])], logger());

        expect(await registry.declarations()).toEqual([{ name: 'a', description: 'does a', parameters: { type: 'object' } }]);
    });
});

describe('running a call', () => {
    const registryWith = (tools: StationTool[]) => new ToolRegistry([source(tools)], logger());

    it('serializes the result as JSON', async () => {
        const registry = registryWith([tool('search', async () => ({ tracks: [{ title: 'Roygbiv' }] }))]);

        await expect(registry.run(call('search'), await registry.tools())).resolves.toBe('{"tracks":[{"title":"Roygbiv"}]}');
    });

    it('passes the model arguments through untouched', async () => {
        const run = vi.fn(async () => 'ok');
        const registry = registryWith([tool('search', run)]);

        await registry.run(call('search', { query: 'boc', limit: 3 }), await registry.tools());

        expect(run).toHaveBeenCalledWith({ query: 'boc', limit: 3 }, undefined);
    });

    it('answers rather than throws for a tool that failed', async () => {
        const registry = registryWith([
            tool('search', async () => {
                throw new Error('the provider was down');
            }),
        ]);

        const answer = await registry.run(call('search'), await registry.tools());

        expect(answer).toContain('the provider was down');
    });

    it('answers rather than throws for a name nothing offers, and says what there is', async () => {
        const registry = registryWith([tool('search', async () => 1)]);

        const answer = await registry.run(call('nonexistent'), await registry.tools());

        expect(answer).toContain('nonexistent');
        expect(answer).toContain('search');
    });

    it('says so when there are no tools at all', async () => {
        const registry = new ToolRegistry([], logger());

        await expect(registry.run(call('anything'), await registry.tools())).resolves.toContain('none');
    });

    it('answers rather than throws for a result that cannot be serialized', async () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        const registry = registryWith([tool('bad', async () => cyclic)]);

        await expect(registry.run(call('bad'), await registry.tools())).resolves.toContain('could not be read');
    });

    it('reports a tool that returned nothing', async () => {
        const registry = registryWith([tool('quiet', async () => undefined)]);

        await expect(registry.run(call('quiet'), await registry.tools())).resolves.toContain('returned nothing');
    });

    it('truncates a result too big to be worth showing, and says it did', async () => {
        // Context the model spends on four hundred search hits is context it has less room to think
        // in, which on the station's own hardware is the difference between fast and spilling VRAM.
        const registry = registryWith([tool('huge', async () => 'x'.repeat(10_000))]);

        const answer = await registry.run(call('huge'), await registry.tools());

        expect(answer.length).toBeLessThan(10_000);
        expect(answer).toContain('truncated');
    });
});
