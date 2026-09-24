import { Injectable } from 'injectkit';
import { DataRepository } from '../../data/data.repository.js';

/**
 * An imported playlist row whose track was not in the library at import time.
 *
 * The `origin_*` columns are the whole reason it can be retried: which plugin's
 * id space the item came from, the id itself, and the item as imported, so a
 * re-check needs no call back to the provider.
 */
export interface PlaylistPlaceholder {
    id: string;
    playlistId: string;
    position: number;
    /** Absent on a row known only by its snapshot, such as a line read from a file. */
    originPluginId?: string;
    originExternalId?: string;
    originSnapshot: unknown;
}

@Injectable()
export class CatalogPlaceholderRepository extends DataRepository {
    /**
     * Placeholders waiting on a track, oldest playlists first.
     *
     * A row is retryable if it names an upstream id or carries a snapshot to
     * match on, which `playlist_tracks_resolved_check` guarantees of every
     * placeholder. The filter is here anyway because a batch that silently
     * re-reads unresolvable rows every run would starve the ones that can
     * actually make progress.
     */
    async listUnresolved(limit: number): Promise<PlaylistPlaceholder[]> {
        const rows = await this.db
            .selectFrom('deadair.playlistTracks')
            .select(['id', 'playlistId', 'position', 'originPluginId', 'originExternalId', 'originSnapshot'])
            .where('trackId', 'is', null)
            .where(eb =>
                eb.or([eb.and([eb('originPluginId', 'is not', null), eb('originExternalId', 'is not', null)]), eb('originSnapshot', 'is not', null)]),
            )
            .orderBy('playlistId', 'asc')
            .orderBy('position', 'asc')
            .limit(limit)
            .execute();

        return rows.map(row => ({
            id: row.id,
            playlistId: row.playlistId,
            position: row.position,
            ...(row.originPluginId == null || row.originExternalId == null
                ? {}
                : { originPluginId: row.originPluginId, originExternalId: row.originExternalId }),
            originSnapshot: row.originSnapshot,
        }));
    }

    /**
     * Points a placeholder at the track it turned out to be.
     *
     * The `origin_*` columns are cleared in the same statement. They exist to
     * make an unresolved row retryable, and the schema says provenance is
     * load-bearing on placeholders specifically — a resolved row's identity is
     * the canonical track, and keeping a stale snapshot beside it would invite
     * reading it as the truth about the track.
     *
     * Guarded on `track_id is null` so two concurrent passes cannot both claim
     * the row and the second cannot overwrite the first's answer.
     *
     * @returns Whether this call was the one that resolved it.
     */
    async resolve(placeholderId: string, trackId: string): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.playlistTracks')
            .set({ trackId, originPluginId: null, originExternalId: null, originSnapshot: null })
            .where('id', '=', placeholderId)
            .where('trackId', 'is', null)
            .executeTakeFirst();
        return Number(result.numUpdatedRows ?? 0) > 0;
    }
}
