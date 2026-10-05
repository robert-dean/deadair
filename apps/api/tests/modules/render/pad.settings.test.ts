// Every layer of `AppConfig` holds TEXT, so each case here hands the resolver the string a stored row
// arrives as. A test that handed over a real number would pass whether or not the parse was there.

import { describe, expect, it } from 'vitest';

import { PAD_LEVEL_BOUNDS, PAD_LEVEL_KEY, padLevelDb } from '../../../src/modules/render/pad.settings.js';
import { settingsConfig } from '../../utils/settings.config.js';

const level = (value?: string) => padLevelDb(settingsConfig(value === undefined ? {} : { [PAD_LEVEL_KEY]: value }).config);

describe('padLevelDb', () => {
    it('sits a pad six under the words when nobody set it', () => {
        expect(level()).toBe(-6);
        expect(PAD_LEVEL_BOUNDS.default).toBe(-6);
    });

    it('reads a stored figure as the string it arrives as', () => {
        expect(level('-9')).toBe(-9);
        expect(level(' -1.5 ')).toBe(-1.5);
    });

    it('clamps rather than refuses, because the row is already stored', () => {
        expect(level('-60')).toBe(PAD_LEVEL_BOUNDS.min);
        expect(level('20')).toBe(PAD_LEVEL_BOUNDS.max);
    });

    it('takes the default for a value nobody can read, including an emptied box', () => {
        // A bare `Number('')` is 0, which would quietly mean "level with the words".
        expect(level('loud')).toBe(-6);
        expect(level('')).toBe(-6);
    });
});
