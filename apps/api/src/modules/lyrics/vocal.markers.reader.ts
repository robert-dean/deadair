import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { pluginOrder } from '#modules/plugins/plugin.order.js';
import { LYRICS_KEYS } from './lyrics.keys.js';
import { LyricsRepository, type StoredTiming } from './lyrics.repository.js';
import { UNKNOWN_MARKERS, vocalMarkers, type VocalMarkers } from './vocal.ranges.js';

/**
 * Where the singing is on each of a set of records, from the lyrics the station holds.
 *
 * Derived when it is read and never stored, so tuning the constants in `vocal.ranges.ts` needs no
 * walk. One batched read per call: a talk-up decision asks about the record after a break, and the
 * planner asks about a whole window of them at once.
 *
 * Sources are believed in the operator's `lyrics.providerOrder`, then by id, read from the setting
 * rather than from the installed plugins: a row a since-removed plugin wrote is still a timing
 * somebody typed while listening.
 *
 * What leaves here is markers. The lines the repository hands over stay inside this class.
 */
@Injectable()
export class VocalMarkersReader {
    constructor(
        private readonly repository: LyricsRepository,
        private readonly config: AppConfig,
    ) {}

    async forTracks(trackIds: readonly string[]): Promise<Map<string, VocalMarkers>> {
        const markers = new Map<string, VocalMarkers>();
        const unique = [...new Set(trackIds)];
        if (unique.length === 0) return markers;

        const rows = await this.repository.timingsForTracks(unique);
        const order = pluginOrder(this.config, LYRICS_KEYS.providerOrder);
        const rank = (provider: string) => {
            const listed = order.indexOf(provider);
            return listed === -1 ? order.length : listed;
        };

        const byTrack = new Map<string, StoredTiming[]>();
        for (const row of rows) byTrack.set(row.trackId, [...(byTrack.get(row.trackId) ?? []), row]);

        for (const trackId of unique) {
            const own = (byTrack.get(trackId) ?? []).sort(
                (left, right) => rank(left.provider) - rank(right.provider) || left.provider.localeCompare(right.provider),
            );
            markers.set(trackId, own.length === 0 ? UNKNOWN_MARKERS : vocalMarkers(own));
        }

        return markers;
    }
}
