// A model name is the one place a station can say WHICH provider it wants, because the model is a
// per-call parameter and the plugin is a per-station setting. The provider is a name the OPERATOR
// gave a row, not a vendor word, so a station can hold two OpenAI-compatible servers and tell them
// apart. What is tested most carefully is the split: this station's own Ollama ids are `name:tag`,
// so splitting anywhere but the FIRST colon would rename half an existing install's models.

import { describe, expect, it } from 'vitest';

import { isProviderName, qualify, readModelName } from '../src/llm.names.js';

describe('reading a model name', () => {
    it('splits at the first colon, so a model keeping its own tag survives', () => {
        expect(readModelName('ollama:gpt-oss-radio:latest')).toEqual({ provider: 'ollama', id: 'gpt-oss-radio:latest' });
    });

    it('reads an ordinary qualified name', () => {
        expect(readModelName('claude:claude-sonnet-5')).toEqual({ provider: 'claude', id: 'claude-sonnet-5' });
    });

    it('answers nothing for a name that qualifies nothing', () => {
        // Refused rather than guessed at. "The first row" would be a rule that changes meaning the
        // moment somebody reorders the table, and a model quietly reaching the wrong provider is
        // worse than a save that would not go through.
        expect(readModelName('gpt-oss-radio')).toBeUndefined();
        expect(readModelName(undefined)).toBeUndefined();
        expect(readModelName('   ')).toBeUndefined();
    });

    it('answers nothing for half a name', () => {
        expect(readModelName(':gpt-oss')).toBeUndefined();
        expect(readModelName('ollama:')).toBeUndefined();
        expect(readModelName('ollama:   ')).toBeUndefined();
    });

    it('keeps an OpenRouter name whole, because the slash is not the separator', () => {
        expect(readModelName('router:anthropic/claude-3.5-sonnet')).toEqual({ provider: 'router', id: 'anthropic/claude-3.5-sonnet' });
    });
});

describe('naming a model', () => {
    it('joins the provider and the model', () => {
        expect(qualify('ollama', 'gpt-oss-radio:latest')).toBe('ollama:gpt-oss-radio:latest');
    });

    it('does not prefix twice', () => {
        // The ids this produces come back as `LlmRequest.model`, so a round trip through a settings
        // form is the ordinary path rather than an edge case.
        expect(qualify('ollama', 'ollama:gpt-oss')).toBe('ollama:gpt-oss');
    });

    it('answers nothing when either half is missing', () => {
        expect(qualify('ollama', '  ')).toBe('');
        expect(qualify('  ', 'gpt-oss')).toBe('');
    });

    it('round-trips whatever it produced', () => {
        expect(readModelName(qualify('ollama', 'gpt-oss-radio:latest'))).toEqual({ provider: 'ollama', id: 'gpt-oss-radio:latest' });
    });
});

describe('what a provider may be called', () => {
    it('takes an ordinary name', () => {
        expect(isProviderName('ollama')).toBe(true);
        expect(isProviderName('my-local-box')).toBe(true);
    });

    it('refuses a name holding the separator, or a space', () => {
        // One would make the split ambiguous; the other reads as two words in a setting that holds
        // one token.
        expect(isProviderName('my:server')).toBe(false);
        expect(isProviderName('my server')).toBe(false);
        expect(isProviderName('')).toBe(false);
    });

    it('does not fold case, because two rows named differently are two providers', () => {
        expect(isProviderName('Ollama')).toBe(true);
    });
});
