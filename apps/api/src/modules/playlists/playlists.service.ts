import { Injectable } from 'injectkit';
import { stationCover } from '#modules/art/art.source.token.js';
import { httpError } from '@maroonedsoftware/errors';
import { JobBroker } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { DateTime } from 'luxon';
import { PLUGIN_CAPABILITY_CATALOG, type MusicProviderPluginInstance, type PluginManifest, type ProviderPlaylist } from '@deadair/plugin-sdk';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import { HiddenPlaylistsRepository, hiddenPlaylistKey } from '#modules/catalog/hidden.playlists.repository.js';
import { ProviderPlaylistsRepository, type ProviderPlaylistListing } from '#modules/catalog/provider.playlists.repository.js';
import { AccessControlService, isAllVisible } from '#modules/permissions/access.control.service.js';
import { asCatalogPlugin, implementsCatalog } from '#modules/plugins/plugin.capabilities.js';
import { pluginHttpError } from '#modules/plugins/plugin.error.http.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import type { PluginRecord } from '#modules/plugins/types/plugin.record.js';
import type {
    CatalogPlaylist,
    CatalogPlaylistPage,
    CatalogPlaylistSource,
    CatalogPlaylistTracks,
    CatalogSourceError,
    CatalogTrack,
} from './types/playlists.types.js';
import { serverkitErrorText } from '#modules/shared/error.text.js';
import { PLUGIN_PAGE_SIZE, pluginPages } from '#modules/plugins/plugin.paging.js';

/**
 * Why a plugin that declares a catalog cannot be asked for one right now, or
 * `undefined` when its state is not something to report.
 *
 * The messages name the operator's next move rather than the internal state: a
 * quarantined plugin is cleared by a reload, a misconfigured one by fixing its
 * settings, and a plugin that declares a capability it does not implement is
 * its author's bug and nothing the operator can do anything about.
 */
const unavailableReason = (record: PluginRecord): string | undefined => {
    const detail = record.error ? `: ${record.error}` : '';
    switch (record.status) {
        case 'failed':
            return `quarantined after a failure${detail}. Reload the plugin once the cause is fixed`;
        case 'misconfigured':
            return `its configuration is not valid${detail}`;
        case 'active':
            // Active, but `asCatalogPlugin` still refused it: it declares `catalog`
            // and does not implement the methods.
            return 'it declares a catalog but does not implement one, so it cannot be asked for playlists';
        default:
            // `discovered` and `disabled`: never turned on, so not a fault.
            return undefined;
    }
};

/** A plugin that declares a catalog, and why it cannot be called right now when it cannot. */
interface CatalogSource {
    record: PluginRecord;
    manifest: PluginManifest;
    unavailable?: string;
}

/** One provider playlist as the page lists it, marked when an operator hid it. */
function toCatalogPlaylist(record: PluginRecord, manifest: PluginManifest, playlist: ProviderPlaylist, hidden: ReadonlySet<string>): CatalogPlaylist {
    return {
        pluginId: record.id,
        pluginName: manifest.name,
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        trackCount: playlist.trackCount,
        // A provider's playlist cover can carry a credential (a Navidrome one does), so it is reported
        // through the station's proxy, as every catalog read's is.
        artworkUrl: stationCover(playlist.artworkUrl),
        permissions: playlist.permissions,
        madeByProvider: playlist.madeByProvider,
        // Marked rather than removed: the console folds these away and offers them back, which it
        // cannot do for a playlist this page never mentioned.
        ...(hidden.has(hiddenPlaylistKey(record.id, playlist.id)) ? { hidden: true } : {}),
    };
}

/**
 * The read-only surface for "what could I import from a plugin": every
 * catalog-capable plugin's playlists, aggregated, and one plugin's playlist
 * tracks on demand.
 *
 * The LIST of a provider's playlists is answered from what the library sync
 * last read (`deadair.provider_playlist_listings`), and a source is asked live
 * only when nothing has been kept for it yet. Every answer about what a
 * playlist HOLDS is still a live call through {@link PluginInvoker}, which is
 * what keeps a slow or crashing plugin from becoming a slow or crashing
 * request. The database is also asked {@link catalogIds}, which names what the
 * station already has of the same copies, and which playlists an operator has
 * hidden, which is the one thing written here and holds nothing but the pair.
 */
