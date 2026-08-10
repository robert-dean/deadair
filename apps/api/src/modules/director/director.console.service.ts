import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { JobBroker } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import { PlaylistsService } from '#modules/playlists/playlists.service.js';
import type { CatalogTrack } from '#modules/playlists/types/playlists.types.js';
import { AIR_MODE_KEY } from '#modules/playout/air.mode.js';
import type { RundownTrack } from '#modules/playout/rundown.js';
import { SegmentRepository, type Segment } from '#modules/render/segment.repository.js';
import { SettingsService } from '#modules/settings/settings.service.js';
import type { OrderEdit } from './director.mailbox.js';
import { DirectorService } from './director.service.js';
import type { EditResult, Lineup as LoadedLineup, LineupSegmentItem } from './lineup.js';
import { LineupRepository } from './lineup.repository.js';
import { StationAirRepository } from './station.air.repository.js';
import type { StationLineupBinding, StationLineupSegmentItem, StationLineupSnapshot } from './station.lineup.js';
import type {
    AddLineupSegmentInput,
    AddStationSegmentInput,
    EditLineupInput,
    ExtendLineupInput,
    ExtendStationInput,
    ImportLineupInput,
    Lineup,
    LineupItem as LineupItemView,
    LineupList,
    MoveLineupItemInput,
    MoveStationItemInput,
    PutOnAirInput,
    SetStationAirInput,
    StationAir,
    StationOrder,
    StationOrderItem,
} from './types/director.types.js';

/**
 * The operator's side of the director: everything a request does to the
 * station's programming.
 *
 * Scoped. The reactor is a singleton with no actor and no request scope; this is
 * where a person's decisions arrive, which is why the permission narrowing and the
 * plugin reads live here.
 *
 * **It does not write the running order, and nothing on the request path does.**
 * Every change to what is on air is a command posted to the director, which owns
 * it. That call is in-process and cheap — they are the same object graph — and the
 * caller waits for its own change to have happened rather than being told it will
 * happen shortly.
 */
@Injectable()
export class DirectorConsoleService {
    constructor(
        private readonly lineups: LineupRepository,
        private readonly air: StationAirRepository,
        private readonly director: DirectorService,
        private readonly playlists: PlaylistsService,
        private readonly tracks: TracksRepository,
        // Read-only from here. A lineup names a segment and the library owns it, so the console's
        // programming surface never writes one; that is the render module's business.
        private readonly segments: SegmentRepository,
        private readonly settings: SettingsService,
        // Scoped, so a send commits with the request's own transaction rather than
        // ahead of it. See JobsModule for why the request path takes this one.
        private readonly jobs: JobBroker,
        private readonly logger: Logger,
    ) {}

    /** Every lineup the station holds, without their orders. */
    async listLineups(): Promise<LineupList> {
        return { lineups: await this.lineups.list() };
    }

    /** One lineup and its whole order. */
    async getLineup(lineupId: string): Promise<Lineup> {
        return await this.toLineup(await this.load(lineupId));
    }

    /**
     * Put a segment into a lineup at a position.
     *
     * The operator's way of saying "play the ident here". Later the station plants
     * its own, and this stays as the manual override rather than being replaced by
     * it.
     *
     * @throws 404 when the segment does not exist, and 422 when it has no audio.
     *   Refused at the door rather than planted and skipped at the boundary: an
     *   operator who asks for a specific ident should be told it cannot play, not
     *   watch the lineup accept it and the station quietly pass over it.
     */
    async addSegment(lineupId: string, input: AddLineupSegmentInput): Promise<Lineup> {
        const lineup = await this.load(lineupId);

        const segment = await this.segments.findById(input.segmentId);
        if (segment === undefined) throw httpError(404).withDetails({ message: 'no such segment' });
        if (segment.state !== 'ready') {
            throw httpError(422).withDetails({ message: `that segment is ${segment.state} and has no audio to play yet` });
        }

        this.require(
            await lineup.insertSegment(
                segment.id,
                input.atIndex ?? lineup.size(),
                input.revision,
                input.overAtMs === undefined ? undefined : { atMs: input.overAtMs },
            ),
        );

        this.logger.info('director: put a segment into a lineup', {
            lineup: lineup.id,
            segment: segment.id,
            at: input.atIndex,
            over: input.overAtMs,
        });
        return await this.toLineup(lineup);
    }

