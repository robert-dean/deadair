import { Injectable } from 'injectkit';
import type { ChartEntry } from '@deadair/plugin-sdk';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { JobBroker } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import { ChartsService, MAX_CHART_ENTRIES } from '#modules/charts/charts.service.js';
import { splitChartId } from '#modules/charts/chart.ids.js';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { PlaylistsService } from '#modules/playlists/playlists.service.js';
import type { CatalogTrack } from '#modules/playlists/types/playlists.types.js';
import { AIR_MODE_KEY } from '#modules/playout/air.mode.js';
import type { RundownTrack } from '#modules/playout/rundown.js';
import { PersonaRepository } from '#modules/personas/persona.repository.js';
import { TrackAudioService } from '#modules/playout/audio/track.audio.service.js';
import { SegmentRepository, type Segment } from '#modules/render/segment.repository.js';
import type { ScheduleSlot } from './schedule.js';
import { ScheduleService } from '#modules/schedule/schedule.service.js';
import { SettingsService } from '#modules/settings/settings.service.js';
import type { OrderEdit } from './director.mailbox.js';
import { DirectorService } from './director.service.js';
import { bindsAnything, CandidatesRepository, type EraWindow } from './candidates.repository.js';
import { chartPicks, DEFAULT_CHART_ORDER } from './chart.picks.js';
import { DISCOVER_DEFAULT, DISCOVER_KEY, PickResolver } from './pick.resolver.js';
import { songKey } from './rotation.keys.js';
import { NO_RULES, stationAutoExtends } from './rotation.rules.js';
import { StationAirRepository } from './station.air.repository.js';
import type { EditResult, StationLineupBinding, StationLineupSegmentItem, StationLineupSnapshot } from './station.lineup.js';
import type {
    AirSource,
    AddStationSegmentInput,
    AddStationTrackInput,
    HoldStationInput,
    ExtendStationInput,
    MoveStationItemInput,
    PutOnAirInput,
    ReplanStationInput,
    SetStationAirInput,
    SetStationHostInput,
    StationAir,
    StationMode,
    StationOnEnd,
    StationOrder,
    StationOrderItem,
} from './types/director.types.js';
import { errorText } from '#modules/shared/error.text.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';

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
        private readonly air: StationAirRepository,
        private readonly director: DirectorService,
        private readonly playlists: PlaylistsService,
        // Read-only, and beside the playlists for the same reason: a chart is the other thing a
        // broadcast can be built from, and it is read through the service rather than the plugin so
        // the same narrowing applies as when the console lists one.
        private readonly charts: ChartsService,
        private readonly tracks: TracksRepository,
        // Read-only from here. A lineup names a segment and the library owns it, so the console's
        // programming surface never writes one; that is the render module's business.
        private readonly segments: SegmentRepository,
        // Read-only too, and for the same reason: a running order names its host and the personas
        // page owns it.
        private readonly personas: PersonaRepository,
        // Read-only, and for a third instance of the same reason: a broadcast records which slot of
        // the day it belongs to, and the schedule page owns the slots. Resolved at request time, so
        // ScheduleModule sitting above this one in `modules.ts` is a dependency order rather than a
        // resolution one.
        private readonly schedule: ScheduleService,
        private readonly settings: SettingsService,
        // For one question only: what a new broadcast's `onEnd` should be when the operator did not
        // say. See {@link stationAutoExtends}, and note the settings table is a layer of this, so
        // this reads what the operator has stored rather than only what the process booted with.
        private readonly config: AppConfig,
        // Scoped, so a send commits with the request's own transaction rather than
        // ahead of it. See JobsModule for why the request path takes this one.
        private readonly jobs: JobBroker,
        // Who is asking. This is the one surface where the station's own decisions and a person's
        // are told apart, which is what `station_events.actor_id` is for.
        private readonly context: AuthorizationContext,
        private readonly activity: ActivityRecorder,
        private readonly logger: Logger,
        // The put-on-air veto: the one instruction no lineup may switch off, applied to a playlist
        // the same way `resolve` applies it to a generated set. See `sourceTracks`.
        private readonly resolver: PickResolver,
        // The two halves of turning a bare catalog id into something the running order can hold: a
        // playable binding (`addTrackToOrder`) and whether its audio is actually here yet.
        private readonly candidates: CandidatesRepository,
        private readonly trackAudio: TrackAudioService,
    ) {}

    /**
     * The actor to stamp on an event, when there is one.
     *
     * A user id or nothing. Every route here is behind `platform.manage`, so in practice there is
     * always a user; the `undefined` arm is for a system actor reaching the same method, which is
     * how a job would look if one ever called it.
     */
    private actor(): string | undefined {
        return this.context.actor.kind === 'user' ? this.context.actor.actorId : undefined;
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
        const hold = this.director.holdUntil();
        return {
            active: status.active,
            airMode: status.airMode,
            ...(status.name === undefined ? {} : { name: status.name }),
            ...(status.source === undefined ? {} : { source: status.source }),
            ...(status.slotId === undefined ? {} : { slotId: status.slotId }),
            airSource: airSourceOf(status),
            // Two fields because `Infinity` is not JSON. `held` is the fact a console acts on and
            // `holdUntil` is when it lapses; absent while held is the hold that never does.
            held: hold !== undefined && hold > Date.now(),
            ...(hold === undefined || hold === Infinity ? {} : { holdUntil: new Date(hold).toISOString() }),
            remaining: status.remaining,
        };
    }

    /**
     * When the director last found a running order it could not commit anything from for want of
     * the audio, or `undefined` when that is not what is happening.
     *
     * A passthrough, and it earns its line here for the reason {@link getAir} does: the reactor is
     * the only thing that knows, and the silence diagnosis is the only thing that asks. Without it
     * that diagnosis cannot tell a running order that RAN OUT from one whose records are still
     * being fetched, and it reported the first for both.
     */
    audioWaitSince(): number | undefined {
        return this.director.audioWaitSince();
    }

    /**
     * How many records in front of the station have their bytes on the way.
     *
     * The passthrough beside {@link audioWaitSince}, for the same reason and read on the same poll.
     * It is what splits that one wait in two: a station downloading its first records is working and
     * wants no operator, and the same wait with nothing in flight is a station that has stopped
     * making progress.
     */
    warmingRecords(): number {
        return this.director.warmingRecords();
    }

    /**
     * Whether what the player is holding is a holding message and nothing else.
     *
     * The third passthrough on this poll, and the one that keeps the other two honest: a warm-up
     * segment on its way to the mount is programme as far as the transport can tell, so without this
     * the station reports itself as airing its show while it loops "give us a moment".
     */
    holdingWarmUp(): boolean {
        return this.director.holdingWarmUp();
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
        void this.activity.record({
            module: 'director',
            kind: 'airMode.set',
            detail:
                input.airMode === 'audience'
                    ? 'The station was set to air only while somebody is listening.'
                    : 'The station was set to air whether or not anybody is listening.',
            data: { airMode: input.airMode },
            ...(this.actor() === undefined ? {} : { actorId: this.actor() as string }),
        });
        return { ...(await this.getAir()), airMode: input.airMode };
    }

    /**
     * Put the station back on air with the running order it already has.
     *
     * Deliberately thin, and deliberately NOT beside {@link putOnAir}'s cancel-then-post: there is
     * no programme coming off to cancel. A resume happens when the station is stopped, so nothing is
     * in flight for an epoch bump to reach.
     */
    async resumeAir(): Promise<{ resumed: boolean }> {
        const result = await this.director.resumeAir();
        if (result.resumed) this.logger.info('director: an operator started the station again');

        return result;
    }

    /**
     * Keep the schedule off the running order for a while, or until somebody says otherwise.
     *
     * ## What this fixes, which is a silence rather than a bug
     *
     * A manual `putOnAir` is stamped with whichever slot is in force, so a takeover HOLDS until that
     * block ends and is then replaced. That is the right behaviour and it is invisible: an operator
     * who briefs the station at half past two gets no warning that three o'clock will take it back.
     * The stamp cannot also carry a duration, because its whole job is to expire at the boundary.
     *
     * So the duration is a thing the operator says. Absent `minutes` is `Infinity` — until released —
     * which is the honest answer for somebody who does not know yet, and the contract caps a stated
     * one at a day because a hold nobody remembers setting is worse than one that lapses.
     *
     * ## It lives on the running order, and that is not an implementation detail
     *
     * The tick READS this and declines; it does not own it. A hold held beside the schedule would be
     * a second stateful owner of what airs, which is the thing the ownership rule
     * (`docs/internals/director.md` § "Who owns the running order") exists to prevent. `putOnAir`
     * clears it by construction, because a new broadcast is a new decision and its binding is built
     * fresh.
     */
    async holdAgainstSchedule(input: HoldStationInput): Promise<StationAir> {
        const until = input.minutes === undefined ? Infinity : Date.now() + input.minutes * 60_000;
        await this.director.holdAgainstSchedule(until);

        this.logger.info('director: the station is held against the schedule', { minutes: input.minutes });
        void this.activity.record({
            module: 'director',
            kind: 'air.held',
            detail:
                input.minutes === undefined
                    ? 'An operator held the station against the schedule until they release it.'
                    : `An operator held the station against the schedule for ${input.minutes} minutes.`,
            ...(this.actor() === undefined ? {} : { actorId: this.actor() }),
        });

        return await this.getAir();
    }

    /**
     * Hand the station back to the schedule.
     *
     * A station with no hold is answered rather than refused: releasing something that is already
     * released is what the operator wanted either way, and a 404 here would be the console arguing
     * about state it can see.
     */
    async releaseToSchedule(): Promise<StationAir> {
        await this.director.holdAgainstSchedule(undefined);

        this.logger.info('director: the station was released to the schedule');
        void this.activity.record({
            module: 'director',
            kind: 'air.released',
            detail: 'An operator handed the station back to the schedule.',
            ...(this.actor() === undefined ? {} : { actorId: this.actor() }),
        });

        return await this.getAir();
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
     * `onSlot` is the tick handing back the slot it already resolved, and `bySchedule` is the tick
     * filling a GAP, which has no slot to hand back. Both mean the clock chose this; the route
     * passes neither, so a person reaching here is recorded as one even inside a scheduled block.
     * That is a third thing the slot stamp cannot say on its own — see `placedBy` on the binding.
     *
     * @throws 422 when the playlist has nothing to play.
     */
    async putOnAir(input: PutOnAirInput, onSlot?: ScheduleSlot, bySchedule = false): Promise<StationAir> {
        const tracks = await this.sourceTracks(input);
        const mode = input.mode ?? 'rotation';

        // Which slot of the day this lands in, stamped even though the operator chose the source
        // themselves. That is what makes a manual takeover hold until the NEXT slot begins: the
        // tick compares ids, so they match until the boundary moves and then they do not. Stamping
        // nothing would leave the schedule free to change the station over a minute later, and
        // "leave it unset to mean a human did this" needs a second rule and a timestamp to say when
        // the human did it.
        //
        // `onSlot` is the schedule's own tick handing back the slot it already resolved, which is
        // not an optimization: resolving a second time here would open a window across a boundary
        // where the order is built from one slot's source and stamped with the next one's id, and
        // nothing afterwards could tell that from a station already airing the right thing.
        //
        // Never fatal. A schedule that could not be read is a station with no schedule, which is
        // what every station had before this existed, and refusing to go on air over it would be
        // the console declining to broadcast because a page nobody opened would not load.
        const slot =
            onSlot ??
            (await this.schedule.inForce().catch(error => {
                this.logger.warn(`director: could not read the schedule while going on air (${errorText(error)})`);
                return undefined;
            }));

        const binding: StationLineupBinding = {
            name: input.name ?? (await this.nameFor(input)),
            // Kept as the operator wrote it, whitespace aside. It is read by a model rather than
            // matched against anything, so there is nothing here to normalize and a station briefed
            // with only spaces asked for nothing.
            ...(input.brief?.trim() ? { brief: input.brief.trim() } : {}),
            // The brief's exact half. Bounds-checked by the contract, so anything that arrives here
            // is already a four-digit year, and either end may stand alone.
            ...(input.eraFrom === undefined ? {} : { eraFrom: input.eraFrom }),
            ...(input.eraTo === undefined ? {} : { eraTo: input.eraTo }),
            // Not validated against the persona table here, and deliberately: the resolver behind
            // it already falls back to the station's own host for an id that names nothing, which
            // is the same answer a persona deleted mid-broadcast gets. Refusing to go on air over a
            // stale id would be the station declining to broadcast over a question about its DJ.
            ...(input.personaId?.trim() ? { personaId: input.personaId.trim() } : {}),
            // A per-broadcast rule rather than a field of its own, which is where every other
            // switch about what a broadcast DOES lives. Absent leaves the station's own setting
            // standing, and a `setlist` or a `feature` takes no calls whatever this says because
            // `NO_RULES` is what those modes resolve from.
            ...(input.callins === undefined ? {} : { rules: { callins: input.callins } }),
            ...(slot === undefined ? {} : { slotId: slot.id }),
            // Who chose this, which the slot stamp above cannot answer. `onSlot` is the tick handing
            // back what it resolved, and `sustaining` is the tick filling a gap; everything else
            // reaching here is a person, including a person who happens to be inside a scheduled
            // block. That is what makes a takeover read as a takeover from the moment it starts
            // rather than from the next boundary.
            placedBy: onSlot !== undefined || bySchedule ? 'schedule' : 'operator',
            mode,
            onEnd: runsOut(mode, input.onEnd, stationAutoExtends(this.config)),
            source: sourceOf(input),
            // The plugin behind a chart is split back out of its qualified id rather than asked for
            // separately, so the console passes one string and the desk still gets the badge it
            // draws for a playlist.
            ...(pluginOf(input) === undefined ? {} : { sourcePluginId: pluginOf(input) }),
            ...(input.playlistId === undefined ? {} : { sourcePlaylistId: input.playlistId }),
            ...(input.chartId === undefined ? {} : { sourceChartId: input.chartId }),
        };

        // Synchronously, then the command: a commit pass may already be gathering against the
        // programme coming off, and only the epoch can reach it. See {@link announceAirChange}.
        this.director.invalidate();
        await this.director.post({ kind: 'putOnAir', binding, tracks });

        this.logger.info('director: put the station on air', {
            plugin: pluginOf(input),
            ...(input.playlistId === undefined ? {} : { playlist: input.playlistId }),
            ...(input.chartId === undefined ? {} : { chart: input.chartId }),
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
     *
     * Run through {@link PickResolver.vet} before it reaches the running order: a playlist is a
     * generator this station never asked its rules about, and a dislike, a period, and the advisory
     * policy are instructions rather than preferences a source gets to route around.
     */
    private async sourceTracks(input: PutOnAirInput): Promise<RundownTrack[]> {
        if (input.chartId !== undefined) return await this.chartTracks(input.chartId, input.chartOrder, this.era(input));
        if (input.pluginId === undefined || input.playlistId === undefined) return [];

        const { tracks } = await this.playlists.getPlaylistTracks(input.pluginId, input.playlistId);
        if (tracks.length === 0) {
            // A running order that plays nothing would report success and then air silence.
            throw httpError(422).withDetails({ message: 'that playlist has no tracks to play' });
        }

        const vetted = await this.resolver.vet(await this.toRundownTracks(input.pluginId, tracks), {
            era: this.era(input),
            preference: [input.pluginId],
        });
        if (vetted.length === 0) {
            // The same refusal as an empty playlist, and it has to be checked AFTER the veto rather
            // than only before it: a playlist with records on it that the station may not play is
            // empty for this purpose too, and letting it through reports success and then airs
            // either silence (a setlist) or the station's own rotation in place of the playlist the
            // operator chose (a rotation, refilled) — with nothing anywhere saying the choice was
            // overruled. The wording names the veto rather than the playlist, because the playlist
            // is fine and the station's own rules are what emptied it.
            throw httpError(422).withDetails({
                message: 'every record on that playlist is one this station will not play: a dislike, the period, the advisory policy, or its length',
            });
        }
        return vetted;
    }

    /**
     * What to call a broadcast nobody named.
     *
     * A chart gets the chart's OWN name, which costs one call to a menu that is built without a
     * request on every plugin that offers one, because "Top 100 Songs" is what the operator clicked
     * and `From deadair.lastfm` is the name of the software they clicked it in. Falling back to the
     * plugin keeps a chart whose descriptor has since gone from being nameless.
     */
    private async nameFor(input: PutOnAirInput): Promise<string> {
        const plugin = pluginOf(input);
        if (plugin === undefined) return 'The station';

        if (input.chartId !== undefined) {
            // Never fatal: this is a label. A menu that could not be read is a broadcast named after
            // its plugin, which is what every imported one is already called.
            const named = await this.charts
                .listCharts()
                .then(charts => charts.find(chart => chart.id === input.chartId)?.name)
                .catch(error => {
                    this.logger.warn(`director: could not read the chart menu while naming a broadcast (${errorText(error)})`);
                    return undefined;
                });
            if (named !== undefined) return named;
        }

        return `From ${plugin}`;
    }

    /** The period a broadcast was asked for, in the shape everything downstream of here reads it. */
    private era(input: PutOnAirInput): EraWindow {
        return { from: input.eraFrom, to: input.eraTo };
    }

    /**
     * The records a broadcast built from a published chart starts from.
     *
     * ## A chart names records where a playlist names copies
     *
     * That one difference is the whole of why this is not the branch above with a different fetch.
     * A `CatalogTrack` carries the provider id the player is eventually handed, so a playlist only
     * has to be VETTED. A `ChartEntry` carries a title and an artist and nothing else, on purpose
     * — a chart is an opinion about records rather than a source of them — so every entry has to be
     * matched against the catalog, looked up at a provider and ingested before it can air. That is
     * {@link PickResolver.resolve}, which is the one step every pick from every source passes
     * through, and going round it would be a second idea of what may play.
     *
     * ## Seeded under {@link NO_RULES}, which is not a relaxation invented here
     *
     * A chart is a document the operator chose, so the repeat window, the artist cooldown and the
     * per-artist cap have nothing to apply to it — running today's top forty under a three-day
     * window would suppress the very records it exists to play, which is the argument `resolveRules`
     * already makes for a setlist and {@link PickResolver.vet} already makes for a playlist. What
     * stays on is the veto: `resolve` applies the dislike, the period and the advisory policy
     * whatever rules it is handed, and those are instructions rather than preferences. `keepOrder`
     * relaxes one more thing NO_RULES does not touch on its own: a countdown's order is its content,
     * and the respacing `resolve` otherwise ends with would pull the most frequent act to the front.
     *
     * Everything AFTER the seeding is an ordinary rotation. A chart is forty records and an evening
     * is more than forty, so the broadcast is topped up by the generators like any other — the
     * chart is read once and never again, which is why `sourceChartId` is provenance rather than a
     * binding.
     *
     * @throws 422 when the chart could not be read, or when nothing on it can air.
     */
    private async chartTracks(chartId: string, order: PutOnAirInput['chartOrder'], era: EraWindow): Promise<RundownTrack[]> {
        const { address, entries } = await this.readChart(chartId);

        const picks = chartPicks(entries, { order: order ?? DEFAULT_CHART_ORDER, ...(bindsAnything(era) ? { era } : {}) });
        // A lookup for every entry, rather than the refill's cap. That cap protects a provider's
        // rate budget from one background refill starving the next, and there is no next refill
        // here: this is an operator asking for one document, once, already bounded at
        // `MAX_CHART_ENTRIES`. Held to it, a hundred-record chart got 32 lookups and aired the
        // remainder as "not in the catalog" without a provider ever being asked about them, which
        // reads from the console exactly like a chart service that carried nothing.
        const tracks = await this.resolver.resolve(picks, NO_RULES, {
            era,
            preference: [address.pluginId],
            discoveries: picks.length,
            keepOrder: true,
        });
        if (tracks.length === 0) {
            // Said in the operator's terms rather than the resolver's, and the two cases are named
            // apart because they want opposite fixes. With discovery off this is not a fault at all
            // — it is a setting doing exactly what it says — but a chart pick is almost never
            // already in the library, so it empties the whole document and reads from the console
            // as a broken plugin. That is the "decline loudly" rule [chart-discovery](https://github.com/robert-dean/deadair/blob/71e431d4/docs/todo/chart-discovery.md) asks for,
            // and this is the surface where somebody is standing at the desk to read it.
            throw httpError(422).withDetails({
                message: settingIsOn(this.config, DISCOVER_KEY, DISCOVER_DEFAULT)
                    ? "nothing on that chart can be played: no provider serves these records, or the period and the station's own vetoes rule them all out"
                    : 'nothing on that chart is in the library, and "rotation.discover" is off, so the station may not look these records up',
            });
        }
        return tracks;
    }

    /**
     * A chart id resolved to a plugin and the entries it currently serves, or a refusal.
     *
     * Both of the ways airing a chart can fail before a single provider is asked, in one place
     * because two callers need exactly them: {@link airChart} at the door, so an operator hears
     * about a chart nothing can read while they are still looking at the button, and
     * {@link chartTracks} in the job, which does the work.
     *
     * **Deliberately read twice, once per caller**, rather than the door handing its entries to the
     * job. That follows `ExtendLineupJob` and `ReplanLineupJob`, both of which re-read everything at
     * run time so an attempt is judged against the station as it stands: a chart is a live document,
     * and passing a snapshot through a queue would air whatever it said when the button was pressed.
     * It also keeps the payload to an id. The cost is one extra plugin call per airing, against the
     * hundred provider searches behind it.
     *
     * @throws 422 when the id names no chart, or when nothing could read one.
     */
    private async readChart(chartId: string): Promise<{ address: { pluginId: string }; entries: ChartEntry[] }> {
        const address = splitChartId(chartId);
        if (address === undefined) {
            throw httpError(422).withDetails({ message: 'that is not a chart id; it names a plugin and one of its charts, as `plugin:chart`' });
        }

        const entries = await this.charts.fetchChart(chartId, MAX_CHART_ENTRIES);
        if (entries.length === 0) {
            // `ChartsService` flattens every way this can go wrong — an unqualified id, a plugin
            // that is gone, one that is not charts-capable, one whose upstream refused — to an empty
            // list and a log line, because a chart is something to LOOK at and a page of nothing is
            // not an error. Airing one is the other thing, and reporting success here would put the
            // station on an empty running order.
            throw httpError(422).withDetails({ message: 'that chart could not be read, so there is nothing to play' });
        }

        return { address, entries };
    }

    /**
     * Ask the station to go on air with a published chart.
     *
     * Queued, like {@link replanOrder}, and for a reason neither the playlist changeover beside it
     * nor any other console action has: a chart names RECORDS where a playlist names copies, so
     * every entry has to be looked up at a provider and ingested — up to `MAX_CHART_ENTRIES` of
     * them, each a search across every searchable provider. Done inline that is minutes of network
     * holding a pooled connection and the operator's request open, which is the shape
     * `transaction.exemptions.ts` records as having taken the pool down once already.
     *
     * **What is answered here is the ASK**, on `extendOrder`'s rule. The two failures an operator
     * can act on are still raised at the door, because {@link readChart} runs before anything is
     * enqueued and both are cheap to know: an id that names no chart, and a chart nothing could
     * read. The third — nothing on it can be played — needs the lookups to know at all, so it
     * lands on the activity feed minutes later rather than on the button.
     *
     * @throws 422 when the id names no chart, or when nothing could read one.
     */
    async airChart(input: { chartId: string; chartOrder?: PutOnAirInput['chartOrder'] }): Promise<void> {
        // Read and discarded. The job reads it again for the reason `readChart` gives; what this
        // call is for is refusing at the door rather than accepting an ask that cannot land.
        await this.readChart(input.chartId);

        // Stamped with the broadcast that is on air right now, if any, so the job can tell whether
        // the one on air when it finally runs is still the one this press was about: see
        // `AirChartJob.execute`.
        const broadcastId = this.director.order()?.broadcastId;
        await this.jobs.send('director.air_chart', {
            chartId: input.chartId,
            ...(input.chartOrder === undefined ? {} : { chartOrder: input.chartOrder }),
            ...(broadcastId === undefined ? {} : { broadcastId }),
        });

        void this.activity.record({
            module: 'director',
            kind: 'air.chartRequested',
            detail: 'An operator asked the station to go on air with a published chart.',
            data: { chartId: input.chartId, ...(input.chartOrder === undefined ? {} : { chartOrder: input.chartOrder }) },
            ...(this.actor() === undefined ? {} : { actorId: this.actor() as string }),
        });
    }

    // ── the live running order ─────────────────────────────────────────────────
    //
    // Every one of these posts a command and none of them writes the order, which is the
    // rule the whole decision rests on. They read as thin because they are: the work is
    // the director's, and what is left here is turning a refusal into a status code.

    /** Add tracks to what is on air now, rather than waiting for it to run short. */
    async extendOrder(input: ExtendStationInput): Promise<void> {
        // Stamped with the broadcast that is on air right now, if any, so the job can tell whether
        // the one it loads when it finally runs is still the one this ask was about: see
        // `ExtendLineupJob.execute`.
        const broadcastId = this.director.order()?.broadcastId;
        await this.jobs.send('director.extend_lineup', {
            ...(input.count === undefined ? {} : { count: input.count }),
            ...(broadcastId === undefined ? {} : { broadcastId }),
        });

        // The ASK, not the outcome. What the refill actually found is the chain's own event, minutes
        // later and with no actor on it, so recording both is what tells "nobody asked for more
        // records" apart from "somebody did and the generators came up short".
        void this.activity.record({
            module: 'director',
            kind: 'order.extended',
            detail: 'An operator asked for more records.',
            ...(input.count === undefined ? {} : { data: { count: input.count } }),
            ...(this.actor() === undefined ? {} : { actorId: this.actor() as string }),
        });
    }

    /**
     * Throw away what the station had planned and have it programme that stretch again.
     *
     * Queued, like {@link extendOrder} and more so: this one waits on the same generators AND is
     * what keeps the station from going quiet while they run. `ReplanLineupJob` chooses a whole
     * fresh set before anything is dropped, so the tail an operator is tired of keeps playing until
     * there is something to put in its place. Nothing is answered here but the ASK.
     *
     * A new brief is written FIRST and awaited, because the job reads it off the row: sending both
     * at once would programme the fresh hour against the instruction being replaced. It is also the
     * durable half — the brief steers every refill for the rest of the broadcast — so it stands
     * whether or not the replan behind it finds anything.
     */
    async replanOrder(input: ReplanStationInput): Promise<void> {
        if (input.brief !== undefined) await this.director.post({ kind: 'rebrief', brief: input.brief });
        // Stamped with the broadcast this ask is about, on `extendOrder`'s rule: see
        // `ReplanLineupJob.execute`.
        const broadcastId = this.director.order()?.broadcastId;
        await this.jobs.send('director.replan_lineup', {
            ...(input.count === undefined ? {} : { count: input.count }),
            ...(broadcastId === undefined ? {} : { broadcastId }),
        });

        void this.activity.record({
            module: 'director',
            kind: 'order.replanned',
            // The brief is quoted because it is the operator's own words about their own station,
            // which is the one kind of text this feed may carry: see `ActivityRecorder`.
            detail: input.brief
                ? `An operator threw out the rest of the running order and asked the station for ${input.brief}.`
                : 'An operator threw out the rest of the running order and asked the station to programme it again.',
            ...(input.count === undefined && input.brief === undefined
                ? {}
                : {
                      data: {
                          ...(input.count === undefined ? {} : { count: input.count }),
                          ...(input.brief === undefined ? {} : { brief: input.brief }),
                      },
                  }),
            ...(this.actor() === undefined ? {} : { actorId: this.actor() as string }),
        });
    }

    /**
     * Change who is presenting the broadcast that is on air.
     *
     * The one way a show's host changes without a new broadcast. A persona put on air from the
     * personas page is the STATION's, and `PersonaRepository.presenting` deliberately lets a show
     * that named its own host keep it — so this is how you take that show off the host it named,
     * and naming nobody here hands it back to the station's.
     *
     * **Validated at the door**, unlike {@link putOnAir}, which takes a persona id on trust because
     * refusing to go on air over a stale one would be the station declining to broadcast. Nothing
     * is at stake here but the request itself, and an operator picking from a list they were just
     * shown should be told when it is gone rather than watching the show carry on unchanged.
     *
     * Awaited, so the order answered with is the one the recast produced — the rewrite sweep behind
     * it is best-effort and its own event on the feed. What it costs is stated by the console:
     * breaks already written for this show in the outgoing character are written again, and one
     * that is not ready when its slot comes round is skipped rather than waited for.
     *
     * @throws 404 when there is no such persona.
     */
    async recast(input: SetStationHostInput): Promise<StationOrder> {
        const personaId = input.personaId?.trim();
        const host = personaId === undefined ? undefined : await this.personas.find(personaId);
        if (personaId !== undefined && host === undefined) throw httpError(404).withDetails({ message: 'no such persona' });

        await this.director.post({ kind: 'recast', bind: { ...(personaId === undefined ? {} : { personaId }) } });

        void this.activity.record({
            module: 'director',
            kind: 'air.recast',
            // The persona's own label, which is the station's own text about its own character —
            // the one kind this feed may quote. See `ActivityRecorder`.
            detail:
                host === undefined ? 'An operator handed the broadcast back to the station’s host.' : `An operator put ${host.label} on the show.`,
            ...(personaId === undefined ? {} : { data: { personaId } }),
            ...(this.actor() === undefined ? {} : { actorId: this.actor() as string }),
        });
        return await this.getOrder();
    }

    /**
     * Shuffle the records on air that have not been handed to the player.
     *
     * The breaks among them are dropped rather than carried to a random new position, and the
     * planner plants the shuffled tail again on the pass that follows: see
     * `StationLineup.shuffleRemaining`.
     */
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
            // The row is already loaded, so the order gets what sort of break this is for free.
            // Without it an operator dropping a bulletin in by hand would be counted against the
            // station's own spacing and would push the next ident back for no reason.
            segmentKind: segment.kind,
            ...(input.atIndex === undefined ? {} : { atIndex: input.atIndex }),
            ...(input.overAtMs === undefined ? {} : { overAtMs: input.overAtMs }),
        });
    }

    /**
     * Put a catalog record into the running order at a position.
     *
     * The other half of undo: dropping a SEGMENT only ever marks it `removed`
     * (`StationLineup.remove`), because a break planted again into the same slot a minute later is
     * the fault that mark exists to prevent. A TRACK is spliced out entirely — there is no slot for
     * a record to be planted back into on its own — so nothing could put one back until this
     * existed. It is also simply "add this record", useful anywhere the library names a track the
     * running order does not currently hold.
     *
     * @throws 404 when the catalog has no such record, or no provider can currently serve it at
     *   all. @throws 422 when a provider CAN serve it but the audio is not on this machine yet — the
     *   same distinction {@link addSegmentToOrder} draws, and the same reason: an operator asking
     *   for a specific record should be told why it cannot play yet, not watch the order accept it
     *   and the commit gate quietly hold the slot open behind it. See `bytes-before-air.md`. @throws
     *   422 when {@link PickResolver.vet} drops the record: a dislike, outside the broadcast's
     *   period, no copy the advisory policy allows, or a length outside the station's bounds. An
     *   operator picking one record by hand gets
     *   the same veto a playlist put on air does (see {@link sourceTracks}) because a person at
     *   the console is not an instruction the station's own rules get to be routed around.
     */
    async addTrackToOrder(input: AddStationTrackInput): Promise<StationOrder> {
        const row = await this.tracks.findTrack(input.trackId);
        if (row === undefined) throw httpError(404).withDetails({ message: 'no such record' });

        const bindings = await this.candidates.bindingsFor([input.trackId]);
        const binding = bindings.get(input.trackId);
        if (binding === undefined) throw httpError(404).withDetails({ message: 'no provider currently lists a copy of this record' });

        if (!(await this.trackAudio.has(binding))) {
            throw httpError(422).withDetails({ message: 'the station does not have this record’s audio locally yet' });
        }

        // Identity is the LEAD artist, exactly as every generator-produced item's is, so history
        // and the artist cooldown key on the lead rather than the whole credit line.
        const track: RundownTrack = {
            pluginId: binding.pluginId,
            externalId: binding.externalId,
            title: row.title,
            artists: [row.artistName],
            artist: row.artistName,
            trackId: row.id,
            ...(binding.durationMs === undefined ? {} : { durationMs: binding.durationMs }),
            // `== null` rather than `=== undefined`: a SQL NULL reads back as `undefined` at
            // runtime, but Kysely's generated type still says `T | null`, on `db.ts`'s own rule.
            ...(row.albumName == null ? {} : { album: row.albumName }),
            ...(row.albumImageUrl == null ? {} : { artworkUrl: row.albumImageUrl }),
            ...(row.year == null ? {} : { year: row.year }),
        };

        const order = this.director.order();
        const vetted = await this.resolver.vet([track], { era: { from: order?.eraFrom, to: order?.eraTo }, preference: [binding.pluginId] });
        if (vetted.length === 0) {
            throw httpError(422).withDetails({
                message: 'this station will not play that record: a dislike, the period, the advisory policy, or its length',
            });
        }

        return await this.editOrder({
            kind: 'insertTrack',
            track,
            ...(input.atIndex === undefined ? {} : { atIndex: input.atIndex }),
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

        // After {@link require}, so a refused edit writes nothing: the feed says what happened to
        // the station and a 422 did not happen to it. One place for all four edits, because they
        // arrive through one funnel and a per-method call would drift the moment a fifth is added.
        void this.activity.record({
            module: 'director',
            kind: `order.${edit.kind}`,
            detail: describeEdit(edit),
            data: { ...edit },
            ...(this.actor() === undefined ? {} : { actorId: this.actor() as string }),
        });
        return await this.getOrder();
    }

    /** Turn an edit refusal into the status code that says the same thing. */
    private require(result: EditResult): void {
        if (result.ok) return;

        // No 409 left to answer: there is no revision to be stale against, because there is no
        // second copy of the order for a console to have drawn from.
        const status = result.reason === 'not-found' ? 404 : 422;
        throw httpError(status).withDetails({ message: result.message });
    }

    /**
     * One provider's playlist as running-order tracks, with whatever the catalog can add.
     *
     * The provider stays authoritative for the copy that will play — title,
     * artists, duration — while the catalog answers for the work: its canonical
     * id, its year, and a cover the station may already have cached. Cover art
     * prefers the catalog's, which has resolved to the local copy where there is
     * one rather than hotlinking a provider CDN on every poll.
     *
     * Never fails the import. Metadata is decoration and airing is the job, so a
     * catalog read that throws costs the covers and nothing else.
     *
     * Folds two rips of one song into the first occurrence, by the same {@link songKey} the rotation
     * itself matches by. A playlist an operator built by hand is exactly where a compilation and the
     * album it draws from both turn up, and the second copy is a repeat rather than a second record.
     */
    private async toRundownTracks(pluginId: string, tracks: readonly CatalogTrack[]): Promise<RundownTrack[]> {
        const seen = new Set<string>();
        const deduped = tracks.filter(track => {
            const key = songKey(track.title, [track.artists[0] ?? '']);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        const known = await this.catalogMetadata(pluginId, deduped);

        return deduped.map(track => {
            const row = known.get(track.id);
            const album = track.album ?? row?.albumName ?? undefined;
            const artworkUrl = row?.albumImageUrl ?? track.artworkUrl;
            return {
                pluginId,
                externalId: track.id,
                title: track.title,
                artists: track.artists,
                // A provider's array, so the lead really is its first entry here — which is not
                // true of every producer, and is why identity is carried rather than inferred.
                artist: track.artists[0] ?? '',
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
                error: errorText(error),
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
        // Only when this broadcast named one. A show running on the station's own host draws no
        // name here, because the personas page is where that is already answered and repeating it
        // would read as an override that was never set.
        const host = order.personaId === undefined ? undefined : await this.personas.find(order.personaId);
        // Read here rather than stored on the lineup, for the reason a segment's label is: the
        // document holds an id and the catalog holds the opinion, so an operator who rates a record
        // sees it against what is on air instead of against what it was when the order was built.
        // The same row carries the artist and album this record belongs to, which is what lets a
        // console reach either page from the running order.
        const known = await this.tracks.catalogRowsByTrackId(
            order.items.flatMap(item => (item.kind === 'track' && item.track.trackId !== undefined ? [item.track.trackId] : [])),
        );

        return {
            name: order.name,
            ...(order.brief === undefined ? {} : { brief: order.brief }),
            ...(order.personaId === undefined ? {} : { personaId: order.personaId }),
            // Resolved as the order is read rather than stored beside the id, for the reason a
            // segment's label and a track's rating are: the document holds an id and the persona
            // table holds the name, so an operator who renames their host sees the new name on the
            // show that is already running.
            ...(host?.label === undefined ? {} : { personaLabel: host.label }),
            mode: order.mode,
            onEnd: order.onEnd,
            source: order.source,
            ...(order.sourcePluginId === undefined ? {} : { sourcePluginId: order.sourcePluginId }),
            ...(order.sourcePlaylistId === undefined ? {} : { sourcePlaylistId: order.sourcePlaylistId }),
            ...(order.sourceChartId === undefined ? {} : { sourceChartId: order.sourceChartId }),
            items: order.items.map(item => {
                if (item.kind === 'segment') return toOrderSegment(item, segments.get(item.segmentId));

                // One lookup for the opinion and both links: absent means the catalog has never
                // seen this record, which is a station airing something it never ingested rather
                // than a fault, and the console draws its row as words instead of links.
                const row = item.track.trackId === undefined ? undefined : known.get(item.track.trackId);
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
                    // Absent for a record the catalog has never seen, which has nothing to rate.
                    ...(row === undefined ? {} : { rating: row.rating, artistId: row.artistId }),
                    // One more reason for this one to be absent: a single ingested outside any
                    // release has no album to reach.
                    ...(row?.albumId === undefined ? {} : { albumId: row.albumId }),
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
 * One edit, in the words an operator would use for it.
 *
 * Deliberately says what it did to the STATION rather than to a list, which is the same rule the
 * `/onair` page's copy follows: a shuffle here is heard by every listener within a few records.
 */
function describeEdit(edit: OrderEdit): string {
    switch (edit.kind) {
        case 'shuffle':
            return 'An operator shuffled the records the player is not already holding, and the breaks were planted again around them.';
        case 'move':
            return 'An operator moved an item in the running order.';
        case 'remove':
            return 'An operator dropped an item before it could play.';
        case 'insertSegment':
            return 'An operator put a break into the running order.';
        case 'insertTrack':
            return 'An operator put a record into the running order.';
    }
}

/**
 * What a broadcast does when it reaches the end of its running order.
 *
 * The operator's answer wins whenever they gave one, with a single exception: a `setlist` and a
 * `feature` cannot be extended, because {@link ResolvedRules.mayGenerate} is false for both and
 * nothing may programme into them. `extend` there is not a preference the station declines to
 * honour, it is a state with no behaviour — the order simply ends and sits exhausted, which is what
 * `stop` already says out loud. Storing the word that matches keeps the console honest: `onEnd` is
 * what `whatHappensThen` reads to promise "it tops itself up before then", and that promise has to
 * be true of every row that can hold it.
 *
 * An absent answer is the station's own default, which is what `rotation.autoExtend` decides. Read
 * ONCE, here, rather than consulted again later — see {@link stationAutoExtends} for why a station
 * default must not be able to overrule a broadcast that is already running.
 */
/**
 * Who built a running order, for the one column that records it.
 *
 * A chart is its own value rather than a second kind of `import`, because the two answer a
 * different question when something goes wrong later: an import is a list somebody synced and a
 * chart is a document somebody else publishes, and only one of them can be re-read to find out what
 * the station was told.
 */
function sourceOf(input: PutOnAirInput): string {
    if (input.chartId !== undefined) return 'chart';
    return input.pluginId === undefined ? 'director' : 'import';
}

/** The plugin behind whichever source was named, or `undefined` for a broadcast the station fills itself. */
function pluginOf(input: PutOnAirInput): string | undefined {
    if (input.chartId !== undefined) return splitChartId(input.chartId)?.pluginId;
    return input.pluginId;
}

function runsOut(mode: StationMode, asked: StationOnEnd | undefined, autoExtends: boolean): StationOnEnd {
    if (mode !== 'rotation') return asked === undefined || asked === 'extend' ? 'stop' : asked;

    return asked ?? (autoExtends ? 'extend' : 'stop');
}

/**
 * Who is driving the station, in the one word a console can put above the record.
 *
 * Derived rather than stored, because three of the four states are already facts the director
 * holds — and a second stored opinion about programming is the bug `on-air-ownership.md` exists to
 * close. The one thing that could NOT be derived is `placedBy`, and that is on the running order
 * itself for the same reason everything else about a broadcast is.
 *
 * The split between `schedule` and `sustaining` is the slot stamp: a block the clock changed over
 * to carries one, and the thing it plays in the hours no block claims carries none. Both are the
 * clock driving, and they are told apart because "Afternoon Drive" and "whatever fills the gap" are
 * different answers to an operator wondering why this is on.
 */
function airSourceOf(status: { active: boolean; slotId?: string; placedBy?: 'operator' | 'schedule' }): AirSource {
    if (!status.active) return 'off';
    if (status.placedBy !== 'schedule') return 'operator';

    return status.slotId === undefined ? 'sustaining' : 'schedule';
}
