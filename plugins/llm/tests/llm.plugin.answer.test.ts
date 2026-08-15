// Every case here is one live run apart, against gpt-oss on Ollama. The plugin had been handing
// back an empty string for any conversation in which the model used a tool -- which reads exactly
// like a model with nothing to say, and which nothing noticed for as long as the only caller
// passed `tools: false`.

import { describe, expect, it } from 'vitest';

import { spokenAnswer } from '../src/llm.plugin.js';

const turn = (overrides: Partial<Parameters<typeof spokenAnswer>[0]> = {}) =>
    spokenAnswer({ text: '', toolCalls: 0, finishReason: 'stop', ...overrides });

describe('spokenAnswer', () => {
    it('takes the text whenever there is any', () => {
        expect(turn({ text: 'Here are ten records.' })).toBe('Here are ten records.');
    });

    it('leaves a reasoning model that also answered completely alone', () => {
        // The reasoning is not the answer. A provider that reports both must not have its
        // working-out preferred over what it actually said.
        expect(turn({ text: 'Here are ten records.', reasoningText: 'Let me think about the flow.' })).toBe('Here are ten records.');
    });

    it('recovers an answer that arrived as reasoning', () => {
        // The defect itself: after a tool round gpt-oss puts the answer in the reasoning channel
        // and leaves the text empty.
        expect(turn({ reasoningText: '[{"title": "A", "artist": "One"}]' })).toBe('[{"title": "A", "artist": "One"}]');
    });

    it('never recovers from a turn that asked for a tool', () => {
        // That turn's reasoning is working-out, not a reply. Promoting it would feed the model its
        // own thoughts back as the assistant's words on the next step.
        expect(turn({ reasoningText: 'I should search for Metallica next.', toolCalls: 1, finishReason: 'tool-calls' })).toBe('');
    });

    it('never recovers from a tool-calls finish even with no calls attached', () => {
        // Asked for a final answer with no tools offered, gpt-oss still finishes this way when
        // what it wanted was another search. Handing that back is worse than an empty string,
        // because it looks like an answer.
        expect(turn({ reasoningText: 'Need more variety. Search for rock.', toolCalls: 0, finishReason: 'tool-calls' })).toBe('');
    });

    it('answers empty when there is nothing anywhere', () => {
        expect(turn({})).toBe('');
        expect(turn({ reasoningText: '' })).toBe('');
        expect(turn({ reasoningText: '   ' })).toBe('');
    });

    it('does not treat whitespace text as an answer worth keeping over real reasoning', () => {
        expect(turn({ text: '   \n ', reasoningText: 'the actual answer' })).toBe('the actual answer');
    });

    it('reads an empty array as nothing said, because that is the same failure with a bracket pair', () => {
        // The live one: asked for two dozen records after three searches that returned thirty-six,
        // gpt-oss answered `[]` and put its picks in the reasoning channel. Read as an answer, that
        // cost a briefed hour — the floor filled it, and the floor cannot act on a brief.
        expect(turn({ text: '[]', reasoningText: '[{"title": "A", "artist": "One"}]' })).toBe('[{"title": "A", "artist": "One"}]');
    });

    it('reads an empty container inside a code fence the same way', () => {
        expect(turn({ text: '```json\n[]\n```', reasoningText: '[{"title": "A", "artist": "One"}]' })).toBe('[{"title": "A", "artist": "One"}]');
    });

    it('keeps a refusal in prose, because a model that wrote a sentence said something', () => {
        // The line this draws. Overruling an answer is not the same as finding one, and a model
        // that declined in words has been understood rather than lost.
        expect(turn({ text: 'I could not find anything that fits.', reasoningText: '[{"title": "A", "artist": "One"}]' })).toBe(
            'I could not find anything that fits.',
        );
    });

    it('keeps an empty array when there is no reasoning to prefer over it', () => {
        expect(turn({ text: '[]' })).toBe('[]');
    });

    it('is unaffected by a length finish, which is a real answer that got cut off', () => {
        // A truncated answer is still the answer, and the caller's own guard decides whether it is
        // usable. Only `tool-calls` means "this was not a reply".
        expect(turn({ reasoningText: 'a truncated answer', finishReason: 'length' })).toBe('a truncated answer');
    });
});
