import { describe, expect, it } from 'vitest';

import { describeModels, isParseableModelList, parseModelList } from '../src/llm.models.js';

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

describe('describeModels', () => {
    it('folds the default model in when it was not listed, without tools', () => {
        expect(describeModels('other +tools', 'the-default')).toEqual([
            { id: 'the-default', label: 'the-default', tools: false },
            { id: 'other', label: 'other', tools: true },
        ]);
    });

    it('leaves the default alone when it was listed, keeping its declared tool support', () => {
        expect(describeModels('the-default +tools', 'the-default')).toEqual([{ id: 'the-default', label: 'the-default', tools: true }]);
    });

    it('answers just the default when nothing is listed', () => {
        expect(describeModels(undefined, 'the-default')).toEqual([{ id: 'the-default', label: 'the-default', tools: false }]);
    });

    it('answers nothing when there is no default and no list', () => {
        // The host reads this to decide whether it may send tools. Inventing an
        // entry here would be claiming a model exists that nothing can call.
        expect(describeModels('', '')).toEqual([]);
    });
});
