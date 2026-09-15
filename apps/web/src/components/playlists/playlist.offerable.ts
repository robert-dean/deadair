import type { CatalogPlaylist } from '@deadair/sdk';

/**
 * Whether the source will hand over this playlist's tracks.
 *
 * Absent permissions mean the source did not say, and that has to stay usable: most providers never
 * populate the field at all, and Spotify leaves it off when it could not check. Reading "no answer"
 * as "refused" would hide playlists that work perfectly well. Only an explicit list that omits
 * `read` is a refusal.
 */
export function canReadTracks(playlist: CatalogPlaylist): boolean {
    return playlist.permissions?.includes('read') ?? true;
}

/** A playlist a picker already holds, by the two ids a `CatalogPlaylist` is addressed by. */
export interface ChosenPlaylist {
    pluginId: string;
    playlistId: string;
}

/**
 * The playlists worth offering in a picker: not hidden by an operator, and not refused by their
 * source.
 *
 * A picker is where a playlist becomes something the station will try to air, so offering one whose
 * tracks the source will not hand over only moves the failure to air time, where nobody is looking.
 * The Playlists page is the one place that shows both kinds, and says why.
 *
 * `chosen` is what the picker already holds, and it stays in the list whatever it is. A slot saved
 * before its playlist was hidden still plays from it, and a select whose value is missing from its
 * options draws as empty, which would tell the operator the slot plays nothing at all.
 */
export function offerablePlaylists(playlists: readonly CatalogPlaylist[], chosen?: ChosenPlaylist): CatalogPlaylist[] {
    return playlists.filter(
        playlist =>
            (playlist.hidden !== true && canReadTracks(playlist)) ||
            (chosen !== undefined && playlist.pluginId === chosen.pluginId && playlist.id === chosen.playlistId),
    );
}
