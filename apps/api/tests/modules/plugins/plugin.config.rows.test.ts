// A credential inside a ROW, which needed the one thing a list never had: a name for the row. The
// console rewrites the whole array on every save and the operator can reorder it, so "the key in the
// third row" is a coincidence rather than an address. Every case here is about what that buys and
// about the rule the module exists to keep — a secret cell is never in the row.

import { describe, expect, it } from 'vitest';
import { parseRows, ROW_ID_KEY, rowSecretKey, type ConfigField } from '@deadair/plugin-sdk';

import { configuredCells, formAsItWillBe, holdsRowSecrets, splitRowSecrets } from '../../../src/modules/plugins/plugin.config.rows.js';

const PROVIDERS: ConfigField = {
    key: 'providers',
    label: 'Providers',
    type: 'list',
    columns: [
        { key: 'name', label: 'Name', type: 'string' },
        { key: 'baseUrl', label: 'Address', type: 'url' },
        { key: 'apiKey', label: 'API key', type: 'secret' },
    ],
};

/** A list with nothing to encrypt, which must go on behaving exactly as it always did. */
const FEEDS: ConfigField = {
    key: 'feeds',
    label: 'Feeds',
    type: 'list',
    columns: [{ key: 'url', label: 'Address', type: 'url' }],
};

const API_KEY: ConfigField = { key: 'apiKey', label: 'API key', type: 'secret' };

/** Legible in an assertion, and enough to prove a value was encrypted rather than passed through. */
const encrypt = (plaintext: string): string => `enc(${plaintext})`;

const rows = (...entries: Record<string, unknown>[]): string => JSON.stringify(entries);

/** What was stored for the list, read back the way a plugin reads it. */
const storedRows = (value: string) => parseRows(value);

describe('splitting a submitted list', () => {
    it('mints an id for a new row and keeps the one an existing row has', () => {
        const split = splitRowSecrets(PROVIDERS, rows({ name: 'ollama' }, { [ROW_ID_KEY]: 'kept1', name: 'groq' }), {}, encrypt);

        const [fresh, existing] = storedRows(split.value);
        expect(fresh?.[ROW_ID_KEY]).toMatch(/^[\w-]+$/);
        expect(existing?.[ROW_ID_KEY]).toBe('kept1');
    });

    it('encrypts the cell and takes it out of the row', () => {
        // The rule the whole module keeps. A row that still carried the key would be a JSON string
        // with a password in it, which is the thing a secret column exists not to be.
        const split = splitRowSecrets(PROVIDERS, rows({ [ROW_ID_KEY]: 'r1', name: 'claude', apiKey: 'sk-live' }), {}, encrypt);

        expect(split.secrets).toEqual({ 'providers/r1/apiKey': 'enc(sk-live)' });
        expect(storedRows(split.value)).toEqual([{ [ROW_ID_KEY]: 'r1', name: 'claude' }]);
        expect(split.value).not.toContain('sk-live');
    });

    it('keeps what is stored when the cell comes back untouched', () => {
        // The same contract a secret FIELD has: an operator saving the rest of the form must not
        // have to retype every credential in the table.
        const split = splitRowSecrets(PROVIDERS, rows({ [ROW_ID_KEY]: 'r1', name: 'claude' }), { 'providers/r1/apiKey': 'enc(old)' }, encrypt);

        expect(split.secrets).toEqual({ 'providers/r1/apiKey': 'enc(old)' });
    });

    it('clears the cell when it comes back null', () => {
        // `null` rather than `''`: an empty string is what a half-typed field looks like, and
        // clearing a credential is deliberate enough to deserve its own value.
        const split = splitRowSecrets(
            PROVIDERS,
            rows({ [ROW_ID_KEY]: 'r1', name: 'claude', apiKey: null }),
            { 'providers/r1/apiKey': 'enc(old)' },
            encrypt,
        );

        expect(split.secrets).toEqual({});
    });

    it('drops the credential of a row the operator removed', () => {
        // Otherwise a key nobody can see or reach stays in the database forever.
        const split = splitRowSecrets(
            PROVIDERS,
            rows({ [ROW_ID_KEY]: 'kept', name: 'claude' }),
            { 'providers/kept/apiKey': 'enc(keep)', 'providers/gone/apiKey': 'enc(orphan)' },
            encrypt,
        );

        expect(split.secrets).toEqual({ 'providers/kept/apiKey': 'enc(keep)' });
    });

    it("leaves another field's secrets and the OAuth vault alone", () => {
        const split = splitRowSecrets(
            PROVIDERS,
            rows({ [ROW_ID_KEY]: 'r1', name: 'a' }),
            { apiKey: 'enc(field)', 'oauth.tokens': 'enc(vault)' },
            encrypt,
        );

        expect(split.secrets).toEqual({ apiKey: 'enc(field)', 'oauth.tokens': 'enc(vault)' });
    });

    it('drops a row the operator added and left blank', () => {
        const split = splitRowSecrets(PROVIDERS, rows({ name: '  ' }, { name: 'real' }), {}, encrypt);

        expect(storedRows(split.value).map(row => row.name)).toEqual(['real']);
    });

    it('keeps a row that holds nothing but a credential', () => {
        // Blank cells and a typed key is a row in the middle of being filled in, not an empty one.
        const split = splitRowSecrets(PROVIDERS, rows({ apiKey: 'sk-only' }), {}, encrypt);

        expect(storedRows(split.value)).toHaveLength(1);
        expect(Object.values(split.secrets)).toEqual(['enc(sk-only)']);
    });

    it('answers empty rather than throwing for something unreadable', () => {
        expect(splitRowSecrets(PROVIDERS, 'not json', {}, encrypt).value).toBe('[]');
        expect(splitRowSecrets(PROVIDERS, undefined, {}, encrypt).value).toBe('[]');
    });
});

