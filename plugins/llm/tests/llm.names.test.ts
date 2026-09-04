// A model name is the one place a station can say WHICH provider it wants, because the model is a
// per-call parameter and the plugin is a per-station setting. What is tested here is mostly the
// things that must NOT be read as a qualifier: this station's own Ollama ids are `name:tag` and
// OpenRouter's are `vendor/model`, so a general "split on the separator" rule would have quietly
// routed half an existing install's models to a provider it has never heard of.

import { describe, expect, it } from 'vitest';

import { qualify, readModelName } from '../src/llm.names.js';
import { describeNativeModels } from '../src/llm.models.js';

describe('reading a model name', () => {
    it('reads a bare name as the OpenAI-compatible server', () => {
        expect(readModelName('gpt-oss-radio')).toEqual({ kind: 'openai-compat', id: 'gpt-oss-radio' });
    });

    it('leaves an Ollama tag alone, colon and all', () => {
        // The reason the prefixes are a closed set rather than "whatever is before the colon". This
        // is the live station's own default model.
        expect(readModelName('gpt-oss-radio:latest')).toEqual({ kind: 'openai-compat', id: 'gpt-oss-radio:latest' });
    });

    it('leaves an OpenRouter name alone, slash and all', () => {
        expect(readModelName('anthropic/claude-sonnet-4.5')).toEqual({ kind: 'openai-compat', id: 'anthropic/claude-sonnet-4.5' });
    });

    it.each([
        ['anthropic:claude-sonnet-5', 'anthropic', 'claude-sonnet-5'],
        ['google:gemini-2.5-flash', 'google', 'gemini-2.5-flash'],
    ])('reads %s as that provider', (name, kind, id) => {
        expect(readModelName(name)).toEqual({ kind, id });
    });

    it('keeps a colon that belongs to the model rather than to the prefix', () => {
        expect(readModelName('anthropic:claude:weird')).toEqual({ kind: 'anthropic', id: 'claude:weird' });
    });

    it('reads a prefix with nothing after it as that provider and no model', () => {
        // Which `generate` refuses as a configuration fault rather than sending an empty model name.
        expect(readModelName('anthropic:')).toEqual({ kind: 'anthropic', id: '' });
    });

    it('reads nothing at all as bare and empty', () => {
        expect(readModelName(undefined)).toEqual({ kind: 'openai-compat', id: '' });
        expect(readModelName('   ')).toEqual({ kind: 'openai-compat', id: '' });
    });
});

describe('naming a model', () => {
    it('leaves the OpenAI-compatible arm unprefixed', () => {
        expect(qualify('openai-compat', 'gpt-oss-radio:latest')).toBe('gpt-oss-radio:latest');
    });

    it('prefixes a native arm', () => {
        expect(qualify('anthropic', 'claude-sonnet-5')).toBe('anthropic:claude-sonnet-5');
    });

    it('does not prefix twice', () => {
        // The ids this produces come back as `LlmRequest.model`, so a round trip through a settings
        // form is the ordinary path rather than an edge case.
        expect(qualify('anthropic', 'anthropic:claude-sonnet-5')).toBe('anthropic:claude-sonnet-5');
    });

    it('answers nothing for nothing', () => {
        expect(qualify('google', '  ')).toBe('');
    });

    it('round-trips whatever it produced', () => {
        expect(readModelName(qualify('google', 'gemini-2.5-flash'))).toEqual({ kind: 'google', id: 'gemini-2.5-flash' });
    });
});

describe('describing a native arm', () => {
    it('qualifies the ids and says every model takes tools', () => {
        expect(describeNativeModels('anthropic', ['claude-x', 'claude-y'], '')).toEqual([
            { id: 'anthropic:claude-x', label: 'claude-x · Anthropic', tools: true },
            { id: 'anthropic:claude-y', label: 'claude-y · Anthropic', tools: true },
        ]);
    });

    it('marks the entry the plugin actually names as default', () => {
        const described = describeNativeModels('google', ['gemini-x', 'gemini-y'], 'google:gemini-y');

        expect(described.find(entry => entry.default === true)?.id).toBe('google:gemini-y');
    });

    it('marks nothing when the default lives on another arm', () => {
        // A bare default names the OpenAI-compatible server, so no native entry may claim it — two
        // entries marked default would leave the host picking whichever it saw first.
        expect(describeNativeModels('anthropic', ['claude-x'], 'gpt-oss-radio:latest').some(entry => entry.default === true)).toBe(false);
    });

    it('drops blanks and repeats', () => {
        expect(describeNativeModels('anthropic', ['claude-x', ' claude-x ', '  '], '').map(entry => entry.id)).toEqual(['anthropic:claude-x']);
    });
});
