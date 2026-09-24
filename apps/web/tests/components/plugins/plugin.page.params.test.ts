import { describe, expect, it } from 'vitest';

import { defaultShow, matchesSearch, matchesShow, validatePluginsPage } from '../../../src/components/plugins/plugin.page.params';
import { pluginSummary } from '../../utils/plugin.fixture';

describe('validatePluginsPage', () => {
    it('keeps a term, a filter and a layout it recognises', () => {
        expect(validatePluginsPage({ q: 'voice', show: 'attention', view: 'table' })).toEqual({ q: 'voice', show: 'attention', view: 'table' });
    });

    it('falls back on anything it does not, rather than throwing', () => {
        // No filter is "not chosen", which the page decides from the plugins, rather than "All".
        expect(validatePluginsPage({ q: 42, show: 'broken', view: 'grid' })).toStrictEqual({ q: '', show: undefined, view: 'cards' });
        expect(validatePluginsPage({})).toStrictEqual({ q: '', show: undefined, view: 'cards' });
    });
});

describe('defaultShow', () => {
    it('opens on what needs attention when anything does, switched on or not', () => {
        expect(defaultShow([pluginSummary(), pluginSummary({ status: 'misconfigured', enabled: false })])).toBe('attention');
    });

    it('opens on what is switched on when nothing needs attention', () => {
        expect(defaultShow([pluginSummary(), pluginSummary({ enabled: false, status: 'disabled' })])).toBe('enabled');
    });

    it('opens on everything when nothing is switched on, which is a fresh install', () => {
        expect(defaultShow([pluginSummary({ enabled: false, status: 'discovered' })])).toBe('all');
        expect(defaultShow([])).toBe('all');
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
