// A run says where its records came from in one line, and a provider's playlist, a playlist the
// station owns and a chart are three different things to have auditioned over. The source carries
// exactly one kind of id, so which one is present is what the line is chosen by.

import { describe, expect, it } from 'vitest';

import { describeSource } from '../../../src/components/personas/persona.audition.card';
import { i18n } from '../../../src/i18n/i18n.setup';

const t = i18n.getFixedT('en', 'personas');

describe('describeSource', () => {
    it('names a provider playlist and the plugin it came from', () => {
        expect(describeSource({ pluginId: 'spotify', playlistId: 'pl1', name: 'Late night' }, t)).toBe('Late night — spotify');
    });

    it('says a station playlist is the station’s own', () => {
        expect(describeSource({ stationPlaylistId: '7b0c1a52-9a3e-4f43-8b1e-3d6f0f4a9c11', name: 'Sunday soul' }, t)).toBe(
            'Sunday soul — a station playlist',
        );
    });

    it('says a chart is a chart, falling back to its id without a caption', () => {
        expect(describeSource({ chartId: 'lastfm:top' }, t)).toBe('lastfm:top — a chart');
    });
});
