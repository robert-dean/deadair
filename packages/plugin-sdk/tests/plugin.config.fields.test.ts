import { describe, expect, it } from 'vitest';

import { configFieldSchema, isRowSecretKey, parseMultiSelect, parseRows, ROW_ID_KEY, rowSecretKey } from '../src/plugin.config.fields.js';

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

        expect(columns({ key: 'token', label: 'Token', type: 'password' })).toBe(false);
        expect(columns({ key: 'category', label: 'Category', type: 'string', optionsFrom: 'station.whatever' })).toBe(false);
    });

    it('accepts a secret column, which is new', () => {
        // It used to be refused, because a row is stored as plain JSON and nothing encrypted one
        // cell of it. `ROW_ID_KEY` is what changed: a ciphertext can belong to a row now.
        const parsed = configFieldSchema.safeParse({
            key: 'providers',
            label: 'Providers',
            type: 'list',
            columns: [
                { key: 'name', label: 'Name', type: 'string', required: true },
                { key: 'apiKey', label: 'API key', type: 'secret' },
            ],
        });

        expect(parsed.success).toBe(true);
    });

    it('carries a column condition through rather than stripping it, which is new', () => {
        // The schema's OUTPUT is what `plugin.loader.ts` stores as the manifest, and a `z.object`
        // strips what it does not name. So the assertion that matters is not that this parses but
        // that both properties survive the parse: a column condition the schema had not been told
        // about would be gone by the time the console asked for the form.
        const parsed = configFieldSchema.safeParse({
            key: 'providers',
            label: 'Providers',
            type: 'list',
            columns: [
                { key: 'kind', label: 'Kind', type: 'select', options: [{ value: 'server', label: 'Server' }] },
                { key: 'baseUrl', label: 'Address', type: 'url', dependsOn: 'kind', dependsOnValues: ['server'] },
            ],
        });

        expect(parsed.success).toBe(true);
        expect(parsed.data?.columns?.[1]).toMatchObject({ dependsOn: 'kind', dependsOnValues: ['server'] });
    });

    it('accepts a column condition with no values, which means any value at all', () => {
        const parsed = configFieldSchema.safeParse({
            key: 'providers',
            label: 'Providers',
            type: 'list',
            columns: [
                { key: 'kind', label: 'Kind', type: 'string' },
                { key: 'baseUrl', label: 'Address', type: 'url', dependsOn: 'kind' },
            ],
        });

        expect(parsed.success).toBe(true);
        expect(parsed.data?.columns?.[1]?.dependsOnValues).toBeUndefined();
    });

    it('refuses an empty column condition, which would name a column that cannot exist', () => {
        const column = (condition: Record<string, unknown>) =>
            configFieldSchema.safeParse({
                key: 'providers',
                label: 'Providers',
                type: 'list',
                columns: [{ key: 'baseUrl', label: 'Address', type: 'url', ...condition }],
            }).success;

        expect(column({ dependsOn: '' })).toBe(false);
        expect(column({ dependsOn: 'kind', dependsOnValues: [''] })).toBe(false);
    });

    it('refuses a key holding the one character a secret cell key is joined on', () => {
        // Otherwise a cell's ciphertext could be addressed two ways, and the host would have two
        // answers to "is this configured".
        const field = (key: string) => configFieldSchema.safeParse({ key, label: 'A field', type: 'string' }).success;
        const column = (key: string) =>
            configFieldSchema.safeParse({ key: 'rows', label: 'Rows', type: 'list', columns: [{ key, label: 'A cell', type: 'string' }] }).success;

        expect(field('a/b')).toBe(false);
        expect(column('a/b')).toBe(false);
        expect(field('a.b')).toBe(true);
    });

    it('accepts every option source the union declares', () => {
        // This schema validates real manifests at load, so a source missing from it is a plugin the
        // host refuses to start. Two were missing and nothing noticed, because no bundled plugin had
        // asked for one yet.
        const source = (optionsFrom: string) => configFieldSchema.safeParse({ key: 'a', label: 'A', type: 'string', optionsFrom }).success;

        for (const declared of [
            'station.newsCategories',
            'station.newsFeeds',
            'intl.timeZones',
            'plugins.speech',
            'plugins.llm',
            'plugins.mixer',
            'plugins.analysis',
            'llm.models',
        ]) {
            expect(source(declared), declared).toBe(true);
        }
    });

    it('takes a column key shaped however the plugin likes, dots included', () => {
        // A row editor addresses a cell by path, where a dot means a step into a nested object —
        // which is the form's problem to solve and not something a plugin author should have to
        // know about. It solves it positionally, as it already does for a dot-keyed setting.
        const parsed = configFieldSchema.safeParse({
            key: 'feeds',
            label: 'Feeds',
            type: 'list',
            columns: [{ key: 'feed.url', label: 'Address', type: 'url' }],
        });

        expect(parsed.success).toBe(true);
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

describe('a row that holds a secret', () => {
    it('addresses the cell by field, row and column', () => {
        expect(rowSecretKey('providers', 'ab12cd34', 'apiKey')).toBe('providers/ab12cd34/apiKey');
    });

    it('tells a row cell apart from a plain secret field', () => {
        // A field key is one part and can never collide with a three-part one, which is the whole
        // reason the separator is refused inside a key.
        expect(isRowSecretKey('providers/ab12cd34/apiKey')).toBe(true);
        expect(isRowSecretKey('apiKey')).toBe(false);
        expect(isRowSecretKey('oauth.tokens')).toBe(false);
    });

    it('carries its id back like any other cell', () => {
        // A plugin that ignores it behaves exactly as it did before this existed; one that reads a
        // row secret needs it, and `readRowSecret` is the only thing that looks.
        const [row] = parseRows(JSON.stringify([{ [ROW_ID_KEY]: 'ab12cd34', name: 'ollama' }]));

        expect(row).toEqual({ [ROW_ID_KEY]: 'ab12cd34', name: 'ollama' });
    });
});
