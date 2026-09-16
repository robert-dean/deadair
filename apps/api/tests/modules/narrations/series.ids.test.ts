import { describe, expect, it } from 'vitest';

import { qualifySeriesId, splitSeriesId } from '../../../src/modules/narrations/series.ids.js';

describe('series ids', () => {
    it('round-trips a plugin id and its own series id', () => {
        expect(splitSeriesId(qualifySeriesId('deadair.audiobook', 'frankenstein'))).toEqual({
            pluginId: 'deadair.audiobook',
            seriesId: 'frankenstein',
        });
    });

    it('splits at the FIRST colon, so a plugin may use one in its own ids', () => {
        // A plugin id cannot hold a colon, so the first one is always the boundary.
        expect(splitSeriesId('deadair.audiobook:gutenberg:84')).toEqual({ pluginId: 'deadair.audiobook', seriesId: 'gutenberg:84' });
    });

    it('answers nothing rather than guessing which plugin was meant', () => {
        for (const bad of ['', 'nocolon', ':leading', 'trailing:']) expect(splitSeriesId(bad), bad).toBeUndefined();
    });
});
