import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { JobBroker } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { entriesOfFile } from './playlist.file.js';
import { parsePlaylistText } from './playlist.text.parser.js';
import { asCatalogPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { pluginsWith } from '#modules/plugins/plugin.selection.js';
import { errorText } from '#modules/shared/error.text.js';
import { PlaylistsService } from './playlists.service.js';
import { PlaylistImportPlanner, type PlaylistImportEntrySource } from './playlist.import.planner.js';
import { StationPlaylistsRepository } from './station.playlists.repository.js';
import { toStationPlaylist } from './station.playlists.service.js';
import type { PlaylistImportInput, PlaylistImportPlan, PlaylistImportResult } from './types/station.playlists.types.js';

/**
 * Taking a playlist IN: what a source would become here, and making it so.
 *
 * Every source is read into one list of entries first, so the planner, the writer and the preview
 * are the same whatever the source was.
 *
 * ## A clone, never a merge
 *
 * 0005 says it in as many words: importing the same source twice makes two playlists, with no dedup
 * and no tie back to where it came from. So there is no "update" outcome to plan and nothing here
 * ever changes a playlist that already exists.
 *
 * ## Nothing is lost
 *
 * Every record the source names becomes a row, in its place. One the library holds is a row that can
 * air; one it does not is a placeholder carrying what the source said about it, which the placeholder
 * pass matches as the library grows.
 */
@Injectable()
export class PlaylistImportService {
    constructor(
        private readonly planner: PlaylistImportPlanner,
        private readonly playlists: StationPlaylistsRepository,
        // For a source a music provider holds: its tracks are read through the same narrowing the
        // console's own listing applies, so an actor who cannot see a plugin cannot import from it.
        private readonly providerPlaylists: PlaylistsService,
        private readonly registry: PluginRegistry,
        // Scoped, so the fill is enqueued in the request's transaction and exists only once the
        // playlist it fills does.
        private readonly jobs: JobBroker,
        private readonly logger: Logger,
    ) {}

    /** What this source would become here. Writes nothing. */
    async preview(input: PlaylistImportInput): Promise<PlaylistImportPlan> {
        const { plan } = await this.planner.plan(await this.sourceOf(input), input.name);
        return plan;
    }

    /**
     * Makes a new station playlist from a source.
     *
     * All or nothing, because the request runs in one transaction: the preview is what an operator
     * agreed to, and a playlist that landed half way is the one outcome nothing described.
     */
    async import(input: PlaylistImportInput): Promise<PlaylistImportResult> {
        const source = await this.sourceOf(input);
        const { plan, rows } = await this.planner.plan(source, input.name);

        const id = await this.playlists.create(
            { name: plan.name, prompt: source.prompt, ...(source.originPluginId === undefined ? {} : { originPluginId: source.originPluginId }) },
            rows,
        );
        // Whatever the library did not hold is looked up in the background at once, rather than
        // waiting for an operator to ask: an import is somebody saying they want these records.
        if (plan.toAdd + plan.toLookUp > 0) await this.jobs.send('playlists.fill', { playlistId: id });

        const playlist = await this.playlists.find(id);
        if (playlist === undefined) throw httpError(500).withDetails({ message: 'the playlist was written and could not be read back' });

        this.logger.info('playlists: imported a playlist', {
            playlist: id,
            matched: plan.matched,
            toAdd: plan.toAdd,
            toLookUp: plan.toLookUp,
            skipped: plan.skipped,
        });

        return { plan, playlist: toStationPlaylist(playlist) };
    }

    /**
     * The one source this input names, as entries.
     *
     * @throws 400 when it names none, or more than one. The schema cannot say "exactly one of", so
     *   this does. 422 for a link no music source here claims.
     */
    private async sourceOf(input: PlaylistImportInput): Promise<PlaylistImportEntrySource> {
        const named = [input.file, input.text, input.url, input.providerPlaylist].filter(source => source !== undefined).length;
        if (named > 1) throw httpError(400).withDetails({ message: 'import one thing at a time: a file, a list, a link or a playlist' });

        if (input.file !== undefined) return entriesOfFile(input.file);
        if (input.text !== undefined) return parsePlaylistText(input.text, input.format, input.fileName);
        if (input.providerPlaylist !== undefined) return await this.fromProvider(input.providerPlaylist.pluginId, input.providerPlaylist.playlistId);
        if (input.url !== undefined) {
            const claimed = this.claim(input.url);
            if (claimed === undefined) {
                throw httpError(422).withDetails({ message: 'none of the station’s music sources recognises that link as one of its playlists' });
            }
            return await this.fromProvider(claimed.pluginId, claimed.playlistId);
        }
        throw httpError(400).withDetails({ message: 'say what to import: a file, a list, a link or a playlist' });
    }

    /**
     * Which catalog provider a link belongs to, and the playlist it names there.
     *
     * Asked of every provider that can be browsed right now, in id order so the answer is the same
     * every time, and the first to claim it wins, which is why the SDK asks a provider to claim only
     * what it is sure of. A pure parse, so it is called directly rather than through the invoker: a
     * provider that throws here has a bug in a string function, which costs it the link and should
     * not count against it the way a failed upstream call does.
     */
    private claim(url: string): { pluginId: string; playlistId: string } | undefined {
        const providers = pluginsWith(this.registry.list(), asCatalogPlugin).sort((left, right) => left.record.id.localeCompare(right.record.id));
        for (const provider of providers) {
            const parse = provider.instance.playlistIdFromUrl;
            if (typeof parse !== 'function') continue;
            try {
                const playlistId = parse.call(provider.instance, url);
                if (playlistId !== undefined && playlistId.length > 0) return { pluginId: provider.record.id, playlistId };
            } catch (error) {
                this.logger.warn(`playlists: ${provider.record.id} could not read a pasted link (${errorText(error)})`);
            }
        }
        return undefined;
    }

    /**
     * A provider's playlist as entries, each carrying the copy it was read from so the planner can
     * match it by binding and a placeholder can be filled from exactly that copy.
     *
     * The name is the provider's rather than the playlist's, because the catalog contract has no
     * call that answers one playlist's name; the preview offers it for the operator to change.
     */
    private async fromProvider(pluginId: string, playlistId: string): Promise<PlaylistImportEntrySource> {
        const { tracks } = await this.providerPlaylists.getPlaylistTracks(pluginId, playlistId);
        const provider = this.registry.get(pluginId)?.manifest?.name ?? pluginId;

        return {
            name: `From ${provider}`,
            prompt: '',
            entries: tracks.map(track => ({
                title: track.title,
                artists: track.artists,
                ...(track.album === undefined ? {} : { album: track.album }),
                ...(track.durationMs === undefined ? {} : { durationMs: track.durationMs }),
                ...(track.isrc === undefined ? {} : { isrc: track.isrc }),
                origin: { pluginId, externalId: track.id },
            })),
            skipped: 0,
            notices: [],
            originPluginId: pluginId,
        };
    }
}