    /**
     * One lineup as the object that can be edited, with the cursor it is being
     * aired at when it is the one on air.
     *
     * Anything not on air reads at zero, which is honest rather than a default:
     * nothing has been committed from it, so nothing in it is beyond editing.
     */
    private async load(lineupId: string): Promise<LoadedLineup> {
        // Always at zero. Nothing airs from a stored lineup any more, so nothing has been
        // committed from one and the whole of it is editable.
        const lineup = await this.lineups.load(lineupId, 0);
        if (!lineup) throw httpError(404).withDetails({ message: 'no such lineup' });
        return lineup;
    }

    /**
     * What is on air right now.
     *
     * Answered entirely from the director, which is where the running order lives.
     * No query at all, and no chance of the console being shown a row the reactor has
     * not acted on: those were the same thing and both were bugs.
     */
    async getAir(): Promise<StationAir> {
        const status = this.director.status();
        return {
            active: status.active,
            airMode: status.airMode,
            ...(status.name === undefined ? {} : { name: status.name }),
            ...(status.source === undefined ? {} : { source: status.source }),
            remaining: status.remaining,
        };
    }

    /**
     * The live running order, item by item.
     *
     * A segment is filled in from `deadair.segments` rather than from anything stored
     * in the order, which is why this has a query in it. The order holds an id and the
     * library holds the truth, so an operator renaming a segment sees the new name
     * against what is on air, and one that has lost its audio is drawn as something the
     * station will skip instead of as an item that looks fine.
     */
    async getOrder(): Promise<StationOrder> {
        const order = this.director.order();
        if (!order) {
            // Nothing on air is an ordinary state, not a 404: the console draws an empty
            // running order and the operator puts something on.
            return { name: '', mode: 'rotation', onEnd: 'extend', source: 'director', items: [] };
        }
        return await this.toOrder(order);
    }

    /**
     * Change what puts the station on air.
     *
     * Stored rather than held, so a restart comes back on the same terms the
     * operator chose. Nothing has to be told: the mode is a setting, the settings
     * table is a layer of the app's config, and `PlayoutPusher` asks
     * `AudienceWatch.gateOpen()` on every reconcile — so the change is acted on
     * within a tick rather than at the end of somebody's cache.
     *
     * The answer carries the mode that was just WRITTEN rather than the one the
     * config currently reports, and the difference is real for exactly the length
     * of this request. The config refreshes after the transaction commits (see
     * `SettingsService.set`), which is necessarily after this method has built its
     * return value, so reading it back here would answer with the mode the
     * operator has just replaced and leave the console showing the old one.
     */
    async setAirMode(input: SetStationAirInput): Promise<StationAir> {
        await this.settings.set(AIR_MODE_KEY, input.airMode);

        this.logger.info('director: changed what puts the station on air', { airMode: input.airMode });
        return { ...(await this.getAir()), airMode: input.airMode };
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
        return await this.toLineup(lineup);
    }

    /**
     * Put the station on air, building the running order from a playlist.
     *
     * What is playing finishes: changing the programming is not a reason to cut a
     * listener off mid-track. What was committed behind it is retracted, because it
     * belongs to a programme the station is no longer airing.
     *
     * **The playlist is READ, not copied.** That is the whole difference stage 2
     * makes, and it closes two things at once: an imported list went stale the moment
     * it was imported and was never re-read, and the break planner wrote the station's
     * own idents into it, so an operator's playlist was permanently altered by having
     * been aired. Neither is expressible now.
     *
     * A source is optional. Naming none starts the station with an empty order and
     * lets the generator fill it, which is what a rotation with no playlist behind it
     * is.
     *
     * @throws 422 when the playlist has nothing to play.
     */
    async putOnAir(input: PutOnAirInput): Promise<StationAir> {
        const tracks = await this.sourceTracks(input);

        const binding: StationLineupBinding = {
            name: input.name ?? (input.pluginId === undefined ? 'The station' : `From ${input.pluginId}`),
            mode: input.mode ?? 'rotation',
            onEnd: input.onEnd ?? 'extend',
            source: input.pluginId === undefined ? 'director' : 'import',
            ...(input.pluginId === undefined ? {} : { sourcePluginId: input.pluginId }),
            ...(input.playlistId === undefined ? {} : { sourcePlaylistId: input.playlistId }),
        };

        // Synchronously, then the command: a commit pass may already be gathering against the
        // programme coming off, and only the epoch can reach it. See {@link announceAirChange}.
        this.director.invalidate();
        await this.director.post({ kind: 'putOnAir', binding, tracks });

        this.logger.info('director: put the station on air', {
            plugin: input.pluginId,
            playlist: input.playlistId,
            tracks: tracks.length,
        });
        return await this.getAir();
    }

