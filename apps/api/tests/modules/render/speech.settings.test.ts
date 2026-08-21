// Speech has exactly one speaker, unlike enrichment, which fans out to everything that answers.
// Two voices rendering the same break is not a merge, it is two breaks. So this is a choice rather
// than an ordering, and what it does when it cannot make one is the whole of the file.

import { describe, expect, it } from 'vitest';

import { explainDefaultSpeaker, explainNoSpeaker, selectSpeechPlugin, SPEECH_PLUGIN_KEY } from '../../../src/modules/render/speech.settings.js';
import type { SpeechPlugin } from '../../../src/modules/plugins/plugin.capabilities.js';

const plugin = (id: string): SpeechPlugin => ({ record: { id } }) as unknown as SpeechPlugin;

const kokoro = plugin('deadair.kokoro');
const chatterbox = plugin('deadair.chatterbox');

describe('selectSpeechPlugin', () => {
    it('picks the only candidate when nobody has chosen', () => {
        // Which is what every station with one TTS plugin installed looks like, and means nobody
        // has to choose before the station will talk.
        expect(selectSpeechPlugin([kokoro], undefined)).toBe(kokoro);
        expect(selectSpeechPlugin([kokoro], '')).toBe(kokoro);
        expect(selectSpeechPlugin([kokoro], '   ')).toBe(kokoro);
    });

    it('picks the one that was named', () => {
        expect(selectSpeechPlugin([kokoro, chatterbox], 'deadair.chatterbox')).toBe(chatterbox);
    });

    it('takes the first when nobody has chosen between several', () => {
        // It used to answer nothing here, on the grounds that a pick the operator did not make
        // looks deliberate. For speech the cost of that is SILENCE — installing a second TTS
        // plugin took the station off the air until somebody visited a settings page — and the
        // objection is answered by saying which one was picked rather than by refusing.
        // Candidates arrive in `byPluginId` order, so "first" is the same answer twice.
        expect(selectSpeechPlugin([chatterbox, kokoro], undefined)).toBe(chatterbox);
        expect(selectSpeechPlugin([chatterbox, kokoro], '')).toBe(chatterbox);
        expect(selectSpeechPlugin([chatterbox, kokoro], '   ')).toBe(chatterbox);
    });

    it('does not fall back when the named plugin is not running', () => {
        // The setting names the voice the station is supposed to have. Quietly using a different
        // one because that one is disabled is how a station ends up sounding wrong with nothing in
        // the log to explain it.
        expect(selectSpeechPlugin([kokoro], 'deadair.chatterbox')).toBeUndefined();
    });

    it('answers nothing when nothing can speak', () => {
        expect(selectSpeechPlugin([], undefined)).toBeUndefined();
        expect(selectSpeechPlugin([], 'deadair.kokoro')).toBeUndefined();
    });
});

describe('explainNoSpeaker', () => {
    it('tells the two failures apart, because the operator does something different about each', () => {
        // Two rather than three now. "Several and none chosen" is no longer a refusal, so it is no
        // longer a sentence about something to go and fix — see `explainDefaultSpeaker`.
        expect(explainNoSpeaker([], undefined)).toMatch(/install and enable/);
        expect(explainNoSpeaker([kokoro], 'deadair.chatterbox')).toMatch(/names "deadair\.chatterbox"/);
    });
});

describe('explainDefaultSpeaker', () => {
    it('names what was picked and what it was picked over', () => {
        // The other half of the bargain: taking the first candidate is only better than refusing if
        // the choice is visible, and the operator's next move is to set the key, so they need to
        // know what to set it to.
        const said = explainDefaultSpeaker(chatterbox, [chatterbox, kokoro]);

        expect(said).toContain('"deadair.chatterbox"');
        expect(said).toContain('deadair.kokoro');
        expect(said).toMatch(new RegExp(`${SPEECH_PLUGIN_KEY} is unset`));
    });
});
