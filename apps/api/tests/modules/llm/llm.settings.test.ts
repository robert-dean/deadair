// The station thinks with exactly one plugin, the way it speaks with exactly one. Enrichment fans
// out because two sources knowing different facts is more knowledge; two models writing the same
// line is one line and a wasted generation. So this is a choice rather than an ordering, and what
// it does when it cannot make one is the whole of the file.

import { describe, expect, it } from 'vitest';

import { explainDefaultGenerator, explainNoGenerator, LLM_PLUGIN_KEY, selectLlmPlugin } from '../../../src/modules/llm/llm.settings.js';
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

    it('takes the first when nobody has chosen between several', () => {
        // The same rule speech takes, and it is the same rule on purpose: a capability that answers
        // differently depending on which subsystem is asking is what `plugin.selection.ts` exists to
        // prevent. Less is at stake here than for speech — nothing is billed on a self-hosted model
        // and a station with none writes deterministically — but the pick is still reported.
        // Candidates arrive in `byPluginId` order, so "first" is the same answer twice.
        expect(selectLlmPlugin([other, local], undefined)).toBe(other);
        expect(selectLlmPlugin([other, local], '')).toBe(other);
        expect(selectLlmPlugin([other, local], '   ')).toBe(other);
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

    it('tells the two cases apart, which is the reason it exists', () => {
        // Two rather than three: "several and none chosen" is no longer a refusal, so it is no
        // longer something to go and fix. It moved to `explainDefaultGenerator`.
        const named = explainNoGenerator([local], 'acme.bigmodel');
        const none = explainNoGenerator([], undefined);

        expect(new Set([named, none]).size).toBe(2);
    });
});

describe('explainDefaultGenerator', () => {
    it('names what was picked and what it was picked over', () => {
        const said = explainDefaultGenerator(other, [other, local]);

        expect(said).toContain('acme.bigmodel');
        expect(said).toContain('deadair.llm');
        expect(said).toContain(LLM_PLUGIN_KEY);
    });
});
