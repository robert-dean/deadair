// What a picker may offer. A picker is where a playlist becomes something the station will try to
// air, so the two kinds it leaves out are the ones that would only fail later: hidden by an operator,
// or refused by their source. What the picker already holds is the exception, whatever it is.

import { describe, expect, it } from 'vitest';

import { canReadTracks, offerablePlaylists } from '../../../src/components/playlists/playlist.offerable';
import { catalogPlaylist } from '../../utils/playlist.fixture';

describe('canReadTracks', () => {
    it('reads "did not say" as readable, and only a list without read as a refusal', () => {
        expect(canReadTracks(catalogPlaylist({ permissions: undefined }))).toBe(true);
        expect(canReadTracks(catalogPlaylist({ permissions: ['read'] }))).toBe(true);
        expect(canReadTracks(catalogPlaylist({ permissions: [] }))).toBe(false);
        expect(canReadTracks(catalogPlaylist({ permissions: ['edit'] }))).toBe(false);
    });
});

describe('offerablePlaylists', () => {
    const mine = catalogPlaylist({ id: 'mine' });
    const hidden = catalogPlaylist({ id: 'hidden', hidden: true });
    const refused = catalogPlaylist({ id: 'refused', permissions: [] });
    const unsaid = catalogPlaylist({ id: 'unsaid', permissions: undefined });

    it('leaves out what an operator hid and what the source refuses, and keeps the rest', () => {
        expect(offerablePlaylists([mine, hidden, refused, unsaid]).map(playlist => playlist.id)).toEqual(['mine', 'unsaid']);
    });

    // A slot saved before its playlist was hidden still plays from it. Dropping it from the options
    // would draw the select empty, which reads as a slot that plays nothing.
    it('keeps the one the picker already holds, hidden or refused', () => {
        const kept = offerablePlaylists([mine, hidden, refused], { pluginId: hidden.pluginId, playlistId: 'hidden' });

        expect(kept.map(playlist => playlist.id)).toEqual(['mine', 'hidden']);
    });

    it('keeps a chosen playlist only on the plugin it was chosen from', () => {
        const kept = offerablePlaylists([hidden], { pluginId: 'deadair.navidrome', playlistId: 'hidden' });

        expect(kept).toEqual([]);
    });
});
