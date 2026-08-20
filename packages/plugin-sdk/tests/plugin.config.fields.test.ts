import { describe, expect, it } from 'vitest';

import { configFieldSchema, parseMultiSelect, parseRows } from '../src/plugin.config.fields.js';

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

describe('parseRows', () => {
    it('reads the rows back out of the array they are stored as', () => {
        expect(parseRows('[{"name":"World","url":"https://example.com/rss.xml","category":"world"}]')).toEqual([
            { name: 'World', url: 'https://example.com/rss.xml', category: 'world' },
        ]);
    });

    it('answers empty for a field nobody has set', () => {
        expect(parseRows(undefined)).toEqual([]);
        expect(parseRows('')).toEqual([]);
        expect(parseRows('   ')).toEqual([]);
        expect(parseRows(42)).toEqual([]);
    });

    it('answers empty rather than throwing for something unreadable', () => {
        expect(parseRows('not json')).toEqual([]);
        expect(parseRows('{"url":"https://example.com"}')).toEqual([]);
        expect(parseRows('[')).toEqual([]);
    });

    it('keeps a row missing a cell, because a half-filled row is still the operator saying something', () => {
        expect(parseRows('[{"url":"https://example.com/rss.xml"}]')).toEqual([{ url: 'https://example.com/rss.xml' }]);
    });

    it('drops cells that are not usable strings, and rows left with nothing', () => {
        expect(parseRows('[{"url":"https://example.com/rss.xml","category":null,"name":"  "},{"name":""},"nope",[],null]')).toEqual([
            { url: 'https://example.com/rss.xml' },
        ]);
    });

    it('trims, so a cell that round-tripped through a form still matches', () => {
        expect(parseRows('[{"category":" sport "}]')).toEqual([{ category: 'sport' }]);
    });
});

describe('configFieldSchema', () => {
    it('accepts a list with columns, which is new', () => {
        const parsed = configFieldSchema.safeParse({
            key: 'feeds',
            label: 'Feeds',
            type: 'list',
            columns: [
                { key: 'name', label: 'Name', type: 'string' },
                { key: 'url', label: 'Address', type: 'url', required: true },
                { key: 'category', label: 'Category', type: 'string', optionsFrom: 'station.newsCategories' },
            ],
        });

        expect(parsed.success).toBe(true);
    });

    it('refuses a column type nobody defined, and an option source nothing resolves', () => {
        const columns = (column: unknown) => configFieldSchema.safeParse({ key: 'feeds', label: 'Feeds', type: 'list', columns: [column] }).success;

        expect(columns({ key: 'secret', label: 'Token', type: 'secret' })).toBe(false);
        // A dotted key reads as a path into a nested object wherever a row is edited, so the cell
        // would draw empty and submit nothing. Refused here rather than found on air.
        expect(columns({ key: 'feed.url', label: 'Address', type: 'url' })).toBe(false);
        expect(columns({ key: 'category', label: 'Category', type: 'string', optionsFrom: 'station.whatever' })).toBe(false);
    });

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
