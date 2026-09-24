import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { entriesOfFile } from './playlist.file.js';
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
        private readonly logger: Logger,
    ) {}

    /** What this source would become here. Writes nothing. */
    async preview(input: PlaylistImportInput): Promise<PlaylistImportPlan> {
        const { plan } = await this.planner.plan(this.sourceOf(input), input.name);
        return plan;
    }

    /**
     * Makes a new station playlist from a source.
     *
     * All or nothing, because the request runs in one transaction: the preview is what an operator
     * agreed to, and a playlist that landed half way is the one outcome nothing described.
     */
    async import(input: PlaylistImportInput): Promise<PlaylistImportResult> {
        const source = this.sourceOf(input);
        const { plan, rows } = await this.planner.plan(source, input.name);

        const id = await this.playlists.create(
            { name: plan.name, prompt: source.prompt, ...(source.originPluginId === undefined ? {} : { originPluginId: source.originPluginId }) },
            rows,
        );
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
     * @throws 400 when it names none. The schema cannot say "exactly one of", so this does.
     */
    private sourceOf(input: PlaylistImportInput): PlaylistImportEntrySource {
        if (input.file !== undefined) return entriesOfFile(input.file);
        throw httpError(400).withDetails({ message: 'say what to import: a playlist file' });
    }
}
