// The settings form as the console will draw it, which is where a provider setting is either usable
// or a dead end. Both claims here were bugs first: a required address the native arms ignore, and a
// missing credential that would otherwise be discovered by a break failing to be written.

import { describe, expect, it } from 'vitest';

import { configSchema, llmManifest, PROVIDER_KINDS } from '../src/llm.manifest.js';

describe('the settings form', () => {
    it('marks nothing required, because what is needed depends on which providers you have', () => {
        // The console refuses to submit a form with an unanswered required field, so a required
        // server URL would stop an operator who only has an Anthropic key from saving at all. The
        // schema below asks for at least one credential instead, which is the honest requirement.
        expect(llmManifest.configFields.filter(entry => entry.required === true)).toEqual([]);
    });

    it('offers no provider choice, because every configured one is reachable at once', () => {
        // Which provider a request reaches is read off the model name, so a select naming one would
        // be a second answer to a question already answered, and the two would drift.
        expect(llmManifest.configFields.map(field => field.key)).not.toContain('providerKind');
    });

    it('takes a credential for each provider it can speak to', () => {
        const secrets = llmManifest.configFields.filter(field => field.type === 'secret').map(field => field.key);

        expect(secrets).toEqual(['apiKey', 'anthropicApiKey', 'googleApiKey']);
        expect(Object.keys(PROVIDER_KINDS)).toHaveLength(secrets.length);
    });

    it('declares the native providers hosts, and reads the compatible one out of the setting', () => {
        // An operator picks a supplier for the native arms rather than an address, so those two are
        // named outright; the compatible arm's address is the operator's, so there is nothing to
        // write down and an unset one contributes no entry at all.
        expect(llmManifest.permissions.network).toEqual([{ fromConfig: 'baseUrl' }, 'api.anthropic.com', 'generativelanguage.googleapis.com']);
    });
});

describe('what a save is refused for', () => {
    it('takes an install configured before any of this, stale provider key and all', () => {
        // The live station's own row. `providerKind` is no longer declared, so zod strips it rather
        // than refusing it, and every other value goes on meaning exactly what it meant.
        const parsed = configSchema.safeParse({
            providerKind: 'openai-compat',
            baseUrl: 'http://pop-os.local:11434/v1',
            model: 'gpt-oss-radio:latest',
            models: '["gpt-oss-radio:latest"]',
        });

        expect(parsed.success).toBe(true);
        expect(parsed.success === true && 'providerKind' in parsed.data).toBe(false);
    });

    it('asks for at least one credential, naming no field because any of three would do', () => {
        const parsed = configSchema.safeParse({});

        expect(parsed.success).toBe(false);
        expect(parsed.success === false && parsed.error.issues[0]?.path).toEqual([]);
    });

    it.each([
        ['a server URL', { baseUrl: 'http://localhost:11434/v1' }],
        ['an Anthropic key', { anthropicApiKey: 'sk-test' }],
        ['a Gemini key', { googleApiKey: 'goog-test' }],
        ['all three at once', { baseUrl: 'http://localhost:11434/v1', anthropicApiKey: 'sk-test', googleApiKey: 'goog-test' }],
    ])('is satisfied by %s', (_name, config) => {
        expect(configSchema.safeParse(config).success).toBe(true);
    });

    it('refuses a default model naming a provider nothing is configured for', () => {
        // Otherwise the station refuses every generation it does not name a model for, which
        // presents as a DJ that stopped talking rather than as a setting that is wrong.
        const parsed = configSchema.safeParse({ baseUrl: 'http://localhost:11434/v1', model: 'anthropic:claude-x' });

        expect(parsed.success).toBe(false);
        expect(parsed.success === false && parsed.error.issues[0]?.path).toEqual(['model']);
    });

    it('takes a default model on a provider that IS configured', () => {
        expect(configSchema.safeParse({ anthropicApiKey: 'sk-test', model: 'anthropic:claude-x' }).success).toBe(true);
    });

    it('reads a bare default model as the server URL, colons and all', () => {
        expect(configSchema.safeParse({ baseUrl: 'http://localhost:11434/v1', model: 'gpt-oss-radio:latest' }).success).toBe(true);
    });
});
