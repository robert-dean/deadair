import { describe, expect, it } from 'vitest';

import { readModelList } from '../../../src/modules/llm/model.list.js';

describe('readModelList', () => {
    it('reads the rows in the order the operator put them', () => {
        expect(readModelList('[{"model":"local:qwen"},{"model":"cloud:sonnet"}]')).toEqual(['local:qwen', 'cloud:sonnet']);
    });

    it('names each model once, and skips a row with no model', () => {
        expect(readModelList('[{"model":"local:qwen"},{"model":" "},{"model":"local:qwen"},{"other":"x"}]')).toEqual(['local:qwen']);
    });

    it('is empty for an empty or unset value, which means the plugin default', () => {
        expect(readModelList('')).toEqual([]);
        expect(readModelList('   ')).toEqual([]);
        expect(readModelList(undefined)).toEqual([]);
        expect(readModelList('[]')).toEqual([]);
    });

    it('reads a bare provider:model, the shape every one of these was before it was a list, as a list of one', () => {
        expect(readModelList(' local:qwen ')).toEqual(['local:qwen']);
    });
});
