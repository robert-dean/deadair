import { Injectable } from 'injectkit';
import { JobBroker } from '@maroonedsoftware/jobbroker';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { DateTime } from 'luxon';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { PlaylistsService } from '#modules/playlists/playlists.service.js';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import type { CatalogTrack } from '#modules/playlists/types/playlists.types.js';
import type {
    PersonaAudition as PersonaAuditionView,
    PersonaAuditionBreak as PersonaAuditionBreakView,
    PersonaAuditionList,
    PersonaAuditionRequest,
    PersonaAuditionSummary,
} from './types/personas.types.js';
import type { Audition, AuditionBreak, AuditionRecord } from './persona.audition.js';
import { PersonaAuditionRepository } from './persona.audition.repository.js';
import { PersonaRepository } from './persona.repository.js';

/**
 * How many runs one character keeps.
 *
 * A bound rather than a sweeper job: an audition is an operator pressing a button while tuning a
 * sheet, so the table grows in bursts of one afternoon and is never read past the last few runs. A
 * nightly prune would be more machinery than the thing it swept, and the breaks go with the run
 * through the cascade.
 */
const KEEP_PER_PERSONA = 30;

/**
 * The operator's surface onto hearing a character over real records.
 *
 * ## Asking for one QUEUES it, and that is load-bearing
 *
 * {@link start} resolves the playlist, writes a row and sends the first job. It writes no break and
 * waits for none. Every transition is a generation at the `preview` tier — behind everything the
 * station does for itself, and preempted the moment a real break wants the model — so a run of
 * twenty is minutes to hours. A request that ran them inline would hold a connection and a browser
 * for the length of it, which is the console making the station worse by being looked at.
 *
 * ## The playlist is read HERE and never in the job
 *
 * `PlaylistsService` is scoped over the access control the operator's session carries, and a job
 * runs as nobody. So the plugin call happens inside the request, as the person who asked, and what
 * lands on the row is the resolved list. That also makes the run a measurement: a playlist reordered
 * at the provider half way through cannot change what is being measured underneath it.
 */
@Injectable()
export class PersonaAuditionService {
    constructor(
        private readonly auditions: PersonaAuditionRepository,
        private readonly personas: PersonaRepository,
        // The operator's own view of the plugins, which is the whole reason this is read in the
        // request. See the class note.
        private readonly playlists: PlaylistsService,
        // What the station knows about the copies the playlist named. Best-effort: a run against
        // records the catalog has never seen is an ordinary run with less to say about them.
        private readonly tracks: TracksRepository,
        // The SCOPED broker, so the row and the job it sends commit together: a run whose insert
        // rolled back must not leave a job looking for it.
        private readonly jobs: JobBroker,
        private readonly activity: ActivityRecorder,
        private readonly context: AuthorizationContext,
        private readonly logger: Logger,
    ) {}

    /** The operator behind this request, for the activity feed. Absent for anything not a person. */
    private actor(): string | undefined {
        return this.context.actor.kind === 'user' ? this.context.actor.actorId : undefined;
    }

    /** Every audition of one character, newest first, without their breaks. */
    async list(id: string): Promise<PersonaAuditionList> {
        await this.require(id);

        const runs = await this.auditions.listFor(id);
        const views = await Promise.all(runs.map(async run => await this.summary(run)));

        return { auditions: views };
    }

    /** One run with every break it has written so far, in order. */
    async get(id: string, auditionId: string): Promise<PersonaAuditionView> {
        await this.require(id);

        const run = await this.found(id, auditionId);
        const breaks = await this.auditions.breaksOf(auditionId);

        return { ...(await this.summary(run, breaks.length)), breaks: breaks.map(toBreakView) };
    }

