import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { CatalogPlaceholderRepository, type PlaylistPlaceholder } from './catalog.placeholder.repository.js';
import { CatalogResolverRepository, type TrackIdentity } from './catalog.resolver.repository.js';

/**
 * Rows examined per run.
 *
 * The whole pass is one transaction (see `CatalogPlaceholderJob`), so the batch
 * is also how long that transaction holds a connection. Bounded rather than
 * "everything outstanding" for that reason; whatever is left is picked up by
 * the next run, and there is always a next run because the sync sends one every
 * time it adds to the library.
 */
const BATCH_SIZE = 500;

export interface PlaceholderSummary {
    scanned: number;
    resolved: number;
}

/**
 * Second chances for imported playlist rows whose track was not in the library
 * when they were imported.
 *
 * The schema is explicit that an import must not be lossy: importing 200 tracks
 * against a library that resolves 150 keeps the other 50 as placeholders "that
 * can resolve later as the library grows". This is that later. It runs after a
 * catalog sync that added anything, because that is exactly when the library
 * grew.
 *
 * Strictly lookup-only. A placeholder is evidence that somebody's playlist
 * mentions a track, not that the station has one, so resolution here may find
 * an existing canonical row and may never create one — otherwise every
 * unresolvable placeholder would manufacture a track nothing can play, and the
 * row would look resolved while being less true than before.
 */
@Injectable()
export class CatalogPlaceholderService {
    constructor(
        private readonly placeholders: CatalogPlaceholderRepository,
        private readonly resolver: CatalogResolverRepository,
        private readonly logger: Logger,
    ) {}

    /**
     * Re-checks one batch of placeholders and resolves the ones that can be.
     *
     * A placeholder that still matches nothing is left exactly as it was: no
     * error, no marker, no attempt counter. It is not a failure, it is a track
     * the library does not have yet, and the answer can change any time a
     * provider adds it.
     *
     * @param signal - Checked between rows, so a shutdown stops promptly. The
     *   caller's transaction decides what happens to the work already done.
     */
    async resolvePending(signal?: AbortSignal): Promise<PlaceholderSummary> {
        const pending = await this.placeholders.listUnresolved(BATCH_SIZE);
        const summary: PlaceholderSummary = { scanned: 0, resolved: 0 };

        for (const placeholder of pending) {
            if (signal?.aborted) break;
            summary.scanned++;
            const trackId = await this.findTrack(placeholder);
            if (!trackId) continue;
            if (await this.placeholders.resolve(placeholder.id, trackId)) summary.resolved++;
        }

        if (summary.scanned > 0) {
            this.logger.info('resolved playlist placeholders', { ...summary, batch: BATCH_SIZE });
        }
        return summary;
    }

    /**
     * The track a placeholder refers to, if the library has it now.
     *
     * The binding is asked first and is the only rung that needs no snapshot: it
     * is an exact answer to the exact question, since the placeholder recorded
     * which plugin's id space its id belongs to. Only when that misses is the
     * snapshot worth parsing.
     */
    private async findTrack(placeholder: PlaylistPlaceholder): Promise<string | undefined> {
        const bound = await this.resolver.findTrackSource(placeholder.originPluginId, placeholder.originExternalId);
        if (bound) return bound;

        const identity = this.toIdentity(placeholder.originSnapshot);
        if (!identity) return undefined;
        return this.resolver.findTrack(identity);
    }

    /**
     * The snapshot as something resolvable, or nothing.
     *
     * `origin_snapshot` is jsonb written by an earlier version of an importer
     * that no longer has to exist, so it is validated rather than trusted: a row
     * whose snapshot is missing, malformed or has no title is skipped instead of
     * throwing and taking the rest of the batch's transaction with it.
     */
    private toIdentity(snapshot: unknown): TrackIdentity | undefined {
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return undefined;
        const row = snapshot as Record<string, unknown>;

        const title = typeof row.title === 'string' ? row.title : undefined;
        if (!title) return undefined;

        const artists = Array.isArray(row.artists) ? row.artists.filter((a): a is string => typeof a === 'string') : [];

        return {
            title,
            artists,
            album: typeof row.album === 'string' ? row.album : undefined,
            durationMs: typeof row.durationMs === 'number' ? row.durationMs : undefined,
            isrc: typeof row.isrc === 'string' ? row.isrc : undefined,
        };
    }
}
