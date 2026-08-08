// Speech has exactly one speaker, unlike enrichment, which fans out to everything that answers.
// Two voices rendering the same break is not a merge, it is two breaks. So this is a choice rather
// than an ordering, and what it does when it cannot make one is the whole of the file.

import { describe, expect, it } from 'vitest';

import { explainNoSpeaker, selectSpeechPlugin, SPEECH_PLUGIN_KEY } from '../../../src/modules/render/speech.settings.js';
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

    it('refuses to guess between several when nobody has chosen', () => {
        // Worse than saying nothing: the wrong voice airs, and it sounds deliberate.
        expect(selectSpeechPlugin([kokoro, chatterbox], undefined)).toBeUndefined();
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
    it('tells the three failures apart, because the operator does something different about each', () => {
        expect(explainNoSpeaker([], undefined)).toMatch(/install and enable/);
        expect(explainNoSpeaker([kokoro, chatterbox], undefined)).toMatch(new RegExp(`set ${SPEECH_PLUGIN_KEY}`));
        expect(explainNoSpeaker([kokoro], 'deadair.chatterbox')).toMatch(/names "deadair\.chatterbox"/);
    });

    it('names the candidates when the operator has to choose between them', () => {
        expect(explainNoSpeaker([kokoro, chatterbox], undefined)).toContain('deadair.kokoro, deadair.chatterbox');
    });
});
