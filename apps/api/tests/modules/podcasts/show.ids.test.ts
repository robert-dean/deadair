import { describe, expect, it } from 'vitest';

import { qualifyShowId, splitShowId } from '../../../src/modules/podcasts/show.ids.js';

describe('show ids', () => {
    it('round-trips a plugin id and a show id', () => {
        expect(splitShowId(qualifyShowId('deadair.podcast', '73b7fb89'))).toEqual({ pluginId: 'deadair.podcast', showId: '73b7fb89' });
    });

    it('splits at the FIRST colon, so a show id may contain one', () => {
        expect(splitShowId(qualifyShowId('deadair.podcast', 'itunes:42'))).toEqual({ pluginId: 'deadair.podcast', showId: 'itunes:42' });
    });

    it.each(['73b7fb89', '', ':73b7fb89', 'deadair.podcast:'])('declines "%s", which names no plugin or no show', qualified => {
        expect(splitShowId(qualified)).toBeUndefined();
    });
});
