import { describe, expect, it } from 'vitest';

import { parseVoiceMap, voiceMapOf } from '../src/kokoro.voices.js';

describe('parseVoiceMap', () => {
    it('reads one mapping per line', () => {
        expect(parseVoiceMap('host = af_heart\nnewsreader = am_michael')).toEqual({
            ok: true,
            voices: { host: 'af_heart', newsreader: 'am_michael' },
        });
    });

    it('reads comma-separated entries, which is what fits the single-line form field', () => {
        expect(parseVoiceMap('host = af_heart, newsreader = am_michael')).toEqual({
            ok: true,
            voices: { host: 'af_heart', newsreader: 'am_michael' },
        });
    });

    it('tolerates the spacing and the separator a person actually types', () => {
        expect(parseVoiceMap('host:af_heart\n   newsreader   =   am_michael   ')).toEqual({
            ok: true,
            voices: { host: 'af_heart', newsreader: 'am_michael' },
        });
    });

    it('ignores blank lines and comments', () => {
        expect(parseVoiceMap('\n# the one that says the station name\nhost = af_heart\n\n')).toEqual({
            ok: true,
            voices: { host: 'af_heart' },
        });
    });

    it('says which line is wrong, while the operator is still looking at the form', () => {
        // Refused rather than skipped: a typo that silently maps nothing shows up
        // much later as a voice that is somehow always the default.
        expect(parseVoiceMap('host = af_heart\njust-a-name')).toMatchObject({ ok: false, line: 2 });
        expect(parseVoiceMap('host =')).toMatchObject({ ok: false, line: 1 });
        expect(parseVoiceMap('= af_heart')).toMatchObject({ ok: false, line: 1 });
    });

    it('reads nothing at all as no mappings rather than an error', () => {
        expect(parseVoiceMap(undefined)).toEqual({ ok: true, voices: {} });
        expect(parseVoiceMap('')).toEqual({ ok: true, voices: {} });
    });
});

describe('voiceMapOf', () => {
    it('reads a malformed value as empty, because init must not be what refuses it', () => {
        // `configSchema` already rejected anything malformed at save time. A
        // station with no mappings falls back to the default voice, which is an
        // ordinary state and not a reason to fail to load.
        expect(voiceMapOf('nonsense')).toEqual({});
        expect(voiceMapOf(undefined)).toEqual({});
        expect(voiceMapOf(42)).toEqual({});
    });
});
