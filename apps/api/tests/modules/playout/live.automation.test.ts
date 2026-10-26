import { describe, expect, it } from 'vitest';

import { DEFAULT_LIVE_AUTOMATION, parseLiveAutomation } from '../../../src/modules/playout/live.automation.js';

describe('parseLiveAutomation', () => {
    it('reads both modes', () => {
        expect(parseLiveAutomation('standDown')).toBe('standDown');
        expect(parseLiveAutomation('continue')).toBe('continue');
    });

    it('answers the default for unset, empty and unrecognised values, which is standing down', () => {
        expect(DEFAULT_LIVE_AUTOMATION).toBe('standDown');
        expect(parseLiveAutomation(undefined)).toBe('standDown');
        expect(parseLiveAutomation('')).toBe('standDown');
        expect(parseLiveAutomation('true')).toBe('standDown');
    });
});
