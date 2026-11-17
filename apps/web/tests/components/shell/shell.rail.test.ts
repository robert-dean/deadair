import { describe, expect, it } from 'vitest';

import { openRailSection } from '../../../src/components/shell/shell.rail';

describe('openRailSection', () => {
    it('is the footer inside Settings, so the destinations keep their height', () => {
        expect(openRailSection('/settings/station')).toBe('footer');
    });

    it('is the footer inside Check-up and on the plugins page Settings owns', () => {
        expect(openRailSection('/checkup')).toBe('footer');
        expect(openRailSection('/plugins')).toBe('footer');
    });

    it('is the destinations everywhere else, so the footer keeps its height', () => {
        expect(openRailSection('/')).toBe('destinations');
        expect(openRailSection('/voice')).toBe('destinations');
        expect(openRailSection('/catalog/tracks')).toBe('destinations');
    });
});
