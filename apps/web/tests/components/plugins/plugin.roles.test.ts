import { describe, expect, it } from 'vitest';

import { capabilityLabel, groupByRole, needsAttention, OTHER_ROLE, roleOf } from '../../../src/components/plugins/plugin.roles';
import { pluginSummary } from '../../utils/plugin.fixture';

describe('capabilityLabel', () => {
    it('names a known capability in the station words', () => {
        expect(capabilityLabel('enrichment')).toBe('Record details');
        expect(capabilityLabel('oauth')).toBe('Sign-in');
    });

    it('falls back to the id for a capability this console has never heard of', () => {
        expect(capabilityLabel('lyrics')).toBe('lyrics');
    });
});

describe('roleOf', () => {
    it('files a plugin under the first group any of its capabilities matches', () => {
        // Last.fm declares charts too, and Knowledge comes before News & programmes.
        expect(roleOf(pluginSummary({ capabilities: ['enrichment', 'charts', 'similarity', 'scrobble', 'oauth'] })).key).toBe('knowledge');
        expect(roleOf(pluginSummary({ capabilities: ['catalog', 'stream', 'enrichment'] })).key).toBe('music');
        expect(roleOf(pluginSummary({ capabilities: ['analysis', 'mixer'] })).key).toBe('audio');
        expect(roleOf(pluginSummary({ capabilities: ['enrichment', 'almanac'] })).key).toBe('knowledge');
        expect(roleOf(pluginSummary({ capabilities: ['news'] })).key).toBe('programmes');
    });

    it('puts a plugin nobody claims under Other rather than nowhere', () => {
        expect(roleOf(pluginSummary({ capabilities: ['lyrics'] }))).toBe(OTHER_ROLE);
        expect(roleOf(pluginSummary({ capabilities: [] }))).toBe(OTHER_ROLE);
    });
});

describe('groupByRole', () => {
    it('draws groups in role order, sorted by name within each, and leaves empty groups out', () => {
        const groups = groupByRole([
            pluginSummary({ id: 'x.rss', name: 'RSS', capabilities: ['news'] }),
            pluginSummary({ id: 'x.spotify', name: 'Spotify', capabilities: ['catalog', 'stream'] }),
            pluginSummary({ id: 'x.lyrics', name: 'Lyrics', capabilities: ['lyrics'] }),
            pluginSummary({ id: 'x.navidrome', name: 'Navidrome', capabilities: ['catalog', 'stream'] }),
        ]);

        expect(groups.map(group => group.role.key)).toEqual(['music', 'programmes', 'other']);
        expect(groups[0]?.plugins.map(plugin => plugin.name)).toEqual(['Navidrome', 'Spotify']);
    });

    it('answers nothing for nothing', () => {
        expect(groupByRole([])).toEqual([]);
    });
});

describe('needsAttention', () => {
    it('is true for a plugin that failed or is misconfigured', () => {
        expect(needsAttention(pluginSummary({ status: 'failed' }))).toBe(true);
        expect(needsAttention(pluginSummary({ status: 'misconfigured' }))).toBe(true);
    });

    it('is false for one that is running, or that the operator switched off', () => {
        expect(needsAttention(pluginSummary({ status: 'active' }))).toBe(false);
        expect(needsAttention(pluginSummary({ status: 'disabled' }))).toBe(false);
        expect(needsAttention(pluginSummary({ status: 'discovered' }))).toBe(false);
    });
});