    /**
     * The records a broadcast starts from.
     *
     * Read through {@link PlaylistsService} rather than by calling the plugin directly,
     * so the same narrowing applies as when the console lists them: an actor who cannot
     * see the plugin gets the same 403 whether or not it is installed, and a plugin that
     * is not catalog-capable answers 501 rather than failing halfway through.
     */
    private async sourceTracks(input: PutOnAirInput): Promise<RundownTrack[]> {
        if (input.pluginId === undefined || input.playlistId === undefined) return [];

        const { tracks } = await this.playlists.getPlaylistTracks(input.pluginId, input.playlistId);
        if (tracks.length === 0) {
            // A running order that plays nothing would report success and then air silence.
            throw httpError(422).withDetails({ message: 'that playlist has no tracks to play' });
        }
        return await this.toRundownTracks(input.pluginId, tracks);
    }

    /**
     * Add tracks to a lineup now, rather than waiting for it to run short.
     *
     * Returns as soon as the work is queued. Generating a set walks the catalog
     * and, later, rate-limited providers, and an operator pressing a button should
     * not be holding a connection open through it — the lineup grows a few seconds
     * later and the console's next read shows it.
     */
    async extendLineup(lineupId: string, input: ExtendLineupInput): Promise<void> {
        await this.load(lineupId);
        await this.jobs.send('director.extend_lineup', { lineupId, ...(input.count === undefined ? {} : { count: input.count }) });
    }

    // ── the live running order ─────────────────────────────────────────────────
    //
    // Every one of these posts a command and none of them writes the order, which is the
    // rule the whole decision rests on. They read as thin because they are: the work is
    // the director's, and what is left here is turning a refusal into a status code.

    /** Add tracks to what is on air now, rather than waiting for it to run short. */
    async extendOrder(input: ExtendStationInput): Promise<void> {
        await this.jobs.send('director.extend_lineup', { ...(input.count === undefined ? {} : { count: input.count }) });
    }

    /** Shuffle everything on air that has not been handed to the player. */
    async shuffleOrder(): Promise<StationOrder> {
        return await this.editOrder({ kind: 'shuffle' });
    }

    /** Move an item within the running order. */
    async moveOrderItem(itemId: string, input: MoveStationItemInput): Promise<StationOrder> {
        return await this.editOrder({ kind: 'move', itemId, toIndex: input.toIndex });
    }

    /** Drop an item that has not been handed to the player yet. */
    async removeOrderItem(itemId: string): Promise<StationOrder> {
        return await this.editOrder({ kind: 'remove', itemId });
    }

    /**
     * Put a segment into the running order at a position.
     *
     * @throws 404 when the segment does not exist, and 422 when it has no audio.
     *   Refused at the door rather than planted and skipped when it comes round: an
     *   operator who asks for a specific ident should be told it cannot play, not
     *   watch the order accept it and the station quietly pass over it.
     */
    async addSegmentToOrder(input: AddStationSegmentInput): Promise<StationOrder> {
        const segment = await this.segments.findById(input.segmentId);
        if (segment === undefined) throw httpError(404).withDetails({ message: 'no such segment' });
        if (segment.state !== 'ready') {
            throw httpError(422).withDetails({ message: `that segment is ${segment.state} and has no audio to play yet` });
        }

        return await this.editOrder({
            kind: 'insertSegment',
            segmentId: segment.id,
            ...(input.atIndex === undefined ? {} : { atIndex: input.atIndex }),
            ...(input.overAtMs === undefined ? {} : { overAtMs: input.overAtMs }),
        });
    }

