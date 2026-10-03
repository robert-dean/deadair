import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { CatalogPlaceholderRepository } from '#modules/catalog/ingest/catalog.placeholder.repository.js';
import { CatalogResolverRepository } from '#modules/catalog/ingest/catalog.resolver.repository.js';
import { ProviderCopyResolver } from '#modules/catalog/ingest/provider.copy.resolver.js';
import { DISCOVER_DEFAULT, DISCOVER_KEY } from '#modules/director/pick.resolver.js';
import { ProviderTrackLookup } from '#modules/director/provider.track.lookup.js';
import { errorText } from '#modules/shared/error.text.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { StationPlaylistsRepository, type PlaylistPlaceholderRow } from './station.playlists.repository.js';

/**
 * The most placeholders one fill looks up.
 *
 * Every miss searches every provider one after another, which is the rate-limited half of the
 * station's upstream budget, so a thousand-record import is filled across presses rather than in one
 * run that spends a provider's whole allowance. Whatever is left is still a placeholder, and the
 * operator can ask again.
 */
export const MAX_FILL_LOOKUPS = 250;

export interface PlaylistFillSummary {
    /** Placeholders that now name a library record. */
    filled: number;
    /** Placeholders nothing could be found for. */
    missed: number;
    /** Placeholders left for a later fill, past {@link MAX_FILL_LOOKUPS}. */
    remaining: number;
    /** Set when the station may not add records to its library, and nothing was looked up. */
    refused?: 'discover-off';
}

/**
 * Fills an imported playlist's placeholders by finding the records they describe.
 *
 * This is DISCOVERY, on the station's existing terms: the record is ingested as `discovered`, which
 * keeps the sync's sweep from benching a copy no playlist walk will ever see, and the whole thing is
 * gated on `rotation.discover`, the station's one switch for adding records to its own library. It
 * is what `PickResolver.discover` does for a record a generator named, run over the rows an operator
 * imported instead.
 *
 * Each row is tried three ways, cheapest and most exact first:
 *
 * 1. The library again, since it may have gained the record since the import.
 * 2. The provider copy the row was cloned from, asked for by its id, when that plugin is here and
 *    can answer. An exact answer to an exact question, and the only way a file from another
 *    station's Spotify lands on the same recording here.
 * 3. A strict search by title and lead artist across every provider, through
 *    {@link ProviderTrackLookup}, whose near-miss refusal is the reason it is safe to ingest from.
 *
 * Runs in a plain job rather than a transactional one: it talks to providers between writes, and each
 * ingest commits on its own so a failure part-way keeps what was already found.
 */
@Injectable()
export class PlaylistFillService {
    constructor(
        private readonly playlists: StationPlaylistsRepository,
        private readonly placeholders: CatalogPlaceholderRepository,
        private readonly library: CatalogResolverRepository,
        private readonly copies: ProviderCopyResolver,
        private readonly lookup: ProviderTrackLookup,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    async fill(playlistId: string, signal?: AbortSignal): Promise<PlaylistFillSummary> {
        const rows = await this.playlists.placeholders(playlistId);
        if (rows.length === 0) return { filled: 0, missed: 0, remaining: 0 };

        if (!settingIsOn(this.config, DISCOVER_KEY, DISCOVER_DEFAULT)) {
            return { filled: 0, missed: 0, remaining: rows.length, refused: 'discover-off' };
        }

        const batch = rows.slice(0, MAX_FILL_LOOKUPS);
        const summary: PlaylistFillSummary = { filled: 0, missed: 0, remaining: rows.length - batch.length };

        for (const [at, row] of batch.entries()) {
            if (signal?.aborted) {
                summary.remaining += batch.length - at;
                break;
            }

            const trackId = await this.find(row);
            if (trackId !== undefined && (await this.placeholders.resolve(row.id, trackId))) summary.filled += 1;
            else summary.missed += 1;
        }

        this.logger.info('playlists: filled placeholders', { playlist: playlistId, ...summary });
        return summary;
    }

    private async find(row: PlaylistPlaceholderRow): Promise<string | undefined> {
        try {
            if (row.origin !== undefined) {
                const bound = await this.library.findTrackSource(row.origin.pluginId, row.origin.externalId);
                if (bound !== undefined) return bound;
            }
            if (row.snapshot !== undefined) {
                const held = await this.library.findTrack(row.snapshot);
                if (held !== undefined) return held;
            }

            const copy =
                row.origin === undefined ? undefined : await this.copies.copy(row.origin.pluginId, row.origin.externalId, 'playlists.fill.getTrack');
            if (copy !== undefined) return await this.copies.take(copy.pluginId, copy.track);

            const lead = row.snapshot?.artists[0];
            if (row.snapshot === undefined || lead === undefined) return undefined;
            const found = await this.lookup.find(row.snapshot.title, lead);
            return found === undefined ? undefined : await this.copies.take(found.pluginId, found.track);
        } catch (error) {
            // One row that could not be found is a miss rather than a failed fill: the rest of the
            // playlist is still worth trying, and this row is still a placeholder to try again.
            this.logger.warn('playlists: could not fill a placeholder', { row: row.id, error: errorText(error) });
            return undefined;
        }
    }
}
