import { describe, expect, it } from 'vitest';

import { describeModels, isParseableModelList, parseModelList, toolCapableModels } from '../src/llm.models.js';

describe('parseModelList', () => {
    it('reads one model per line', () => {
        expect(parseModelList('gpt-oss:20b\nllama3.2:1b')).toEqual([
            { id: 'gpt-oss:20b', tools: false },
            { id: 'llama3.2:1b', tools: false },
        ]);
    });

    it('reads a comma-separated list too, so a one-line answer works', () => {
        expect(parseModelList('a, b')).toEqual([
            { id: 'a', tools: false },
            { id: 'b', tools: false },
        ]);
    });

    it('marks tool support from the suffix, with or without the plus and in any case', () => {
        expect(parseModelList('a +tools\nb tools\nc +TOOLS')).toEqual([
            { id: 'a', tools: true },
            { id: 'b', tools: true },
            { id: 'c', tools: true },
        ]);
    });

    it('keeps a colon or a slash in a model id, which every real one has', () => {
        expect(parseModelList('registry/org/gpt-oss:20b +tools')).toEqual([{ id: 'registry/org/gpt-oss:20b', tools: true }]);
    });

    it('lets a later line correct an earlier one', () => {
        expect(parseModelList('a\na +tools')).toEqual([{ id: 'a', tools: true }]);
    });

    it('drops blank entries rather than producing empty ids', () => {
        expect(parseModelList('a,,\n\n  \nb')).toEqual([
            { id: 'a', tools: false },
            { id: 'b', tools: false },
        ]);
    });

    it('answers empty for nothing at all', () => {
        expect(parseModelList(undefined)).toEqual([]);
        expect(parseModelList('   ')).toEqual([]);
    });

    it('does not read a model literally named "tools" as a flag on nothing', () => {
        // "+tools" alone leaves no id behind, and an entry with no id is dropped
        // rather than becoming a nameless model the station could try to call.
        expect(parseModelList('+tools')).toEqual([]);
    });
});

describe('isParseableModelList', () => {
    it('accepts an empty list: not configuring models is legitimate', () => {
        expect(isParseableModelList(undefined)).toBe(true);
        expect(isParseableModelList('  ')).toBe(true);
    });

    it('accepts anything that yields at least one model', () => {
        expect(isParseableModelList('a +tools')).toBe(true);
    });

    it('refuses text that yields none, which means the operator typed something and got nothing', () => {
        expect(isParseableModelList('+tools')).toBe(false);
        expect(isParseableModelList(',,,')).toBe(false);
    });
});

describe('toolCapableModels', () => {
    it('reads the multiselect array, which is the ordinary form', () => {
        expect(toolCapableModels('["gpt-oss:20b","qwen3-coder:30b"]')).toEqual(['gpt-oss:20b', 'qwen3-coder:30b']);
    });

    it('still reads the "+tools" text the field used to be', () => {
        // An install configured before the field changed keeps its tool support. Losing it would
        // present as a DJ that quietly stopped checking the library.
        expect(toolCapableModels('gpt-oss:20b +tools\nllama3.2:1b')).toEqual(['gpt-oss:20b']);
    });

    it('answers empty for an explicitly empty selection', () => {
        expect(toolCapableModels('[]')).toEqual([]);
    });

    it('answers empty for nothing at all', () => {
        expect(toolCapableModels(undefined)).toEqual([]);
        expect(toolCapableModels('')).toEqual([]);
    });
});

describe('describeModels', () => {
    it('takes the ids from the server, which is the half that is discoverable', () => {
        // The operator should not have to type out what the machine already knows,
        // least of all before they have any way to find it out.
        expect(describeModels(['a', 'b'], undefined, '')).toEqual([
            { id: 'a', label: 'a', tools: false },
            { id: 'b', label: 'b', tools: false },
        ]);
    });

    it('takes the tool flags from config, which is the half that is not', () => {
        expect(describeModels(['a', 'b'], 'b +tools', '')).toEqual([
            { id: 'a', label: 'a', tools: false },
            { id: 'b', label: 'b', tools: true },
        ]);
    });

    it('keeps the server order, so the console lists them the way the server said', () => {
        expect(describeModels(['z', 'a'], undefined, '').map(model => model.id)).toEqual(['z', 'a']);
    });

    it('folds the default in when the server did not report it', () => {
        // A plugin that names a model it will not admit to having is a confusing
        // thing to debug.
        expect(describeModels(['a'], undefined, 'the-default').map(model => model.id)).toEqual(['a', 'the-default']);
    });

    it('does not duplicate the default when the server did report it', () => {
        expect(describeModels(['a', 'the-default'], undefined, 'the-default').map(model => model.id)).toEqual(['a', 'the-default']);
    });

    it('keeps an annotated model the server never listed', () => {
        // A proxy that serves a model without listing it is a real thing, and
        // dropping the entry would silently disable tools on it.
        expect(describeModels(['a'], 'behind-a-proxy +tools', '')).toEqual([
            { id: 'a', label: 'a', tools: false },
            { id: 'behind-a-proxy', label: 'behind-a-proxy', tools: true },
        ]);
    });

    it('answers from config alone when the server told us nothing', () => {
        // Which is what a momentary blip looks like: the console loses its list,
        // the station keeps whatever tool support it was told about.
        expect(describeModels([], 'a +tools', 'the-default')).toEqual([
            { id: 'the-default', label: 'the-default', tools: false, default: true },
            { id: 'a', label: 'a', tools: true },
        ]);
    });

    it('marks which entry an unnamed request will reach', () => {
        // Without this the host has to assume the worst model on the server, and would
        // never send tools to a station with more than a couple installed.
        const models = describeModels(['a', 'b'], undefined, 'b');

        expect(models.find(model => model.id === 'b')?.default).toBe(true);
        expect(models.find(model => model.id === 'a')?.default).toBeUndefined();
    });

    it('marks nothing when there is no default to mark', () => {
        expect(describeModels(['a'], undefined, '').every(model => model.default === undefined)).toBe(true);
    });

    it('answers nothing when there is nothing anywhere', () => {
        // The host reads this to decide whether it may send tools. Inventing an
        // entry would be claiming a model exists that nothing can call.
        expect(describeModels([], '', '')).toEqual([]);
    });
});