    /**
     * Hand one edit to the director and answer with the order it produced.
     *
     * Cancel-then-post, like {@link putOnAir}, because an edit changes what the pass
     * currently gathering was going to commit. The order is read back from the director
     * rather than rebuilt here, because the director is the only thing that has it.
     */
    private async editOrder(edit: OrderEdit): Promise<StationOrder> {
        this.director.invalidate();
        this.require(await this.director.applyEdit(edit));
        return await this.getOrder();
    }

    /** Shuffle everything in a lineup that has not been committed yet. */
    async shuffleLineup(lineupId: string, input: EditLineupInput): Promise<Lineup> {
        const lineup = await this.load(lineupId);
        this.require(await lineup.shuffleRemaining(input.revision));
        return await this.toLineup(lineup);
    }

    /** Move a line within a lineup. */
    async moveItem(lineupId: string, itemId: string, input: MoveLineupItemInput): Promise<Lineup> {
        const lineup = await this.load(lineupId);
        this.require(await lineup.move(itemId, input.toIndex, input.revision));
        return await this.toLineup(lineup);
    }

    /** Drop a line that has not been committed yet. */
    async removeItem(lineupId: string, itemId: string, input: EditLineupInput): Promise<Lineup> {
        const lineup = await this.load(lineupId);
        this.require(await lineup.remove(itemId, input.revision));
        return await this.toLineup(lineup);
    }

