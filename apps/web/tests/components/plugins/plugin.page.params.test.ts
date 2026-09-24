import { describe, expect, it } from 'vitest';

import { matchesSearch, matchesShow, validatePluginsPage } from '../../../src/components/plugins/plugin.page.params';
import { pluginSummary } from '../../utils/plugin.fixture';

describe('validatePluginsPage', () => {
    it('keeps a term and a filter it recognises', () => {
        expect(validatePluginsPage({ q: 'voice', show: 'attention' })).toEqual({ q: 'voice', show: 'attention' });
    });

    it('falls back on anything it does not, rather than throwing', () => {
        expect(validatePluginsPage({ q: 42, show: 'broken' })).toEqual({ q: '', show: 'all' });
        expect(validatePluginsPage({})).toEqual({ q: '', show: 'all' });
    });
});

describe('matchesSearch', () => {
    const kokoro = pluginSummary({ id: 'deadair.kokoro', name: 'Kokoro', capabilities: ['speech'], description: 'Gives the station a voice.' });

    it('matches the name, the id and the description, ignoring case', () => {
        expect(matchesSearch(kokoro, 'KOKO')).toBe(true);
        expect(matchesSearch(kokoro, 'deadair.kok')).toBe(true);
        expect(matchesSearch(kokoro, 'station a voice')).toBe(true);
    });

    it('matches what the card says a plugin does, not only what it is called', () => {
        const rhapsode = pluginSummary({ id: 'deadair.rhapsode', name: 'Rhapsode', capabilities: ['speech'], description: undefined });
        expect(matchesSearch(rhapsode, 'voice')).toBe(true);
        expect(matchesSearch(pluginSummary({ capabilities: ['enrichment'] }), 'record details')).toBe(true);
    });

    it('lets everything through for an empty or blank term', () => {
        expect(matchesSearch(kokoro, '')).toBe(true);
        expect(matchesSearch(kokoro, '   ')).toBe(true);
    });

    it('turns away what it does not match', () => {
        expect(matchesSearch(kokoro, 'spotify')).toBe(false);
    });
});

describe('matchesShow', () => {
    it('counts a misconfigured plugin as needing attention whether or not it is switched on', () => {
        expect(matchesShow(pluginSummary({ status: 'misconfigured', enabled: false }), 'attention')).toBe(true);
        expect(matchesShow(pluginSummary({ status: 'misconfigured', enabled: false }), 'disabled')).toBe(true);
        expect(matchesShow(pluginSummary({ status: 'active' }), 'attention')).toBe(false);
    });

    it('splits the rest on the switch', () => {
        expect(matchesShow(pluginSummary({ enabled: true }), 'enabled')).toBe(true);
        expect(matchesShow(pluginSummary({ enabled: true }), 'disabled')).toBe(false);
        expect(matchesShow(pluginSummary({ enabled: false, status: 'disabled' }), 'all')).toBe(true);
    });
});
