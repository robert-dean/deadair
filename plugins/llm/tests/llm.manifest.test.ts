// The settings form as the console will draw it, which is where a provider setting is either usable
// or a dead end. Both claims here were bugs first: a required address the native arms ignore, and a
// missing credential that would otherwise be discovered by a break failing to be written.

import { describe, expect, it } from 'vitest';

import { configSchema, llmManifest, PROVIDER_KINDS } from '../src/llm.manifest.js';

const field = (key: string) => llmManifest.configFields.find(entry => entry.key === key);

describe('the settings form', () => {
    it('marks nothing required, because what is needed depends on the provider', () => {
        // The console refuses to submit a form with an unanswered required field, so a required
        // server URL would stop an operator choosing Anthropic or Gemini from saving at all — on a
        // field those arms ignore. The schema below asks for it on the one arm that needs it.
        expect(llmManifest.configFields.filter(entry => entry.required === true)).toEqual([]);
    });

    it('offers every provider the plugin can actually build', () => {
        expect(field('providerKind')?.options?.map(option => option.value)).toEqual(Object.keys(PROVIDER_KINDS));
    });

    it('declares the native providers hosts, and reads the compatible one out of the setting', () => {
        // An operator picks a supplier for the native arms rather than an address, so those two are
        // named outright; the compatible arm's address is the operator's, so there is nothing to
        // write down and an unset one contributes no entry at all.
        expect(llmManifest.permissions.network).toEqual([{ fromConfig: 'baseUrl' }, 'api.anthropic.com', 'generativelanguage.googleapis.com']);
    });
});

describe('what a save is refused for', () => {
    it('takes an install configured before the provider setting existed', () => {
        // No `providerKind` at all is the ordinary state of every station that had this plugin
        // before there was anything to choose, and it means the compatible arm.
        expect(configSchema.safeParse({ baseUrl: 'http://localhost:11434/v1', model: 'gpt-oss:20b' }).success).toBe(true);
    });

    it('asks for an address on the arm that is nothing without one', () => {
        const parsed = configSchema.safeParse({ providerKind: 'openai-compat' });

        expect(parsed.success).toBe(false);
        expect(parsed.success === false && parsed.error.issues[0]?.path).toEqual(['baseUrl']);
    });

    it.each(['anthropic', 'google'])('asks %s for the key it cannot work without', kind => {
        const parsed = configSchema.safeParse({ providerKind: kind });

        expect(parsed.success).toBe(false);
        expect(parsed.success === false && parsed.error.issues[0]?.path).toEqual(['apiKey']);
    });

    it('does not ask a native provider for an address it would ignore', () => {
        expect(configSchema.safeParse({ providerKind: 'google', apiKey: 'goog-test' }).success).toBe(true);
    });
});