@Injectable()
export class PlaylistsService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly accessControl: AccessControlService,
        // Read-only, and only ever to answer "does the station already hold this copy". A playlist
        // is the provider's list and nothing here writes to the catalog.
        private readonly tracks: TracksRepository,
        // The playlists an operator hid. This service marks them and writes them; it never drops one
        // from the listing, because the console still has to be able to show them again.
        private readonly hidden: HiddenPlaylistsRepository,
        // The lists of playlists the library sync last read. Read here and never written: the sync
        // is the one writer, so the page cannot keep a list it read in a hurry over a better one.
        private readonly listings: ProviderPlaylistsRepository,
        // Scoped, so a refresh is enqueued in the request's transaction and exists only once it commits.
        private readonly jobs: JobBroker,
        private readonly logger: Logger,
    ) {}

    /**
     * Every catalog-capable plugin's playlists, as one page.
     *
     * A source's list comes from what the library sync last read, whenever it has read one. That is
     * the difference between this page and a provider having a bad minute: asked live, a Spotify
     * that was slow or rate limited (the sync walking it at the same moment was enough) answered
     * nothing inside the plugin's call timeout, and the page showed no playlists at all although the
     * station had read every one of them minutes earlier. `sources` says how old each list is, and
     * Refresh (`catalog.sync`) is what brings them up to date, in the background.
     *
     * A source with nothing kept, which is a provider connected since the last walk, is asked live
     * and paged to the end by {@link collect}. Those calls are concurrent and settled independently,
     * so one plugin throwing is reported beside the others' playlists rather than propagated. The
     * answer is not kept from here: the sync is the one writer of the kept lists, and a settings save
     * has already queued one for that plugin.
     *
     * A source that cannot be called right now (quarantined, misconfigured) still lists what was kept
     * for it, alongside the error saying why it is not answering: the playlists are what the operator
     * came for, and the station still holds their tracks.
     */
    async listPlaylists(): Promise<CatalogPlaylistPage> {
        const candidates = await this.catalogCapablePlugins();
        // Read beside the fan-out rather than before it: it is one small query against the station's
        // own database, and the plugins are the slow part.
        const hiddenKeys = this.hiddenKeys();
        const kept = await this.keptListings();

        const live = candidates.filter(source => source.unavailable === undefined && !kept.has(source.record.id));
        const settled = await Promise.allSettled(
            live.map(async ({ record }) => {
                const instance = record.instance as MusicProviderPluginInstance;
                return this.collect(record.id, 'catalog.listPlaylists', offset => instance.listPlaylists!({ limit: PLUGIN_PAGE_SIZE, offset }));
            }),
        );
        const answered = new Map(live.map(({ record }, index) => [record.id, settled[index]!]));
        const listedNow = DateTime.now();

        const hidden = await hiddenKeys;
        const playlists: CatalogPlaylist[] = [];
        const sources: CatalogPlaylistSource[] = [];
        const errors: CatalogSourceError[] = [];
        const add = (record: PluginRecord, manifest: PluginManifest, listedAt: DateTime, listed: readonly ProviderPlaylist[]) => {
            sources.push({ pluginId: record.id, pluginName: manifest.name, listedAt });
            for (const playlist of listed) playlists.push(toCatalogPlaylist(record, manifest, playlist, hidden));
        };

        for (const { record, manifest, unavailable } of candidates) {
            const listing = kept.get(record.id);
            if (listing) add(record, manifest, listing.listedAt, listing.playlists);

            // A source the operator turned on and which is not working is the single most useful
            // thing this page can say, kept list or not. Dropping it silently leaves an empty list
            // whose only explanation is the empty state's advice to enable a plugin that IS enabled.
            if (unavailable !== undefined) {
                errors.push({ pluginId: record.id, pluginName: manifest.name, message: unavailable });
                continue;
            }

            const outcome = answered.get(record.id);
            if (outcome?.status === 'fulfilled') add(record, manifest, listedNow, outcome.value);
            if (outcome?.status === 'rejected') {
                const message = serverkitErrorText(outcome.reason);
                this.logger.warn('catalog plugin could not list playlists', { plugin: record.id, error: message });
                errors.push({ pluginId: record.id, pluginName: manifest.name, message });
            }
        }

        return { playlists, sources, errors };
    }

    /**
     * Hide one playlist from this station.
     *
     * Gated on seeing the plugin, as reading its tracks is, and on nothing about the plugin's
     * health: the pair is text, a row for a playlist the provider no longer has is inert, and an
     * operator tidying the page must not be stopped because the provider happens to be down. The
     * route's own floor (`platform.manage`) is what makes this a write only an admin can make.
     *
     * @throws 403 when the actor cannot see the plugin.
     */
    async hidePlaylist(pluginId: string, playlistId: string): Promise<void> {
        await this.accessControl.require({ namespace: 'plugin', id: pluginId }, 'view');
        await this.hidden.hide(pluginId, playlistId);
    }

    /**
     * Show a hidden playlist again. The same gate as {@link hidePlaylist}, for the same reasons.
     *
     * @throws 403 when the actor cannot see the plugin.
     */
    async showPlaylist(pluginId: string, playlistId: string): Promise<void> {
        await this.accessControl.require({ namespace: 'plugin', id: pluginId }, 'view');
        await this.hidden.show(pluginId, playlistId);
    }

    /**
     * Ask for every playlist on every music source to be read again, now rather than at the next
     * scheduled walk.
     *
     * The walk is `catalog.sync`, the same job the hourly schedule runs, and it runs whatever the
     * schedule settings say: turning the automatic read off must not turn the button off. The
     * payload names who asked, because a payload with no keys is how that job recognises its own
     * cron run.
     */
    async requestRefresh(): Promise<void> {
        await this.jobs.send('catalog.sync', { requestedBy: 'operator' });
    }

    /**
     * Ask for one playlist to be read again. That walk ingests what it finds and never retires
     * anything, because one playlist is no evidence about the rest of the library.
     *
     * @throws 403, 404, 501 or 503 on the same terms as {@link getPlaylistTracks}, so an operator
     *   asking for a plugin that cannot answer is told now rather than finding nothing happened.
     *   409 for a playlist the operator hid, which the walk would refuse to read.
     */
    async requestPlaylistRefresh(pluginId: string, playlistId: string): Promise<void> {
        await this.requireCatalogCapable(pluginId);

        const hidden = await this.hidden.keys();
        if (hidden.has(hiddenPlaylistKey(pluginId, playlistId))) {
            throw httpError(409).withDetails({ message: 'this playlist is hidden, so the station does not read it. Show it again first' });
        }

        await this.jobs.send('catalog.sync', { pluginId, playlistId, requestedBy: 'operator' });
    }

    /**
     * Every track in one playlist, not the first page of them.
     *
     * The whole list is the answer here rather than a page of it, because the
     * caller that matters is the director sourcing a running order: a truncated
     * read there is a station that airs the top of a playlist and reports
     * success, which is indistinguishable from a short playlist.
     *
     * @throws 403 when the actor may not view this plugin, 404 when the plugin
     *   is not installed, 501 when it does not declare/implement `catalog`,
     *   503 when it is installed but not currently active. Otherwise whatever
     *   {@link pluginHttpError} makes of a thrown `PluginError`
     *   (429/500/502/503/504): here a plugin failure IS the answer, so it
     *   propagates rather than being collected.
     */
    async getPlaylistTracks(pluginId: string, playlistId: string): Promise<CatalogPlaylistTracks> {
        const { record } = await this.requireCatalogCapable(pluginId);
        const instance = record.instance as MusicProviderPluginInstance;

        let tracks: readonly {
            id: string;
            title: string;
            artists: string[];
            album?: string;
            durationMs?: number;
            isrc?: string;
            artworkUrl?: string;
        }[];
        try {
            tracks = await this.collect(pluginId, 'catalog.getPlaylistTracks', offset =>
                instance.getPlaylistTracks!(playlistId, { limit: PLUGIN_PAGE_SIZE, offset }),
            );
        } catch (error) {
            throw pluginHttpError(pluginId, error);
        }

        // What the catalog holds for these same copies, so a console can reach a record it has
        // ingested rather than reading a provider's name with nowhere to go. Never fails the
        // listing: this is a live read of somebody else's playlist and the ids are decoration.
        const known = await this.catalogIds(pluginId, tracks);

        return {
            pluginId,
            playlistId,
            tracks: tracks.map((track): CatalogTrack => {
                const row = known.get(track.id);
                return {
                    id: track.id,
                    title: track.title,
                    artists: track.artists,
                    album: track.album,
                    durationMs: track.durationMs,
                    isrc: track.isrc,
                    artworkUrl: stationCover(track.artworkUrl),
                    // Absent for a copy no sync has walked, which on most playlists is plenty of
                    // rows: this endpoint lists what a PROVIDER holds, not what the station has.
                    ...(row === undefined ? {} : { trackId: row.trackId, artistId: row.artistId }),
                    ...(row?.albumId == null ? {} : { albumId: row.albumId }),
                };
            }),
        };
    }

    /**
     * The canonical ids behind one plugin's copies, by that plugin's own id.
     *
     * Batched: one query for a whole playlist rather than one per row behind a request an operator
     * is waiting on. Empty when the catalog cannot answer, exactly as the director's own use of the
     * same read is — a playlist that lists is worth more than a playlist that links, so a database
     * fault costs the links and nothing else.
     *
     * The director resolves these bindings again on its way to air, and that is not this call going
     * spare: it wants the catalog's year and cover to draw a running order with, and it prefers the
     * provider's answer where the two disagree. Two reads on one operator action, for two purposes.
     */
    private async catalogIds(pluginId: string, tracks: readonly { id: string }[]) {
        try {
            const rows = await this.tracks.findByBindings(
                pluginId,
                tracks.map(track => track.id),
            );
            return new Map(rows.map(row => [row.externalId, row]));
        } catch (error) {
            this.logger.warn('playlists: could not read catalog ids for a playlist; listing it as the provider gave it', {
                plugin: pluginId,
                error: serverkitErrorText(error),
            });
            return new Map();
        }
    }

    /**
     * Offset pagination over a plugin call, stopping at the first short page.
     *
     * A provider answers with its own default page when asked for no `limit`,
     * and that default is small (20 items on Spotify's playlist reads), so a
     * single call is not "the playlist" — it is the top of it. Nothing upstream
     * could tell the difference, which is what makes this the quiet kind of bug.
     *
     * {@link pluginPages} does the walking, including the page cap and why it is
     * loud. A page that throws propagates to the caller rather than being
     * swallowed: a half-read playlist is worse than a refused one.
     *
     * Collected rather than streamed, unlike the catalog sync's use of the same
     * walk, because a route answers with the whole list or with an error.
     */
    private async collect<T>(pluginId: string, op: string, fetch: (offset: number) => Promise<T[]>): Promise<T[]> {
        const items: T[] = [];
        for await (const item of pluginPages(this.pluginInvoker, this.logger, { pluginId, op, incomplete: 'this list' }, fetch)) {
            items.push(item);
        }
        return items;
    }

    /**
     * The visible-to-the-actor plugins that declare a catalog, in the registry's order, each with
     * why it cannot be called right now when it cannot.
     *
     * Visibility is narrowed exactly like {@link PluginsService.listPlugins}:
     * `{ all: true }` skips the filter for actors whose role already covers
     * every plugin.
     *
     * `unavailable` is what keeps a broken source from disappearing. It
     * deliberately covers only the states the operator has already asked to be
     * working — quarantined, misconfigured, or declaring a capability it does
     * not implement. A `discovered` or `disabled` plugin is left out altogether,
     * kept list and all: it was never turned on, or was turned off, so calling
     * that an error would put a permanent warning on the page for a choice the
     * operator made, and listing its playlists would offer ones nothing can read.
     *
     * A record with no manifest is skipped entirely, however it failed: without
     * one there is no way to know it was ever a catalog, and attributing an
     * enrichment plugin's failure to this page would be worse than silence.
     */
    private async catalogCapablePlugins(): Promise<CatalogSource[]> {
        const visible = await this.accessControl.listVisibleIds('plugin', 'view');
        const records = this.pluginRegistry.list();
        let narrowed = records;
        if (!isAllVisible(visible)) {
            const visibleIds = new Set(visible.ids);
            narrowed = records.filter(record => visibleIds.has(record.id));
        }

        const sources: CatalogSource[] = [];
        for (const record of narrowed) {
            const catalog = asCatalogPlugin(record);
            if (catalog) {
                sources.push({ record, manifest: catalog.manifest });
                continue;
            }

            const manifest = record.manifest;
            if (!manifest?.capabilities.includes(PLUGIN_CAPABILITY_CATALOG)) continue;

            const reason = unavailableReason(record);
            if (reason) sources.push({ record, manifest, unavailable: reason });
        }

        return sources;
    }

    /**
     * The lists the library sync kept, by plugin, or none at all when they cannot be read.
     *
     * Never fails the listing, on {@link hiddenKeys}' argument: with nothing kept, every source is
     * simply asked live, which is how this page worked before anything was kept.
     */
    private async keptListings(): Promise<Map<string, ProviderPlaylistListing>> {
        try {
            const listings = await this.listings.list();
            return new Map(listings.map(listing => [listing.pluginId, listing]));
        } catch (error) {
            this.logger.warn('could not read the kept playlist lists; asking every source live', { error: serverkitErrorText(error) });
            return new Map();
        }
    }

    /**
     * Narrows on top of the route policy's authentication floor, the same way
     * {@link PluginsService.getPlugin} does: the per-object `plugin:view`
     * check runs before the registry lookup, so an actor who cannot see this
     * plugin gets an identical 403 whether or not it is installed. Checking
     * after the lookup would leak the installed set through the difference
     * between 403, 404, 501 and 503.
     *
     * `listPlaylists` filters with `listVisibleIds` instead of this; that is
     * the same permission reached from the other direction, and a list must
     * omit rather than reject.
     *
     * @throws 403 not visible to the actor, 404 unknown id, 501 no catalog
     *   capability, 503 installed but not active.
     */
    /**
     * The hidden pairs, or none at all when they cannot be read.
     *
     * Never fails the listing, on {@link catalogIds}' argument: the playlists are the answer and the
     * mark is decoration. A station whose database blips shows a hidden playlist for one read, which
     * is a far smaller surprise than a Playlists page that will not load.
     */
    private async hiddenKeys(): Promise<Set<string>> {
        try {
            return await this.hidden.keys();
        } catch (error) {
            this.logger.warn('could not read the hidden playlists; listing every playlist unmarked', { error: serverkitErrorText(error) });
            return new Set();
        }
    }

    private async requireCatalogCapable(pluginId: string): Promise<{ record: PluginRecord; manifest: PluginManifest }> {
        await this.accessControl.require({ namespace: 'plugin', id: pluginId }, 'view');

        const record = this.pluginRegistry.get(pluginId);
        if (!record) throw httpError(404).withDetails({ message: `plugin "${pluginId}" is not installed` });

        const manifest = record.manifest;
        if (!manifest || !manifest.capabilities.includes(PLUGIN_CAPABILITY_CATALOG)) {
            throw httpError(501).withDetails({ message: `plugin "${pluginId}" does not support a catalog` });
        }

        if (record.status !== 'active' || !record.instance) {
            const reason = record.error ? `: ${record.error}` : '';
            throw httpError(503).withDetails({ message: `plugin "${pluginId}" is not running (status: ${record.status})${reason}` });
        }

        if (!implementsCatalog(manifest, record.instance)) {
            throw httpError(501).withDetails({ message: `plugin "${pluginId}" declares a catalog but does not implement it` });
        }

        return { record, manifest };
    }
}