    /**
     * Delete a lineup outright.
     *
     * Nothing can be on air from one any more, so there is no 409 left to answer: the
     * running order is the director's own and a stored lineup is prepared material that
     * nothing is playing from.
     */
    async deleteLineup(lineupId: string): Promise<void> {
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

    /**
     * The running order as the console reads it.
     *
     * One query for the whole order, not one per item.
     */
    private async toOrder(order: StationLineupSnapshot): Promise<StationOrder> {
        const segments = await this.segments.findByIds(order.items.flatMap(item => (item.kind === 'segment' ? [item.segmentId] : [])));

        return {
            name: order.name,
            mode: order.mode,
            onEnd: order.onEnd,
            source: order.source,
            ...(order.sourcePluginId === undefined ? {} : { sourcePluginId: order.sourcePluginId }),
            ...(order.sourcePlaylistId === undefined ? {} : { sourcePlaylistId: order.sourcePlaylistId }),
            items: order.items.map(item => {
                if (item.kind === 'segment') return toOrderSegment(item, segments.get(item.segmentId));

                return {
                    id: item.id,
                    kind: 'track' as const,
                    state: item.state,
                    pluginId: item.track.pluginId,
                    externalId: item.track.externalId,
                    title: item.track.title,
                    artists: item.track.artists,
                    ...(item.track.durationMs === undefined ? {} : { durationMs: item.track.durationMs }),
                    ...(item.track.album === undefined ? {} : { album: item.track.album }),
                    ...(item.track.artworkUrl === undefined ? {} : { artworkUrl: item.track.artworkUrl }),
                    ...(item.track.year === undefined ? {} : { year: item.track.year }),
                    ...(item.track.trackId === undefined ? {} : { trackId: item.track.trackId }),
                };
            }),
        };
    }

    /**
     * A loaded lineup as the console reads it.
     *
     * `committed` is the whole point of drawing the cursor: everything at or before
     * it has been handed to the player and can no longer be moved or removed, and a
     * console that did not say so would offer controls that answer 422.
     *
     * A segment line is filled in from `deadair.segments` rather than from anything
     * stored in the order, which is why this is a method with a query in it rather
     * than the pure function it used to be. The lineup holds an id and the library
     * holds the truth, so an operator renaming a segment sees the new name against
     * every lineup that plays it, and a segment that has lost its audio is drawn as
     * one the station will skip instead of as a line that looks fine.
     *
     * One query for the whole order, not one per line.
     */
    private async toLineup(lineup: LoadedLineup): Promise<Lineup> {
        const cursor = lineup.cursor();
        const segments = await this.segments.findByIds(lineup.all().flatMap(item => (item.kind === 'segment' ? [item.segmentId] : [])));

        return {
            id: lineup.id,
            name: lineup.name,
            mode: lineup.mode,
            onEnd: lineup.onEnd,
            source: lineup.source,
            revision: lineup.revision(),
            cursor,
            items: lineup.all().map((item, index) => {
                const committed = index < cursor;
                if (item.kind === 'segment') return toSegmentLine(item, segments.get(item.segmentId), committed);

                return {
                    id: item.id,
                    kind: 'track' as const,
                    pluginId: item.track.pluginId,
                    externalId: item.track.externalId,
                    title: item.track.title,
                    artists: item.track.artists,
                    ...(item.track.durationMs === undefined ? {} : { durationMs: item.track.durationMs }),
                    ...(item.track.album === undefined ? {} : { album: item.track.album }),
                    ...(item.track.artworkUrl === undefined ? {} : { artworkUrl: item.track.artworkUrl }),
                    ...(item.track.year === undefined ? {} : { year: item.track.year }),
                    ...(item.track.trackId === undefined ? {} : { trackId: item.track.trackId }),
                    committed,
                };
            }),
        };
    }
}

/**
 * A segment of the running order, as drawn from the library row it points at.
 *
 * One whose segment is gone still draws, as itself: the order does hold it, the station
 * will pass over it, and hiding it would leave an operator wondering why what they can
 * see does not match what they hear.
 */
const toOrderSegment = (item: StationLineupSegmentItem, segment: Segment | undefined): StationOrderItem => ({
    id: item.id,
    kind: 'segment' as const,
    state: item.state,
    segmentId: item.segmentId,
    title: segment?.label ?? 'a segment the library no longer holds',
    // Empty, and not the station's name. A segment has no artist, and inventing one would put it
    // in front of a listener as though it were a record by somebody.
    artists: [],
    segmentState: segment?.state ?? 'gone',
    playable: segment?.state === 'ready',
    // The reason, where the operator is already looking. Without it a break that could not be
    // written and a DJ that simply talks less are the same observation, and the difference is a
    // sentence the row has been carrying all along.
    ...(segment?.error === undefined ? {} : { segmentError: segment.error }),
    ...(segment?.writer === undefined ? {} : { segmentWriter: segment.writer }),
    ...(item.over === undefined ? {} : { overAtMs: item.over.atMs }),
    ...(segment?.durationMs === undefined ? {} : { durationMs: segment.durationMs }),
});

/**
 * A segment line, as drawn from the library row the order points at.
 *
 * A line whose segment is gone still draws, as itself: the lineup does hold it,
 * the station will pass over it, and hiding it would leave an operator wondering
 * why the order they can see does not match the one they hear. `playable` is the
 * one thing a console has to know, and it is the same question the director asks.
 */
const toSegmentLine = (item: LineupSegmentItem, segment: Segment | undefined, committed: boolean): LineupItemView => ({
    id: item.id,
    kind: 'segment' as const,
    segmentId: item.segmentId,
    title: segment?.label ?? 'a segment the library no longer holds',
    // Empty, and not the station's name. A segment has no artist, and inventing one would put it
    // in front of a listener as though it were a record by somebody.
    artists: [],
    segmentState: segment?.state ?? 'gone',
    playable: segment?.state === 'ready',
    // The reason, where the operator is already looking. Without it a break that could not be
    // written and a DJ that simply talks less are the same observation, and the difference is a
    // sentence the row has been carrying all along.
    ...(segment?.error === undefined ? {} : { segmentError: segment.error }),
    ...(segment?.writer === undefined ? {} : { segmentWriter: segment.writer }),
    ...(item.over === undefined ? {} : { overAtMs: item.over.atMs }),
    ...(segment?.durationMs === undefined ? {} : { durationMs: segment.durationMs }),
    committed,
});
