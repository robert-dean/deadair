import { describe, expect, it } from 'vitest';

import { MODELS } from '../src/elevenlabs.models.js';
import { performed } from '../src/elevenlabs.tags.js';

const V4 = MODELS.eleven_v4.tags;
const V3 = MODELS.eleven_v3.tags;

describe('performed', () => {
    it("rewrites each claimed cue in the model's own spelling", () => {
        expect(performed('Oh [laugh] that one. [Clear throat] Anyway [sigh].', undefined, V4)).toBe(
            'Oh [laughs] that one. [clears throat] Anyway [sighs].',
        );
    });

    it('strips a cue the model has no tag for', () => {
        expect(performed('Excuse me [cough] where was I.', undefined, V4)).toBe('Excuse me where was I.');
    });

    it('leads with the delivery tag', () => {
        expect(performed('Stay close.', 'hushed', V4)).toBe('[hushed] Stay close.');
        expect(performed('Stay close.', 'hushed', V3)).toBe('[whispers] Stay close.');
        expect(performed('Run!', 'frantic', V4)).toBe('[rushed] Run!');
    });

    it('strips every cue and ignores the delivery for a model that performs no tags', () => {
        expect(performed('Oh [laugh] that one.', 'hushed', undefined)).toBe('Oh that one.');
    });

    it('leaves brackets that are not cues alone', () => {
        expect(performed('Track [Remastered] [laugh]', undefined, V4)).toBe('Track [Remastered] [laughs]');
    });
});
