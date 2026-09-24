import { httpError } from '@maroonedsoftware/errors';
import type { StationPlaylistRowTrack } from './station.playlists.repository.js';
import type { PlaylistImportEntrySource } from './playlist.import.planner.js';
import type { PlaylistFile, PlaylistFileTrack } from './types/station.playlists.types.js';

/**
 * The shape a playlist file is written in.
 *
 * Checked on the way in by its prefix, so a later `/2` is refused with a sentence rather than read as
 * though it were this one. The schema validates the fields; this names the document.
 */
export const PLAYLIST_FILE_FORMAT = 'deadair.playlist/1';

/**
 * One row as a file carries it.
 *
 * By its words and its ISRC and never by this station's ids, which every library mints afresh
 * ([backup-and-restore](https://github.com/robert-dean/deadair/discussions/6), "An export is keyed by
 * NATURAL keys"). A placeholder also carries the copy it was cloned from, verbatim, so a record the
 * receiving library does not hold lands as a placeholder that can still resolve by that copy rather
 * than as a miss.
 */
export function fileTrackOf(row: StationPlaylistRowTrack): PlaylistFileTrack {
    return {
        title: row.title,
        artists: row.artists,
        ...(row.album === undefined ? {} : { album: row.album }),
        ...(row.durationMs === undefined ? {} : { durationMs: row.durationMs }),
        ...(row.isrc === undefined ? {} : { isrc: row.isrc }),
        ...(row.trackId === undefined && row.originPluginId !== undefined && row.originExternalId !== undefined
            ? { origin: { pluginId: row.originPluginId, externalId: row.originExternalId } }
            : {}),
    };
}

/**
 * A file as the entries the planner reads.
 *
 * @throws 422 for a file that says it is some other shape. Not a 400: the body parsed, and it is the
 *   document that is the wrong kind of document.
 */
export function entriesOfFile(file: PlaylistFile): PlaylistImportEntrySource {
    if (!file.format.startsWith('deadair.playlist/')) {
        throw httpError(422).withDetails({ message: `this is not a playlist file: it says it is "${file.format}"` });
    }
    if (file.format !== PLAYLIST_FILE_FORMAT) {
        throw httpError(422).withDetails({
            message: `this playlist file is "${file.format}", which a later build wrote. This station reads "${PLAYLIST_FILE_FORMAT}"`,
        });
    }

    return {
        name: file.name,
        prompt: file.prompt ?? '',
        entries: file.tracks.map(track => ({
            title: track.title,
            artists: track.artists,
            ...(track.album === undefined ? {} : { album: track.album }),
            ...(track.durationMs === undefined ? {} : { durationMs: track.durationMs }),
            ...(track.isrc === undefined ? {} : { isrc: track.isrc }),
            ...(track.origin === undefined ? {} : { origin: track.origin }),
        })),
        skipped: 0,
        notices: [],
    };
}