describe('which fields need any of this', () => {
    it('is only a list with a secret column', () => {
        expect(holdsRowSecrets(PROVIDERS)).toBe(true);
        expect(holdsRowSecrets(FEEDS)).toBe(false);
        expect(holdsRowSecrets(API_KEY)).toBe(false);
    });

    it('leaves a list with nothing to encrypt exactly as it was', () => {
        // Every list that already exists — a station's feeds, a voice map — has no credential in it,
        // so none of this touches them and none of their rows gains an id it has no use for.
        const feeds = rows({ url: 'https://example.com/feed.xml' });
        const effective = formAsItWillBe([FEEDS], { feeds }, {}, { feeds });

        expect(effective.feeds).toBe(feeds);
        expect(String(effective.feeds)).not.toContain(ROW_ID_KEY);
    });
});

describe('reporting what is configured', () => {
    it('names each cell and never its value', () => {
        const configured = configuredCells({ 'providers/r1/apiKey': 'enc(x)', apiKey: 'enc(y)' });

        expect(configured).toEqual({ 'providers/r1/apiKey': true });
        expect(JSON.stringify(configured)).not.toContain('enc(');
    });
});

describe('the form as a schema should judge it', () => {
    const stored = { providers: rows({ [ROW_ID_KEY]: 'r1', name: 'claude' }), other: 'x' };
    const secrets = { 'providers/r1/apiKey': 'sk-stored', apiKey: 'field-secret' };
    const fields = [PROVIDERS, API_KEY, { key: 'other', label: 'Other', type: 'string' } as ConfigField];

    it('puts a stored credential back into the row it belongs to', () => {
        // Which is the whole point: a refinement asking "does this row have a key" has to see one
        // for a row the operator did not retype, or every save after the first is refused.
        const effective = formAsItWillBe(fields, stored, secrets);

        expect(JSON.parse(String(effective.providers))).toEqual([{ [ROW_ID_KEY]: 'r1', name: 'claude', apiKey: 'sk-stored' }]);
    });

    it('puts a secret FIELD under its own key and a cell nowhere near the top level', () => {
        const effective = formAsItWillBe(fields, stored, secrets);

        expect(effective.apiKey).toBe('field-secret');
        expect(effective['providers/r1/apiKey']).toBeUndefined();
    });

    it('overlays a submitted row and keeps the credential it did not resend', () => {
        const effective = formAsItWillBe(fields, stored, secrets, { providers: rows({ [ROW_ID_KEY]: 'r1', name: 'renamed' }) });

        expect(JSON.parse(String(effective.providers))).toEqual([{ [ROW_ID_KEY]: 'r1', name: 'renamed', apiKey: 'sk-stored' }]);
    });

    it('takes a typed credential over the stored one', () => {
        const effective = formAsItWillBe(fields, stored, secrets, { providers: rows({ [ROW_ID_KEY]: 'r1', name: 'claude', apiKey: 'sk-new' }) });

        expect(JSON.parse(String(effective.providers))[0].apiKey).toBe('sk-new');
    });

    it('shows a cleared credential as gone, so a refinement refuses the save', () => {
        const effective = formAsItWillBe(fields, stored, secrets, { providers: rows({ [ROW_ID_KEY]: 'r1', name: 'claude', apiKey: null }) });

        expect(JSON.parse(String(effective.providers))[0].apiKey).toBeUndefined();
    });

    it('gives a brand new row only what was typed into it', () => {
        // It has no id, so nothing can be stored against it. A required credential on a new row is
        // therefore refused while the same column on an existing row passes untouched.
        const effective = formAsItWillBe(fields, stored, secrets, { providers: rows({ name: 'fresh' }) });

        expect(JSON.parse(String(effective.providers))).toEqual([{ name: 'fresh' }]);
    });

    it('leaves a field the submission did not mention as it is stored', () => {
        const effective = formAsItWillBe(fields, stored, secrets, { other: 'changed' });

        expect(effective.other).toBe('changed');
        expect(JSON.parse(String(effective.providers))[0].apiKey).toBe('sk-stored');
    });

    it('clears a secret field the submission blanked', () => {
        expect(formAsItWillBe(fields, stored, secrets, { apiKey: null }).apiKey).toBeUndefined();
    });
});
