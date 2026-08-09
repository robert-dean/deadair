import { describe, expect, it } from 'vitest';

import { configFieldSchema, parseMultiSelect } from '../src/plugin.config.fields.js';

describe('parseMultiSelect', () => {
    it('reads the values back out of the array they are stored as', () => {
        expect(parseMultiSelect('["a","b"]')).toEqual(['a', 'b']);
    });

    it('answers empty for a field nobody has set', () => {
        expect(parseMultiSelect(undefined)).toEqual([]);
        expect(parseMultiSelect('')).toEqual([]);
        expect(parseMultiSelect('   ')).toEqual([]);
    });

    it('answers empty rather than throwing for something unreadable', () => {
        // Hand-edited config is a thing operators do. For a field like "which models can
        // use tools" this is the difference between a degraded station and one that will
        // not start.
        expect(parseMultiSelect('not json')).toEqual([]);
        expect(parseMultiSelect('{"a":1}')).toEqual([]);
        expect(parseMultiSelect('[')).toEqual([]);
    });

    it('drops entries that are not usable strings', () => {
        expect(parseMultiSelect('["a",null,3,"","  ","b"]')).toEqual(['a', 'b']);
    });

    it('trims, so a value that round-tripped through a form still matches', () => {
        expect(parseMultiSelect('[" a "]')).toEqual(['a']);
    });

    it('ignores a non-string entirely', () => {
        expect(parseMultiSelect(42)).toEqual([]);
        expect(parseMultiSelect(null)).toEqual([]);
    });
});

describe('configFieldSchema', () => {
    it('accepts a multiselect, which is new', () => {
        const parsed = configFieldSchema.safeParse({
            key: 'models',
            label: 'Models',
            type: 'multiselect',
            options: [{ value: 'a', label: 'a' }],
        });

        expect(parsed.success).toBe(true);
    });

    it('still refuses a type nobody defined', () => {
        expect(configFieldSchema.safeParse({ key: 'k', label: 'l', type: 'freeform' }).success).toBe(false);
    });
});