    /**
     * Put a character through a playlist.
     *
     * Refused rather than truncated when the playlist cannot make a single transition: a break sits
     * BETWEEN two records, so a playlist of one has nothing to write about and an empty run reported
     * as `done` would be a measurement that never happened.
     */
    async start(id: string, body: PersonaAuditionRequest): Promise<PersonaAuditionView> {
        const persona = await this.require(id);

        const playlist = await this.playlists.getPlaylistTracks(body.pluginId, body.playlistId);
        // One more record than the breaks asked for, because a break sits between two.
        const wanted = body.limit + 1;
        const records = await this.recordsOf(body.pluginId, playlist.tracks.slice(0, wanted));

        if (records.length < 2)
            throw httpError(422).withDetails({
                message: 'that playlist does not hold two records, so there is no transition to write a break for',
            });

        // Before the insert rather than after, so the bound is what the table holds rather than what
        // it held a moment ago.
        await this.auditions.prune(id, KEEP_PER_PERSONA - 1);

        const audition = await this.auditions.open({
            personaId: persona.id,
            personaKey: persona.key,
            sourcePluginId: body.pluginId,
            sourcePlaylistId: body.playlistId,
            ...(body.name === undefined ? {} : { sourceName: body.name }),
            records,
            ...(this.actor() === undefined ? {} : { actorId: this.actor()! }),
        });

        // Queued rather than started. The job writes the first transition and sends the second.
        await this.jobs.send('personas.audition', { auditionId: audition.id, ordinal: 0 });

        this.logger.info('personas: an operator started an audition', {
            audition: audition.id,
            persona: persona.key,
            plugin: body.pluginId,
            transitions: audition.transitions,
        });
        void this.activity.record({
            // `director` rather than a module of its own, on `persona.active`'s argument one file
            // over: the feed's modules are what an operator filters by, `director` is drawn as
            // "Programming", and who the station sounds like belongs there.
            module: 'director',
            kind: 'persona.audition.started',
            detail: `${persona.label} was put through a playlist: ${audition.transitions} breaks.`,
            data: { auditionId: audition.id, personaKey: persona.key, transitions: audition.transitions },
            ...(this.actor() === undefined ? {} : { actorId: this.actor()! }),
        });

        return { ...(await this.summary(audition, 0)), breaks: [] };
    }

    /**
     * Stop one where it stands.
     *
     * The breaks it already wrote are kept: the model was spent on them and they are as much a
     * reading of the sheet as the ones that would have followed. Refused for a run that has already
     * settled, so stopping something that finished does not rewrite the record.
     */
    async cancel(id: string, auditionId: string): Promise<PersonaAuditionSummary> {
        const persona = await this.require(id);
        const run = await this.found(id, auditionId);

        const stopped = await this.auditions.cancel(auditionId);
        if (!stopped) throw httpError(409).withDetails({ message: `that audition is already ${run.state} and cannot be stopped` });

        this.logger.info('personas: an operator stopped an audition', { audition: auditionId, was: run.state });
        void this.activity.record({
            module: 'director',
            kind: 'persona.audition.cancelled',
            detail: `${persona.label}'s audition was stopped.`,
            data: { auditionId, personaKey: persona.key, was: run.state },
            ...(this.actor() === undefined ? {} : { actorId: this.actor()! }),
        });

        // Read back rather than assumed, so the answer carries the row as it now stands.
        const after = await this.auditions.findById(auditionId);
        return await this.summary(after ?? run);
    }

    /** The character, or a 404. Every route here is about one. */
    private async require(id: string) {
        const persona = await this.personas.find(id);
        if (persona === undefined) throw httpError(404).withDetails({ message: `persona "${id}" does not exist` });

        return persona;
    }

    /**
     * One of this character's runs, or a 404.
     *
     * Checked against the persona in the path rather than looked up by id alone, so a run id from
     * another character answers 404 here instead of drawing one character's breaks under another's
     * name.
     */
    private async found(id: string, auditionId: string): Promise<Audition> {
        const run = await this.auditions.findById(auditionId);
        if (run === undefined || run.personaId !== id) throw httpError(404).withDetails({ message: `audition "${auditionId}" does not exist` });

        return run;
    }

