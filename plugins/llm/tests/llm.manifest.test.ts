// The settings form as the console will draw it, which is where a provider setting is either usable
// or a dead end. Both claims here were bugs first: a required address the native arms ignore, and a
// missing credential that would otherwise be discovered by a break failing to be written.

import { describe, expect, it } from 'vitest';

import { configSchema, llmManifest, PROVIDER_KINDS } from '../src/llm.manifest.js';

describe('the settings form', () => {
    it('marks nothing required, because what a provider needs depends on its kind', () => {
        // The console enforces a required field before it will submit the form at all, so a required
        // providers table is a table an operator cannot fix once it is wrong. The schema's own
        // refinements say the same things where they can be read: on the field, in a sentence.
        expect(llmManifest.configFields.filter(entry => entry.required === true)).toEqual([]);
    });

    it('offers no provider choice, because a provider is a row the operator adds', () => {
        expect(llmManifest.configFields.map(field => field.key)).not.toContain('providerKind');
        expect(llmManifest.configFields.find(field => field.key === 'providers')?.type).toBe('list');
    });

    it('holds the credential in the row rather than beside the table', () => {
        // Which is the whole reason a `secret` column had to exist: a station can have two providers
        // of the same kind, so one key per protocol was never going to be enough.
        const columns = llmManifest.configFields.find(field => field.key === 'providers')?.columns ?? [];

        expect(columns.map(column => column.key)).toEqual(['name', 'kind', 'baseUrl', 'apiKey']);
        expect(columns.find(column => column.key === 'apiKey')?.type).toBe('secret');
        expect(llmManifest.configFields.filter(field => field.type === 'secret')).toEqual([]);
    });

    it('offers every kind the plugin can actually speak', () => {
        const kinds = llmManifest.configFields.find(field => field.key === 'providers')?.columns?.find(column => column.key === 'kind');

        expect(kinds?.options?.map(option => option.value)).toEqual(Object.keys(PROVIDER_KINDS));
    });

    it("declares the native hosts, and reads an operator's own addresses out of the table", () => {
        // One entry per row, taken from the `url` COLUMN — `addressCells`, host-side. A native
        // provider's address is not an operator's business, so those two are named outright.
        expect(llmManifest.permissions.network).toEqual([{ fromConfig: 'providers' }, 'api.anthropic.com', 'generativelanguage.googleapis.com']);
    });
});

describe('what a save is refused for', () => {
    /** The form as the host validates it: the credential merged back into its row. */
    const providers = (...rows: Record<string, unknown>[]) => JSON.stringify(rows);

    const refusal = (config: Record<string, unknown>) => {
        const parsed = configSchema.safeParse(config);
        return parsed.success ? undefined : parsed.error.issues[0]?.path;
    };

    it('asks for at least one provider', () => {
        expect(refusal({})).toEqual(['providers']);
        expect(refusal({ providers: '[]' })).toEqual(['providers']);
    });

    it('asks every provider for a name, since the name is the address', () => {
        expect(refusal({ providers: providers({ baseUrl: 'http://x/v1' }) })).toEqual(['providers']);
    });

    it('refuses a name that cannot be used as a qualifier', () => {
        // A colon is what a model name is split on, and a space reads as two words in a setting
        // that holds one token.
        expect(refusal({ providers: providers({ name: 'my:server', baseUrl: 'http://x/v1' }) })).toEqual(['providers']);
        expect(refusal({ providers: providers({ name: 'my server', baseUrl: 'http://x/v1' }) })).toEqual(['providers']);
    });

    it('refuses two providers sharing a name', () => {
        const rows = providers({ name: 'a', baseUrl: 'http://one/v1' }, { name: 'a', baseUrl: 'http://two/v1' });

        expect(refusal({ providers: rows })).toEqual(['providers']);
    });

    it('asks each kind for the one thing it cannot work without', () => {
        expect(refusal({ providers: providers({ name: 'ollama', kind: 'openai-compat' }) })).toEqual(['providers']);
        expect(refusal({ providers: providers({ name: 'claude', kind: 'anthropic' }) })).toEqual(['providers']);
        expect(refusal({ providers: providers({ name: 'gem', kind: 'google' }) })).toEqual(['providers']);
    });

    it('takes a row that has what its kind needs', () => {
        expect(refusal({ providers: providers({ name: 'ollama', kind: 'openai-compat', baseUrl: 'http://x/v1' }) })).toBeUndefined();
        // The key is in the row here because that is the form as the HOST validates it: the stored
        // credential is merged back in before the schema ever sees it.
        expect(refusal({ providers: providers({ name: 'claude', kind: 'anthropic', apiKey: 'sk-x' }) })).toBeUndefined();
    });

    it('takes two providers of the same kind, which is the point of a table', () => {
        const rows = providers(
            { name: 'ollama', kind: 'openai-compat', baseUrl: 'http://local/v1' },
            { name: 'groq', kind: 'openai-compat', baseUrl: 'https://api.groq.com/openai/v1' },
        );

        expect(refusal({ providers: rows })).toBeUndefined();
    });

    it('refuses a default model that names no provider at all', () => {
        // Unqualified is refused rather than guessed at: "the first row" would change meaning the
        // moment somebody reorders the table.
        const rows = providers({ name: 'ollama', baseUrl: 'http://x/v1' });

        expect(refusal({ providers: rows, model: 'gpt-oss' })).toEqual(['model']);
    });

    it('refuses a default model naming a provider that is not in the table', () => {
        const rows = providers({ name: 'ollama', baseUrl: 'http://x/v1' });

        expect(refusal({ providers: rows, model: 'claude:sonnet' })).toEqual(['model']);
    });

    it('takes a default model on a provider that IS in the table, colons and all', () => {
        const rows = providers({ name: 'ollama', baseUrl: 'http://x/v1' });

        expect(refusal({ providers: rows, model: 'ollama:gpt-oss-radio:latest' })).toBeUndefined();
    });

    it('refuses a ticked tool-capable model on a provider that is not there', () => {
        const rows = providers({ name: 'ollama', baseUrl: 'http://x/v1' });

        expect(refusal({ providers: rows, models: JSON.stringify(['gone:gpt-oss']) })).toEqual(['models']);
    });
});
