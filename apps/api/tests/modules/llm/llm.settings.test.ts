// The station thinks with exactly one plugin, the way it speaks with exactly one. Enrichment fans
// out because two sources knowing different facts is more knowledge; two models writing the same
// line is one line and a wasted generation. So this is a choice rather than an ordering, and what
// it does when it cannot make one is the whole of the file.

import { describe, expect, it } from 'vitest';

import { explainNoGenerator, LLM_PLUGIN_KEY, selectLlmPlugin } from '../../../src/modules/llm/llm.settings.js';
import type { LlmPlugin } from '../../../src/modules/plugins/plugin.capabilities.js';

const plugin = (id: string): LlmPlugin => ({ record: { id } }) as unknown as LlmPlugin;

const local = plugin('deadair.llm');
const other = plugin('acme.bigmodel');

describe('selectLlmPlugin', () => {
    it('picks the only candidate when nobody has chosen', () => {
        expect(selectLlmPlugin([local], undefined)).toBe(local);
        expect(selectLlmPlugin([local], '')).toBe(local);
        expect(selectLlmPlugin([local], '   ')).toBe(local);
    });

    it('picks the one that was named', () => {
        expect(selectLlmPlugin([local, other], 'acme.bigmodel')).toBe(other);
    });

    it('refuses to guess between several when nobody has chosen', () => {
        // A station quietly writing its breaks on a model the operator did not pick is a bill as
        // well as a voice.
        expect(selectLlmPlugin([local, other], undefined)).toBeUndefined();
    });

    it('does not fall back when the named plugin is not running', () => {
        expect(selectLlmPlugin([local], 'acme.bigmodel')).toBeUndefined();
    });

    it('answers nothing when nothing can produce words', () => {
        // Which is every fresh install, and not a fault: the station writes its own breaks.
        expect(selectLlmPlugin([], undefined)).toBeUndefined();
        expect(selectLlmPlugin([], 'deadair.llm')).toBeUndefined();
    });
});

describe('explainNoGenerator', () => {
    it('names the setting and the missing plugin when one was chosen', () => {
        const explained = explainNoGenerator([local], 'acme.bigmodel');

        expect(explained).toContain(LLM_PLUGIN_KEY);
        expect(explained).toContain('acme.bigmodel');
    });

    it('says what to do when nothing is installed', () => {
        expect(explainNoGenerator([], undefined)).toContain('install');
    });

    it('lists the candidates when there are several and none was chosen', () => {
        const explained = explainNoGenerator([local, other], undefined);

        expect(explained).toContain('deadair.llm');
        expect(explained).toContain('acme.bigmodel');
        expect(explained).toContain(LLM_PLUGIN_KEY);
    });

    it('tells the three cases apart, which is the reason it exists', () => {
        const named = explainNoGenerator([local], 'acme.bigmodel');
        const none = explainNoGenerator([], undefined);
        const several = explainNoGenerator([local, other], undefined);

        expect(new Set([named, none, several]).size).toBe(3);
    });
});