    /**
     * The provider's tracks as the records a run is written against.
     *
     * The catalog read is best-effort and never fatal, on `toRundownTracks`' rule: what it adds is
     * the `trackId` everything interesting hangs off — the facts, the year, the album — and a
     * playlist of records the station has never ingested is an ordinary audition with less to say.
     */
    private async recordsOf(pluginId: string, tracks: readonly CatalogTrack[]): Promise<AuditionRecord[]> {
        const known = await this.catalogRows(pluginId, tracks);

        return tracks.map(track => {
            const row = known.get(track.id);
            const album = track.album ?? row?.albumName ?? undefined;
            const year = row?.year ?? undefined;

            // The playlist read already resolves this where it can; the catalog read behind it is
            // what adds the year and the album, and answers the id for a binding that read missed.
            const trackId = track.trackId ?? row?.trackId;

            return {
                pluginId,
                externalId: track.id,
                title: track.title,
                // A provider's array really does have the lead first, which is not true of the
                // catalog's own credit column — the same asymmetry `toRundownTracks` writes down.
                artist: track.artists[0] ?? '',
                ...(trackId === undefined ? {} : { trackId }),
                ...(year == null ? {} : { year }),
                ...(album === undefined ? {} : { album }),
                ...(track.durationMs === undefined ? {} : { durationMs: track.durationMs }),
            };
        });
    }

    /** The catalog's rows for these bindings, by provider id. Empty when it cannot answer. */
    private async catalogRows(pluginId: string, tracks: readonly CatalogTrack[]) {
        try {
            const rows = await this.tracks.findByBindings(
                pluginId,
                tracks.map(track => track.id),
            );
            return new Map(rows.map(row => [row.externalId, row]));
        } catch (error) {
            this.logger.warn('personas: could not read catalog metadata for an audition; taking the playlist as it came', {
                plugin: pluginId,
                error: errorText(error),
            });
            return new Map<string, { trackId: string; year: number | null; albumName: string | null }>();
        }
    }

    /** One run as a list draws it: how far along, and where the records came from. */
    private async summary(run: Audition, written?: number): Promise<PersonaAuditionSummary> {
        const count = written ?? (await this.auditions.writtenCount(run.id));

        return {
            id: run.id,
            personaId: run.personaId,
            personaKey: run.personaKey,
            source: {
                pluginId: run.sourcePluginId,
                playlistId: run.sourcePlaylistId,
                ...(run.sourceName === undefined ? {} : { name: run.sourceName }),
            },
            state: run.state,
            transitions: run.transitions,
            written: count,
            ...(run.error === undefined ? {} : { error: run.error }),
            ...(run.cancelledAt === undefined ? {} : { cancelledAt: iso(run.cancelledAt) }),
            ...(run.finishedAt === undefined ? {} : { finishedAt: iso(run.finishedAt) }),
            createdAt: iso(run.createdAt),
        };
    }
}

/** Epoch millis as the ISO-8601 string this area's contracts carry. */
const iso = (millis: number): string => DateTime.fromMillis(millis).toISO() ?? '';

/** One break as the console reads it. */
function toBreakView(written: AuditionBreak): PersonaAuditionBreakView {
    return {
        ordinal: written.ordinal,
        previous: toRecordView(written.previous),
        next: toRecordView(written.next),
        attempts: written.attempts.map(attempt => ({
            writer: attempt.writer,
            outcome: attempt.outcome,
            durationMs: attempt.durationMs,
            ...(attempt.script === undefined ? {} : { script: attempt.script }),
            ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
        })),
        ...(written.script === undefined ? {} : { script: written.script }),
        ...(written.writer === undefined ? {} : { writer: written.writer }),
        ...(written.reason === undefined ? {} : { reason: written.reason }),
    };
}

/** One record as the console reads it: what the writers were shown, without the binding. */
function toRecordView(record: AuditionRecord) {
    return {
        title: record.title,
        artist: record.artist,
        ...(record.trackId === undefined ? {} : { trackId: record.trackId }),
        ...(record.year === undefined ? {} : { year: record.year }),
        ...(record.album === undefined ? {} : { album: record.album }),
        ...(record.durationMs === undefined ? {} : { durationMs: record.durationMs }),
    };
}
