import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { JobBroker } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import { PlaylistsService } from '#modules/playlists/playlists.service.js';
import type { CatalogTrack } from '#modules/playlists/types/playlists.types.js';
import { Rundown, type RundownTrack } from '#modules/playout/rundown.js';
import { DirectorService } from './director.service.js';
import type { EditResult, Lineup, LineupMode, LineupOnEnd } from './lineup.js';
import { LineupRepository, type LineupSummary } from './lineup.repository.js';
import { StationAirRepository } from './station.air.repository.js';

/** What importing a provider playlist into a lineup needs. */
export interface ImportLineupInput {
    pluginId: string;
    playlistId: string;
    /** What to call it. Absent takes the provider's own name for the playlist. */
    name?: string;
    mode?: LineupMode;
    onEnd?: LineupOnEnd;
}

/** What is on air, for a console. */
export interface AirStatus {
    active: boolean;
    lineupId?: string;
    lineupName?: string;
    cursor: number;
    remaining: number;
}

/**
 * The operator's side of the director: everything a request does to the
 * station's programming.
 *
 * Scoped, and deliberately the only writer of lineups on the request path. The
 * reactor is a singleton with no actor and no request scope; this is where a
 * person's decisions arrive, which is why the permission narrowing and the
 * plugin reads live here.
 *
 * Every change to what is on air ends by telling the reactor, so an operator's
 * action takes effect at once rather than at the next boundary. That call is
 * in-process and cheap: they are the same object graph.
 */
@Injectable()
export class DirectorConsoleService {
    constructor(
        private readonly lineups: LineupRepository,
        private readonly air: StationAirRepository,
        private readonly director: DirectorService,
        private readonly playlists: PlaylistsService,
        private readonly tracks: TracksRepository,
        private readonly rundown: Rundown,
        // Scoped, so a send commits with the request's own transaction rather than
        // ahead of it. See JobsModule for why the request path takes this one.
        private readonly jobs: JobBroker,
        private readonly logger: Logger,
    ) {}

    /** Every lineup the station holds. */
    async list(): Promise<LineupSummary[]> {
        return this.lineups.list();
    }

    /** One lineup, with the cursor it is being aired at when it is the one on air. */
    async get(lineupId: string): Promise<Lineup> {
        const status = this.director.status();
        const cursor = status.lineupId === lineupId ? status.cursor : 0;

        const lineup = await this.lineups.load(lineupId, cursor);
        if (!lineup) throw httpError(404).withDetails({ message: 'no such lineup' });
        return lineup;
    }

    /** What is on air right now. */
    async status(): Promise<AirStatus> {
        const status = this.director.status();
        if (!status.lineupId) return { active: status.active, cursor: 0, remaining: 0 };

        const summaries = await this.lineups.list();
        const named = summaries.find(summary => summary.id === status.lineupId);
        return {
            active: status.active,
            lineupId: status.lineupId,
            ...(named === undefined ? {} : { lineupName: named.name }),
            cursor: status.cursor,
            remaining: status.remaining,
        };
    }

    /**
     * Build a lineup from a provider playlist.
     *
     * Reads through {@link PlaylistsService} rather than calling the plugin
     * directly, so the same narrowing applies as when the console lists them: an
     * actor who cannot see the plugin gets the same 403 whether or not it is
     * installed, and a plugin that is not catalog-capable answers 501 rather than
     * failing halfway through an import.
     *
     * @throws 422 when the playlist has no tracks. A lineup that plays nothing
     *   would report success and then air silence.
     */
    async importPlaylist(input: ImportLineupInput): Promise<Lineup> {
        const { tracks } = await this.playlists.getPlaylistTracks(input.pluginId, input.playlistId);
        if (tracks.length === 0) {
            throw httpError(422).withDetails({ message: 'that playlist has no tracks to play' });
        }

        const lineup = await this.lineups.create({
            // The caller names it: the only surface that knows a provider playlist's
            // own name is the one that listed it, and re-reading every plugin's
            // playlists here to find one string would be a fan-out per import.
            name: input.name ?? `Imported from ${input.pluginId}`,
            source: 'import',
            sourcePluginId: input.pluginId,
            sourcePlaylistId: input.playlistId,
            ...(input.mode === undefined ? {} : { mode: input.mode }),
            ...(input.onEnd === undefined ? {} : { onEnd: input.onEnd }),
            tracks: await this.toRundownTracks(input.pluginId, tracks),
        });

        this.logger.info('director: imported a playlist into a lineup', {
            plugin: input.pluginId,
            playlist: input.playlistId,
            lineup: lineup.id,
            tracks: lineup.size(),
        });
        return lineup;
    }

