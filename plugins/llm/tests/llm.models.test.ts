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
    it('takes the ids from the provider and qualifies them by its name', () => {
        // The operator should not have to type out what the machine already knows, least of all
        // before they have any way to find it out. The name is on the front because one station has
        // several providers now, and `gpt-oss` on two of them is two models.
        expect(describeModels('srv', ['a', 'b'], undefined, '')).toEqual([
            { id: 'srv:a', label: 'a · srv', tools: false },
            { id: 'srv:b', label: 'b · srv', tools: false },
        ]);
    });

    it('takes the tool flags from config, which is the half that is not discoverable', () => {
        expect(describeModels('srv', ['a', 'b'], JSON.stringify(['srv:b']), '')).toEqual([
            { id: 'srv:a', label: 'a · srv', tools: false },
            { id: 'srv:b', label: 'b · srv', tools: true },
        ]);
    });

    it('takes the provider at its word when it says every model takes tools', () => {
        // A vendor serving its own models knows; asking an operator to tick a box confirming it is
        // asking them for something already known.
        expect(describeModels('claude', ['a'], undefined, '', true)).toEqual([{ id: 'claude:a', label: 'a · claude', tools: true }]);
    });

    it('keeps the order the provider reported', () => {
        expect(describeModels('srv', ['z', 'a'], undefined, '').map(model => model.id)).toEqual(['srv:z', 'srv:a']);
    });

    it('keeps a ticked model the provider never listed', () => {
        // A proxy that serves a model without listing it is a real thing, and dropping the entry
        // would silently disable tools on it.
        expect(describeModels('srv', ['a'], JSON.stringify(['srv:behind-a-proxy']), '')).toEqual([
            { id: 'srv:a', label: 'a · srv', tools: false },
            { id: 'srv:behind-a-proxy', label: 'behind-a-proxy · srv', tools: true },
        ]);
    });

    it("leaves another provider's ticked models alone", () => {
        // Each provider describes only its own. Folding in a name belonging to a different row
        // would put a model on a server that has never heard of it.
        expect(describeModels('srv', ['a'], JSON.stringify(['other:b']), '').map(model => model.id)).toEqual(['srv:a']);
    });

    it('marks which entry an unnamed request will reach', () => {
        // Without this the host has to assume the worst model on the server, and would never send
        // tools to a station with more than a couple installed.
        const models = describeModels('srv', ['a', 'b'], undefined, 'srv:b');

        expect(models.find(model => model.id === 'srv:b')?.default).toBe(true);
        expect(models.find(model => model.id === 'srv:a')?.default).toBeUndefined();
    });

    it('marks nothing when the default lives on another provider', () => {
        // Two entries marked default would leave the host picking whichever it saw first.
        expect(describeModels('srv', ['a'], undefined, 'other:a').every(model => model.default === undefined)).toBe(true);
    });

    it('answers nothing when there is nothing anywhere', () => {
        // The host reads this to decide whether it may send tools. Inventing an entry would be
        // claiming a model exists that nothing can call.
        expect(describeModels('srv', [], '', '')).toEqual([]);
    });
});