    /**
     * Put a lineup on air, from the top.
     *
     * What is playing finishes: changing the programming is not a reason to cut a
     * listener off mid-track. The running order behind it is retracted, because
     * it belongs to a lineup the station is no longer airing.
     *
     * @param interrupting - Whether to remember what this displaced, so a lineup
     *   ending with `on_end: 'resume'` can hand the station back. What an album
     *   feature wants; not what an operator changing programming wants.
     */
    async putOnAir(lineupId: string, interrupting = false): Promise<AirStatus> {
        const lineup = await this.get(lineupId);

        const current = interrupting ? this.director.status() : undefined;
        await this.air.putOnAir(
            lineup.id,
            current?.lineupId ? { lineupId: current.lineupId, cursor: current.cursor } : undefined,
        );

        // Retract what the player is holding from the previous lineup. What is ON AIR
        // is left alone by `load`; only the uncommitted tail goes.
        this.rundown.load([]);
        await this.director.reload();

        this.logger.info('director: put a lineup on air', { lineup: lineup.id, interrupting });
        return this.status();
    }

    /**
     * Add tracks to a lineup now, rather than waiting for it to run short.
     *
     * Returns as soon as the work is queued. Generating a set walks the catalog
     * and, later, rate-limited providers, and an operator pressing a button should
     * not be holding a connection open through it — the lineup grows a few seconds
     * later and the console's next read shows it.
     */
    async extend(lineupId: string, count?: number): Promise<void> {
        await this.get(lineupId);
        await this.jobs.send('director.extend_lineup', { lineupId, ...(count === undefined ? {} : { count }) });
    }

    /** Shuffle everything in a lineup that has not been committed yet. */
    async shuffle(lineupId: string, revision?: number): Promise<Lineup> {
        const lineup = await this.get(lineupId);
        this.require(await lineup.shuffleRemaining(revision));
        await this.director.reload();
        return lineup;
    }

    /** Move a line within a lineup. */
    async move(lineupId: string, itemId: string, toIndex: number, revision?: number): Promise<Lineup> {
        const lineup = await this.get(lineupId);
        this.require(await lineup.move(itemId, toIndex, revision));
        return lineup;
    }

    /** Drop a line that has not been committed yet. */
    async removeItem(lineupId: string, itemId: string, revision?: number): Promise<Lineup> {
        const lineup = await this.get(lineupId);
        this.require(await lineup.remove(itemId, revision));
        return lineup;
    }

    /**
     * Delete a lineup outright.
     *
     * @throws 409 while it is on air. Deleting what a listener is hearing is
     *   almost never what someone means, and standing the station down is a
     *   separate decision they can make explicitly first.
     */
    async remove(lineupId: string): Promise<void> {
        if (this.director.status().lineupId === lineupId) {
            throw httpError(409).withDetails({ message: 'that lineup is on air; stop the station or put another one on first' });
        }

        await this.lineups.remove(lineupId);
        await this.air.forgetLineup(lineupId);
    }

    /** Turn an edit refusal into the status code that says the same thing. */
    private require(result: EditResult): void {
        if (result.ok) return;

        const status = result.reason === 'not-found' ? 404 : result.reason === 'stale-revision' ? 409 : 422;
        throw httpError(status).withDetails({ message: result.message });
    }

    /**
     * One provider's playlist as lineup tracks, with whatever the catalog can add.
     *
     * The provider stays authoritative for the copy that will play — title,
     * artists, duration — while the catalog answers for the work: its canonical
     * id, its year, and a cover the station may already have cached. Cover art
     * prefers the catalog's, which has resolved to the local copy where there is
     * one rather than hotlinking a provider CDN on every poll.
     *
     * Never fails the import. Metadata is decoration and airing is the job, so a
     * catalog read that throws costs the covers and nothing else.
     */
    private async toRundownTracks(pluginId: string, tracks: readonly CatalogTrack[]): Promise<RundownTrack[]> {
        const known = await this.catalogMetadata(pluginId, tracks);

        return tracks.map(track => {
            const row = known.get(track.id);
            const album = track.album ?? row?.albumName ?? undefined;
            const artworkUrl = row?.albumImageUrl ?? track.artworkUrl;
            return {
                pluginId,
                externalId: track.id,
                title: track.title,
                artists: track.artists,
                ...(track.durationMs === undefined ? {} : { durationMs: track.durationMs }),
                ...(album === undefined ? {} : { album }),
                ...(artworkUrl == null ? {} : { artworkUrl }),
                ...(row?.year == null ? {} : { year: row.year }),
                ...(row?.trackId === undefined ? {} : { trackId: row.trackId }),
            };
        });
    }

    /** The catalog's rows for these bindings, by provider id. Empty when it cannot answer. */
    private async catalogMetadata(pluginId: string, tracks: readonly CatalogTrack[]) {
        try {
            const rows = await this.tracks.findByBindings(
                pluginId,
                tracks.map(track => track.id),
            );
            return new Map(rows.map(row => [row.externalId, row]));
        } catch (error) {
            this.logger.warn('director: could not read catalog metadata for an import; taking the playlist as it came', {
                plugin: pluginId,
                error: error instanceof Error ? error.message : String(error),
            });
            return new Map();
        }
    }
}
