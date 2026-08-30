import { Container, Injectable } from 'injectkit';
import type { SpeechCue } from '@deadair/plugin-sdk';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { EnrichmentReadService } from '#modules/enrichment/enrichment.read.service.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { padCue, padsIn } from '#modules/render/pad.cues.js';
import { PadRepository } from '#modules/render/pad.repository.js';
import { padEveryBreaks, padsAreOn } from '#modules/render/pad.settings.js';
import { PersonaRepository } from '#modules/personas/persona.repository.js';
import { PersonaNotesRepository } from '#modules/personas/persona.notes.repository.js';
import type { PersonaNotesForPrompt } from '#modules/personas/persona.note.js';
import { PersonaStoriesRepository } from '#modules/personas/persona.stories.repository.js';
import type { PersonaStoryForPrompt } from '#modules/personas/persona.story.js';
import { preoccupationOf, storytellingOf } from '#modules/personas/persona.sheet.js';
import type { Persona } from '#modules/personas/persona.js';
import { ScriptHistoryRepository } from '#modules/render/script.history.repository.js';
import { SegmentRepository, type PadHit } from '#modules/render/segment.repository.js';
import { SpeechService } from '#modules/render/speech.service.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { BreakRequestRepository } from './break.request.repository.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { isRenderedFirst, priorityForUrgency, type StoredBreakRequest } from './break.request.js';
import { BulletinSource } from './bulletin.source.js';
import { WeatherSource } from './weather.source.js';
import type { BreakTrack, PlayedRecord, WrittenBreak } from './break.writer.js';
import { dayGreeting, dayPart, roughTime, stationZone } from './clock.words.js';
import { BreakWriterRegistry, declineText, isWritten, type BreakWriteResult } from './break.writer.registry.js';
import { TALK_BREAK_SHAPE } from './break.prompt.js';
import { DETERMINISTIC_WRITER, TALK_BREAK_KIND } from './talk.break.writer.js';
import { STORY_KIND, STORY_SHAPE } from './story.break.writer.js';
import { isTrackItem, type StationLineup } from './station.lineup.js';
import { StationLineupRepository } from './station.lineup.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import { rotationOf } from '#modules/shared/rotation.js';

/** How many recent scripts a writer is shown, so it can avoid repeating itself. */
const RECENT_WINDOW = 6;

/**
 * How many of this broadcast's records a writer is shown.
 *
 * Small, and the size is the whole argument. This is a hint that there IS a show behind the current
 * record, not a playlist to work through: a model handed twelve titles reads them out, which is the
 * listing-with-decoration failure `BreakPromptShape.rules` carries "make one point" to stop. A model
 * that genuinely wants the rest can call `show_so_far`, which answers up to forty and costs its own
 * context rather than every station's — the same split `StationTasteTool` and its prompt block
 * already run between them.
 *
 * The other bound is the host: a context that spills VRAM drops the station's model to a couple of
 * tokens a second, which is a slow break rather than a rich one.
 */
const PLAYED_WINDOW = 5;

/**
 * Which kinds of break may carry one of the character's own stories, and on what terms.
 *
 * Built from the SHAPES themselves rather than written out again, so this job cannot hold a second
 * opinion about whether a talk break offers a story or insists on one. What it does decide is
 * MEMBERSHIP: a kind absent from here is asked for no story at all, which keeps a bulletin from
 * spending one it would never have been allowed to render.
 *
 * See `WriteBreakJob.story` for why the decision lives at this end rather than in the prompt.
 */
const STORY_MODES = new Map<string, 'offered' | 'told'>(
    (
        [
            [TALK_BREAK_KIND, TALK_BREAK_SHAPE.stories],
            [STORY_KIND, STORY_SHAPE.stories],
        ] as const
    ).flatMap(([kind, mode]) => (mode === undefined ? [] : [[kind, mode] as const])),
);

/** Whether every record this break was shown came with nothing to say about it. See {@link WriteBreakJob.story}. */
const nothingKnownAbout = (neighbours: Neighbours): boolean =>
    [neighbours.previous, neighbours.next].every(side => side === undefined || (side.track.facts?.length ?? 0) === 0);

/**
 * The one preoccupation this break is offered, spread over the segment id.
 *
 * A free function and not a method, because unlike the notebook, the story and the pads beside it
 * this reads nothing: the list is already on the sheet the caller is holding. That is also why it is
 * attached to every break regardless of kind — there is no rotation to spend and no query to waste,
 * so the veto can live entirely in `BreakPromptShape.allowsPreoccupation` instead of being a rule
 * this job holds a second copy of.
 *
 * Answers `{}` rather than `{ preoccupation: undefined }` so a character with an empty list produces
 * a request byte-identical to one from before the field existed.
 */
function preoccupation(persona: Persona | undefined, segmentId: string): { preoccupation?: string } {
    const chosen = preoccupationOf(persona, segmentId);
    return chosen === undefined ? {} : { preoccupation: chosen };
}

export interface WriteBreakPayload {
    /**
     * Which segment to write.
     *
     * Optional in the type and required in practice: a job registration is typed against a payload
     * the broker may deliver as `{}`. The run guards on it instead.
     *
     * It does not name a running order, because there is only one and the director owns it.
     */
    segmentId?: string;
}

/**
 * Write the words for a break the station means to say.
 *
 * The slow half of planting one. `BreakPlanner` puts the segment row and its place in the running
 * order down synchronously, because that is what keeps planting idempotent — the next pass over the
 * order sees the gap filled and plants nothing — and everything after it happens here, where nobody
 * is waiting.
 *
 * ## Two shapes of break reach this, and only one of them has a position
 *
 * A PLANTED break is in the running order before this job is sent, and its neighbours are what it is
 * about. A break something urgently REQUESTED is the inversion: `interrupt` and `next` are rendered
 * before they are injected, so `BreakPlanner.prepareRequested` deliberately gives the segment no
 * position at all and `DirectorService.injectReady` finds it one once the audio exists. Both send
 * this job, and the difference between them is the whole of why the guard below asks a second
 * question before it defers — reading absence from the order as "too early" is right for the first
 * and silently fatal for the second, which never appears in the order and is never re-offered.
 *
 * Nobody is waiting in the strong sense: a segment that is not `ready` when it comes round is
 * SKIPPED, never held for. So a writer that is slow, a model that is down, or this job never running
 * at all costs the station a break and never silence. That is the rule the whole design rests on and
 * the reason this can be a background job with no deadline.
 *
 * A plain `Job` rather than a `TransactionalJob`, following `ExtendLineupJob` and
 * `RenderSegmentJob`: the writes are one row each and a model binding later will be slow enough that
 * pinning a runtime-pool connection across it would be a real cost.
 *
 * ## Why it re-reads the running order
 *
 * The neighbours are derived here rather than carried in the payload, because between planting and
 * writing an operator can move a line, the director can commit, and a refill can append. A payload
 * snapshot would have the station back-announcing a record it did not play, which is the one mistake
 * a listener can catch it out in. Reading the order now costs one query and is always current.
 */
@Injectable()
export class WriteBreakJob extends PlainJob<WriteBreakPayload> {
    constructor(
        private readonly order: StationLineupRepository,
        private readonly segments: SegmentRepository,
        private readonly requests: BreakRequestRepository,
        private readonly history: ScriptHistoryRepository,
        private readonly writers: BreakWriterRegistry,
        private readonly enrichment: EnrichmentReadService,
        private readonly bulletin: BulletinSource,
        /** The bulletin's opposite number, for the kind of break that says what it is like outside. */
        private readonly weather: WeatherSource,
        private readonly personas: PersonaRepository,
        // The rack, read once per break beside the persona that names it. See {@link pads}.
        private readonly padRepository: PadRepository,
        private readonly notes: PersonaNotesRepository,
        private readonly stories: PersonaStoriesRepository,
        private readonly plays: PlayHistoryRepository,
        private readonly identity: StationIdentity,
        private readonly speech: SpeechService,
        private readonly activity: ActivityRecorder,
        private readonly jobs: PgBossJobBroker,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: WriteBreakPayload): Promise<void> {
        if (!payload?.segmentId) {
            // A caller's bug rather than a station fault: this job is only ever sent.
            this.logger.warn('director: a break write was sent with nothing to write', { job: this.context.id });
            return;
        }
        const { segmentId } = payload;

        const lineup = await this.order.load();
        if (lineup === undefined) {
            await this.claimAndFail(segmentId, 'the running order this break was planted into is gone');
            return;
        }

        // BEFORE the claim, and this order matters more than it looks. The director writes the
        // running order through a throttle, so a break can be planted, offered and picked up here
        // within the same second — before the row anybody can read holds it. Claiming first would
        // then write a break that knows about neither of its neighbours and, having consumed the
        // claim, would never be offered again. That is a station whose every talk break is reduced
        // to saying its own name, which is exactly what it looked like when it happened.
        //
        // So: not being in the order yet is not a failure, it is being early. The row stays
        // `planned` and the next pass offers it again, by which time the write-through has landed.
        //
        // Unless it is a break that WANTS no position, which is the other shape described on the
        // class. That question is asked only on this branch, so an ordinary planted break — every
        // break on most stations — costs the walk above and no extra query at all.
        const found = neighboursOf(lineup, segmentId);
        const request = found === undefined ? await this.requestBehind(segmentId) : undefined;
        if (found === undefined && !(request !== undefined && isRenderedFirst(request.urgency))) {
            this.logger.info('director: this break is not in the running order yet, so it will be written on a later pass', {
                job: this.context.id,
                segment: segmentId,
            });
            return;
        }

        // A break with no position genuinely has no neighbours, which is a shape every writer
        // already answers for: it is the same pair a break at the head of an order is handed.
        const neighbours: Neighbours = found ?? {};

        // Claimed rather than read, so two runs cannot both write the same break: only one
        // `planned → writing` wins and the loser stops here. That is what makes a duplicate send
        // free, which is what lets the director offer every `planned` break in its window on every
        // boundary without having to remember which ones it has already asked for.
        //
        // Deleted, already claimed, already written, already rendering: all ordinary races, and all
        // the same answer to this job, which is that it is not ours to write.
        const segment = await this.segments.claimForWrite(segmentId);
        if (segment === undefined) {
            this.logger.info('director: nothing to write for this break', { job: this.context.id, segment: segmentId });
            return;
        }

        // Off the ROW rather than recomputed. The band that placed this break stamped what it was
        // placed for; `ripen` re-offers whatever is still planned and knows nothing about the
        // schedule, so by now this job is the only thing that could say what time it is writing
        // about — and asking the clock again here would answer with now, a quarter of an hour early.
        const zone = stationZone(this.config);
        const clock = segment.airsAt === undefined ? undefined : roughTime(segment.airsAt, zone);
        // Off the same instant as the clock, and offered to every kind: which breaks have any
        // business greeting anybody is the writer's own question, and answering it here would put a
        // decision about one kind of break in the job that serves all of them.
        const greeting = segment.airsAt === undefined ? undefined : dayGreeting(segment.airsAt, zone);
        // Off the same instant again, and offered for the same reason the greeting is. What it adds
        // over the greeting is the small hours, which is the one stretch of the day a greeting has
        // nothing for and a presenter has the most to say about; see `dayPart`.
        const part = segment.airsAt === undefined ? undefined : dayPart(segment.airsAt, zone);

        // After the claim, so a job that was merely early does no work at all, and for EVERY break
        // rather than only when a model might use them: what the station knows about a record is a
        // property of the moment, not of whichever binding takes it, and reading `llm.breakWriter`
        // here would make the substrate depend on a setting.
        await this.attachFacts(segmentId, neighbours);

        // This broadcast's own host where it named one, and the station's behind it. `undefined` is
        // an ordinary answer: a station that has chosen no persona writes exactly what it wrote
        // before personas existed.
        const persona = await this.personas.presenting(lineup.personaId);

        // What this break is about. Read off the row rather than carried in the payload, for the
        // reason the neighbours are: the row is the record, and a job re-sent after a restart has to
        // be able to find out what it is writing about.
        //
        // Two places it can come from, and they are two different producers rather than one with a
        // fallback: a REQUEST carries why something asked for this break, and the SEGMENT carries
        // what the format clock asked a planted one to be about. Merged with the request on top,
        // since a break that exists because something happened is described by that thing first.
        // Most breaks have neither.
        const asked = await this.requestFor(segment.requestId, request);
        const context = segment.context === undefined && asked?.context === undefined ? undefined : { ...segment.context, ...(asked?.context ?? {}) };

        // What a bulletin has to report, for the kinds that report. `undefined` for every other
        // kind, which is how the branch about news stays inside a file about news: this job serves
        // every kind and knowing which of them read the headlines is not its business. Fetched
        // AFTER the claim for the facts' reason — a job that was merely early does no work at all —
        // and against the moment the break was placed for rather than now, so a bulletin written a
        // quarter of an hour early is judged fresh against the slot it will actually air in.
        const bulletin = await this.bulletin.storiesFor(segment.kind, context, segment.airsAt ?? Date.now());

        // The same arrangement for the kind that reports a PLACE rather than an event, and
        // `undefined` for every other kind for the same reason: asking a weather service costs a
        // request, and a talk break that wants to mention the weather reaches `get_weather` itself.
        //
        // Against the same instant as the bulletin above, and it was the only call in this file that
        // did not know one. A reading is a statement about the present with a shelf life, so which
        // moment it has to be true AT is the slot rather than now — the two sources ask the same
        // question of their substrate and must not answer it differently.
        const forecast = await this.weather.readingFor(segment.kind, context, segment.airsAt ?? Date.now());

        // The two sources cannot both answer, because each refuses every kind but its own, so this
        // reads as a chain rather than a merge.
        const subject = bulletin?.subject ?? forecast?.subject;

        const result = await this.writers.write({
            kind: segment.kind,
            ...(clock === undefined ? {} : { clock }),
            ...(greeting === undefined ? {} : { greeting }),
            ...(part === undefined ? {} : { dayPart: part }),
            // The same instant a fourth time, and the only one of the four nothing is TOLD. The three
            // above are the moment as words, which is what a model can use; this is the moment as a
            // number, which is what a guard needs to catch a script naming a point in the day rather
            // than a half of one. See `namesWrongTimeOfDay`.
            ...(segment.airsAt === undefined ? {} : { moment: { at: segment.airsAt, zone } }),
            ...(context === undefined ? {} : { context }),
            ...(bulletin === undefined ? {} : { stories: bulletin.stories }),
            ...(forecast?.reading === undefined ? {} : { weather: forecast.reading }),
            // What the format clock asked this break to be ABOUT, resolved out of the context above
            // by the thing that owns the kind's substrate. A writer reads it here rather than
            // digging the key out of `context` itself, so the model binding and the floor cannot
            // resolve it differently.
            ...(subject === undefined ? {} : { subject }),
            ...(neighbours.previous === undefined ? {} : { previous: neighbours.previous.track }),
            ...(neighbours.next === undefined ? {} : { next: neighbours.next.track }),
            station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
            ...(await this.memory(segment.kind)),
            // Read here rather than held by any writer, for the reason the facts above are: the
            // character the station is in is a property of the moment, and every binding uses a
            // different half of it. Read per break, so an operator putting a different persona on
            // air hears it on the next one rather than after a restart.
            ...(persona === undefined ? {} : { persona }),
            // What this character has accumulated, read here for the persona's own reason and rested
            // here for a sharper one: the rotation belongs to whatever is actually going on air, and
            // a writer that fetched its own would spend it again on every binding that was asked.
            ...(await this.notebook(persona?.key)),
            // Read here and RESTED here, for the notebook's reason and one of its own: the rung that
            // decides whether this break gets a story at all is applied in the same step as the
            // stamp, or the store fills up with tellings nobody heard. See `story`.
            ...(await this.story(persona, segment.kind, neighbours)),
            // What the engine that will speak this can do beyond reading. Read here for the notebook's
            // reason and answered once, so every binding asked for this break agrees about what was on
            // offer — and so a station that changed engine between two breaks writes for the one that
            // is installed now.
            ...(await this.reactions()),
            // The other half of what is on offer, and it comes from the other side entirely: a
            // reaction is a property of the engine and a pad is a property of the CHARACTER. Read
            // here rather than inside a writer for the reactions' own reason — one answer per break,
            // so every binding asked agrees about what this presenter had to hand.
            ...(await this.pads(persona)),
            // The one subject this character has had on its mind, spread over the segment id so two
            // breaks in a row are about different things and a re-offered break is about the same
            // one. Attached whatever the kind is, because choosing costs nothing and spends nothing:
            // which kinds are TOLD is `BreakPromptShape.allowsPreoccupation`, one file over, exactly
            // as the pads above are offered here and vetoed there.
            ...preoccupation(persona, segment.id),
            // What this break's words are worth at the one model slot. Absent for a planted break,
            // which is the gate's `air` default: it has a deadline like everything on air, and no
            // claim to jump the ones in front of it. A REQUESTED break is worth what its urgency
            // says, and `priorityForUrgency` is the only place that judgement is made — an
            // `interrupt` or a `next` exists because something happened and its moment does not come
            // round again, so it goes in front of the station's routine talk.
            ...(asked === undefined ? {} : { priority: priorityForUrgency(asked.urgency) }),
            // When this is due, so a model binding can work out how long it can afford to queue.
            // Absent for an ordinary planted break, which `patienceFor` answers with the default.
            ...(segment.airsAt === undefined ? {} : { airsAt: segment.airsAt }),
        });

        // Before the row is touched, and before any early return below, so an attempt is recorded
        // whichever way this goes. What the station TRIED is as much of the record as what it said.
        await this.remember(segmentId, segment.kind, neighbours, result, persona?.key);

        if (!isWritten(result)) {
            // Not an error and not logged as one: a break nothing had anything to say for is a break
            // the station does not take, and the reason is on the row for whoever asks why.
            await this.fail(segmentId, result.reason ?? `nothing wrote this ${segment.kind}`);
            return;
        }

        // `result.writer` rather than a constant: which writer produced this is the registry's
        // answer, and once a kind has more than one of them the job cannot know which one spoke.
        //
        // The claim is stamped only when the words actually named the next record, and it names the
        // LINE rather than the track: the same record can sit in an order twice, and what was
        // promised is the one at that position. See `segments.claims_item_id`.
        const claimsItemId = result.written.claimsNext === true ? neighbours.next?.itemId : undefined;

        // The voice is offered only when the ROW has none. A segment planned by hand through
        // `POST /segments` may name one, and that is an operator's explicit instruction rather than
        // a default to recompute — while a break the station planted for itself should be spoken by
        // whoever the station currently is. Decided here, with the words, so a persona swapped
        // before the render cannot have this sentence read out by a different character.
        const voice = segment.voice ?? persona?.voice;

        // What the script actually hit, resolved HERE because here is the only place the presenting
        // character's board is in hand. See `segments.pads`: a pad name is unique per board and not
        // across the station, so a renderer resolving `[sfx:airhorn]` for itself would have to ask
        // who is presenting NOW — which after a recast is somebody else with a different rack, and
        // the sound joined would not be the one the words were written for.
        // The FLOOR runs first, because it can only ever change a script that hit nothing — so what
        // `hits` resolves below is the finished words either way, whoever decided them.
        const script = await this.floorPad(result, persona, segment.kind);
        const pads = await this.hits(script, persona);

        if (
            !(await this.segments.writeScript(segmentId, {
                ...result.written,
                // The floor may have added a hit, so this is the script rather than the writer's own.
                script,
                writer: result.writer,
                ...(claimsItemId === undefined ? {} : { claimsItemId }),
                ...(persona === undefined ? {} : { personaId: persona.id }),
                ...(voice === undefined ? {} : { voice }),
                pads,
            }))
        ) {
            // The row moved out of `planned` while this was being written. Whoever moved it owns it.
            this.logger.info('director: a break was written after something else had claimed it', { job: this.context.id, segment: segmentId });
            return;
        }

        // Last, and deliberately: a render that ran before the script was committed would claim a
        // segment with nothing to say and fail it. If this send fails the row survives as a written
        // `planned` segment, which an operator can ask for again.
        await this.jobs.send('render.segment', { segmentId });
        this.logger.info('director: wrote a break', {
            job: this.context.id,
            segment: segmentId,
            label: result.written.label,
            writer: result.writer,
            // Only when something DID decline, so the ordinary line stays short. A break that took
            // two writers is the interesting one, and it is invisible from the row alone: the row
            // records who won and says nothing about who was asked first.
            ...(result.attempts.length > 1 ? { declined: result.attempts.slice(0, -1).map(attempt => attempt.reason) } : {}),
        });

        // Only the fall-through reaches the feed, for the same reason only a declining attempt
        // reaches the log line above: a break the first writer produced is the ordinary case and a
        // line per break would bury everything else. What is worth keeping is the pair of facts the
        // registry exists to answer with — that a writer was asked and declined, and that the floor
        // covered for it — because the second alone reads as a station that never had a model.
        //
        // `segments.writer` says who won and cannot say who was asked, which is why this is not
        // derivable from the row afterwards.
        if (result.attempts.length > 1) {
            const declined = result.attempts.slice(0, -1);
            void this.activity.record({
                module: 'render',
                kind: 'break.degraded',
                detail: `A break fell through to the ${result.writer} writer: ${declined.map(declineText).join('; ')}.`,
                data: {
                    segmentId,
                    wrote: result.writer,
                    declined: declined.map(attempt => ({ writer: attempt.writer, outcome: attempt.outcome, durationMs: attempt.durationMs })),
                },
            });
        }
    }

    /**
     * The request this break is being made for, or `undefined` for one the station planted itself.
     *
     * Asked only of a segment the running order does not hold, which is what keeps it off the path
     * every ordinary break takes. Two indexed reads, and both are worth it there: the alternative is
     * a welcome that is never written because it was mistaken for one written too soon.
     *
     * A read that FAILS answers `undefined`, which defers rather than writes. That is the safe way
     * round: deferring a break that should have been written costs it one pass, and writing one that
     * really was early costs every talk break its neighbours.
     */
    private async requestBehind(segmentId: string): Promise<StoredBreakRequest | undefined> {
        try {
            const segment = await this.segments.findById(segmentId);
            if (segment?.requestId === undefined) return undefined;

            return await this.requests.findById(segment.requestId);
        } catch (error) {
            this.logger.warn(`director: could not tell whether this break is waiting for a slot (${errorText(error)})`);
            return undefined;
        }
    }

    /**
     * What the station remembers of the show it is in the middle of.
     *
     * Two reads, both keyed by the BROADCAST rather than by a time window, because "what have we
     * played tonight" and "what have we already said" are questions about a programme: a window
     * answers them with the tail of the previous show whenever one has just started, which is a
     * presenter referring back to something this audience never heard.
     *
     * **The fallback is not a nicety.** A break written while no broadcast is on has no show to
     * remember, so `recent` falls back to what it always was — the last few scripts of this kind —
     * rather than to nothing. Handing an empty list would quietly disarm the spent-signature rule,
     * and a writer that repeats a catchphrase because nothing told it not to is the exact failure
     * `characterFault` exists for.
     *
     * Best-effort in the same sense the facts are: memory makes a break better and never makes it
     * possible, so a read that fails costs the recall rather than the break. The deterministic floor
     * underneath never wanted any of it.
     */
    private async memory(kind: string): Promise<{ recent: readonly string[]; played?: readonly PlayedRecord[] }> {
        const broadcastId = this.identity.current();
        if (broadcastId === undefined) return { recent: await this.segments.recentScripts(kind, RECENT_WINDOW) };

        try {
            const [recent, played] = await Promise.all([
                this.history.spokenDuring(broadcastId, RECENT_WINDOW),
                this.plays.duringBroadcast(broadcastId, PLAYED_WINDOW),
            ]);

            return { recent, ...(played.length === 0 ? {} : { played }) };
        } catch (error) {
            this.logger.warn(`director: could not read what the station has said this broadcast (${errorText(error)})`);
            return { recent: await this.segments.recentScripts(kind, RECENT_WINDOW) };
        }
    }

    /**
     * The request this break is being written for, without reading the row twice.
     *
     * {@link requestBehind} has already fetched it on the one path that runs, so this is a lookup
     * only for a break that WAS in the order — which is every planted break, and none of them has a
     * request at all.
     *
     * Answers the whole row rather than only its context, because two things are read off it now:
     * what the break is about, and how much the model slot is worth to it. Keeping them one lookup
     * is the point of the method.
     */
    private async requestFor(requestId: string | undefined, known: StoredBreakRequest | undefined): Promise<StoredBreakRequest | undefined> {
        if (requestId === undefined) return undefined;
        if (known?.id === requestId) return known;

        return await this.requests.findById(requestId);
    }

    /**
     * Put whatever the station knows about these two records onto them, in place.
     *
     * Best-effort in the same sense `remember` below is: a fact is what makes a break better and
     * never what makes it possible, so a read that fails costs the facts and the break is written
     * without them. The floor writer never wanted them in the first place.
     *
     * The rotation is the segment id, which is stable for this break and different for the next
     * one: an artist who comes round twice in an evening gets a different sentence the second time
     * without anything having to remember the first.
     */
    private async attachFacts(segmentId: string, neighbours: Neighbours): Promise<void> {
        const sides = [neighbours.previous, neighbours.next].filter((side): side is Neighbour => side !== undefined);
        const trackIds = sides.map(side => side.track.trackId).filter((trackId): trackId is string => trackId !== undefined);
        if (trackIds.length === 0) return;

        try {
            const facts = await this.enrichment.factsForTracks(trackIds, rotationOf(segmentId));
            for (const side of sides) {
                const found = side.track.trackId === undefined ? undefined : facts.get(side.track.trackId);
                if (found !== undefined && found.length > 0) side.track = { ...side.track, facts: found };
            }
        } catch (error) {
            this.logger.warn(`director: could not read what the station knows about these records (${errorText(error)})`);
        }
    }

    /**
     * What this character has settled into, and what it has said on this station before.
     *
     * Empty for a station presenting as nobody, which is an ordinary state and the one every fresh
     * install is in.
     *
     * The notes are RESTED here, at selection, which is the same inaccuracy `chooseFacts` buys and
     * bought against the same alternative: a break dropped before its slot has still spent its notes,
     * and the only way to do better is a second writer of `last_used_at` that can disagree with this
     * one. What it buys is that the rotation belongs to the moment rather than to whichever binding
     * happened to be asked — a model that declined and a floor that could not read a note either way
     * have between them still used this character's turn.
     *
     * Best-effort, like the facts and the broadcast's memory above it: a notebook that could not be
     * read costs the notebook and never the break.
     */
    /**
     * What the engine that will speak this break can do beyond reading words.
     *
     * Asked of the render side rather than assumed, because the answer belongs to whichever plugin is
     * installed and, on at least one engine, to which model it currently holds. A break planned an
     * hour ago and written now should be written for the engine that is going to say it.
     *
     * Best-effort like the notebook above, and the empty answer is the safe one twice over: a prompt
     * that offers nothing simply reads as it did before any of this existed, and the render path
     * removes an unperformable reaction on its own. So this can afford to be quiet, and does not
     * warn — a station whose engine only reads words would otherwise log a line per break forever.
     */
    private async reactions(): Promise<{ reactions?: readonly SpeechCue[] }> {
        try {
            const cues = await this.speech.cues();
            return cues.length === 0 ? {} : { reactions: cues };
        } catch (error) {
            this.logger.debug(`director: could not ask what the engine can perform (${errorText(error)})`);
            return {};
        }
    }

    /**
     * A soundboard hit added to a break the FLOOR wrote, when one is due. Answers the script either way.
     *
     * ## Why only the floor
     *
     * A model shown the rack and choosing not to reach for it has made a judgement about its own
     * sentence, and appending a sound to the end of words somebody else shaped is the two-rules-that-
     * disagree failure this prompt spends most of its length avoiding. A template writer is the
     * opposite case: `BreakWriteRequest.pads` is documented as unread by every deterministic writer,
     * so it was never offered the choice and there is no judgement here to override.
     *
     * That is also what keeps the guarantee the whole registry is built on. The floor cannot fail, so
     * whatever this does has to be incapable of failing: it appends a marker to a string, and the
     * render path treats a hit it cannot resolve as a break that airs as words.
     *
     * ## Where it goes, and why the end is the only honest answer
     *
     * At the end. A phrasing is a sentence an operator typed and nothing here knows where its beat
     * falls — dropping a rimshot into the middle of somebody's template would be guessing at comic
     * timing on their behalf. After the words is a sting, which is a thing radio actually does.
     *
     * The pad is the least recently hit, which is what `PadRepository.onBoard` already orders by, so
     * this takes the first and does not sort again.
     */
    private async floorPad(result: { written: WrittenBreak; writer: string }, persona: Persona | undefined, kind: string): Promise<string> {
        const script = result.written.script;
        if (result.writer !== DETERMINISTIC_WRITER) return script;

        // The ordinary talk break ALONE, which is the same veto `BreakPromptShape.allowsPads` puts
        // on the model's offer, re-expressed here because the floor never goes near a shape.
        //
        // It shipped without this and a bulletin ended "Then, UFO. [sfx:rimshot]" — twice, on air.
        // Which is precisely what `NEWS_SHAPE.allowsPads: false` exists to prevent, arriving through
        // the one door that flag does not cover: the offer is what a shape governs, and the floor
        // makes no offer, it just appends.
        //
        // Keyed on the kind rather than on a shape lookup because there is no kind-to-shape registry
        // and inventing one for this would be a second place the veto lives. A kind that later wants
        // a sting says so here.
        if (kind !== TALK_BREAK_KIND) return script;

        const board = persona?.soundboard;
        if (board === undefined || !padsAreOn(this.config)) return script;

        // Zero is the operator switching the floor off while leaving the model free to reach for one.
        const every = padEveryBreaks(this.config);
        if (every === 0) return script;

        // A template cannot have written one, so this is belt and braces rather than a real branch —
        // and it is what keeps the rule true if a deterministic writer ever does learn to.
        if (padsIn(script).length > 0) return script;

        try {
            const rack = await this.padRepository.onSet(board);
            if (rack.length === 0) return script;

            const since = await this.segments.breaksSincePad();
            if (since < every) return script;

            // Least recently hit, which is the order the read already answers in.
            return `${script} ${padCue(rack[0]!.name)}`;
        } catch (error) {
            // The floor cannot fail. A rack that could not be read costs the break its sting.
            this.logger.debug(`director: could not decide whether to hit a pad (${errorText(error)})`);
            return script;
        }
    }

    /**
     * The pads a finished script hits, resolved against the board that offered them, and RESTED.
     *
     * Where {@link pads} above is the offer, this is the spend, and the split is the same one the
     * notebook makes: a character's turn is used when something is actually chosen, and until the
     * model answers nothing has been. So the rest happens here, at selection, which is the
     * inaccuracy `chooseFacts` documents — a break dropped before its slot has still rested its pad,
     * and the alternative is a second writer of `last_used_at` that can disagree with this one.
     *
     * A name that resolves to nothing is DROPPED rather than failing the break, which is the same
     * bargain `keepPads` already struck one layer up: this is the narrow window where the board
     * changed between the offer and the answer, and the words are fine — they are just going to air
     * without their sound.
     *
     * Best-effort as a whole, like everything else read here: a rack that could not be reached costs
     * the break its noise and never the break.
     */
    private async hits(script: string, persona: Persona | undefined): Promise<PadHit[]> {
        const board = persona?.soundboard;
        if (board === undefined) return [];

        const names = padsIn(script);
        if (names.length === 0) return [];

        try {
            const hits: PadHit[] = [];
            for (const name of names) {
                const pad = await this.padRepository.named(board, name);
                if (pad === undefined) {
                    this.logger.info('director: a break hit a pad the board no longer holds', { job: this.context.id, board, pad: name });
                    continue;
                }

                hits.push({ name, padId: pad.id });
                await this.padRepository.markUsed(pad.id);
            }
            return hits;
        } catch (error) {
            this.logger.warn(`director: could not resolve a soundboard hit (${errorText(error)})`);
            return [];
        }
    }

    /**
     * What is on this presenter's soundboard, or nothing at all.
     *
     * Best-effort exactly like {@link reactions} above it, and quiet for the same reason: most
     * characters have no board, so a warning here would be a line per break forever on a station
     * that is working correctly.
     *
     * Two absences that mean the same thing and must not be told apart by anything downstream: a
     * persona with no `soundboard`, and one naming a SET that holds nothing — or that does not exist
     * at all, which `onSet` answers identically and deliberately. All three are a presenter with
     * nothing to hit, and the prompt says nothing about pads either way — see
     * `padRules`, which is omitted entirely rather than saying "you have no sound effects".
     *
     * Nothing is RESTED here, which is where this differs from the notes and the story beside it. A
     * pad is spent when one is actually chosen, and the model has not chosen yet: this is the offer.
     * `RenderSegmentJob` is what marks the hit, because it is what reads the answer back.
     */
    private async pads(persona: Persona | undefined): Promise<{ pads?: readonly string[] }> {
        if (persona?.soundboard === undefined) return {};

        try {
            const rack = await this.padRepository.onSet(persona.soundboard);
            return rack.length === 0 ? {} : { pads: rack.map(pad => pad.name) };
        } catch (error) {
            this.logger.debug(`director: could not read the soundboard (${errorText(error)})`);
            return {};
        }
    }

    /**
     * The one story this break may draw on, chosen and rested here.
     *
     * ## The rung is applied HERE, and that is the whole reason this is not in the prompt builder
     *
     * A story's turn is spent by reading it, because {@link PersonaStoriesRepository.markTold} is
     * what comes next. So a rung consulted at RENDER time would have this method spending a story on
     * every break under `occasionally` and the prompt then quietly dropping most of them — a store
     * reporting tellings nobody heard, and a "you have told this before" rule firing over breaks
     * that never carried it. The decision and the stamp have to be the same step.
     *
     * ## What each kind may have, from the shapes themselves
     *
     * {@link STORY_MODES} maps a kind to what its shape declares, rather than this job holding a
     * second opinion about which breaks tell stories. A kind that is not in it gets none — which is
     * every kind but two, and for a BULLETIN that is an argument rather than an omission: see
     * `BreakPromptShape.stories`.
     *
     * ## `occasionally` is keyed on the same fact the prompt is
     *
     * "The station knows nothing about this record" is the moment the default rung fires in, because
     * that paragraph hands a model a prohibition and nothing else, and what filled that silence when
     * it was measured was invented pressing plants. Judged on the facts already attached to the
     * neighbours, so it is the same fact the prompt would state.
     *
     * Best-effort, like the notebook and the facts: a story that could not be read costs the story
     * and never the break.
     */
    private async story(persona: Persona | undefined, kind: string, neighbours: Neighbours): Promise<{ story?: PersonaStoryForPrompt }> {
        if (persona === undefined) return {};

        const mode = STORY_MODES.get(kind);
        if (mode === undefined) return {};

        if (mode === 'offered') {
            const rung = storytellingOf(persona);
            if (rung === 'never') return {};
            // Every record the break was shown carries something to say, so there is no silence for
            // a story to fill. A break with no records at all is not one of these kinds.
            if (rung === 'occasionally' && !nothingKnownAbout(neighbours)) return {};
        }

        try {
            const found = await this.stories.forPrompt(persona.key);
            if (found === undefined) return {};

            await this.stories.markTold(found.id);
            return { story: found.story };
        } catch (error) {
            this.logger.warn(`director: could not read this character's own stories (${errorText(error)})`);
            return {};
        }
    }

    private async notebook(personaKey: string | undefined): Promise<{ notebook?: PersonaNotesForPrompt }> {
        if (personaKey === undefined) return {};

        try {
            const { notes, ids } = await this.notes.forPrompt(personaKey);
            if (ids.length === 0) return {};

            await this.notes.markUsed(ids);
            return { notebook: notes };
        } catch (error) {
            this.logger.warn(`director: could not read what this character has accumulated (${errorText(error)})`);
            return {};
        }
    }

    /**
     * Write down every writer that was asked and what it said.
     *
     * Best-effort, and the `catch` is the whole point: nothing reads this table to decide anything,
     * so a history write that fails must cost a row and never the break it was describing. The same
     * trade `segment_events` makes, for the same reason.
     *
     * Every attempt, not only the winner. A model that declined and a floor that covered for it are
     * two facts, and the second on its own reads as a station that never had a model configured.
     *
     * The persona key goes on EVERY attempt, including the ones that declined, because who was
     * presenting is a fact about the moment rather than about the writer that won it: a character
     * whose model breaks are all being refused is exactly the thing this column exists to make
     * visible, and stamping only the winner would hide it behind the floor.
     */
    private async remember(segmentId: string, kind: string, neighbours: Neighbours, result: BreakWriteResult, personaKey?: string): Promise<void> {
        if (result.attempts.length === 0) return;

        try {
            await this.history.recordAll(
                result.attempts.map(attempt => ({
                    segmentId,
                    kind,
                    writer: attempt.writer,
                    outcome: attempt.outcome,
                    durationMs: attempt.durationMs,
                    ...(personaKey === undefined ? {} : { personaKey }),
                    ...(neighbours.previous === undefined ? {} : { previous: neighbours.previous.track }),
                    ...(neighbours.next === undefined ? {} : { next: neighbours.next.track }),
                    ...(attempt.written === undefined ? {} : { script: attempt.written.script, label: attempt.written.label }),
                    ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
                    // Whatever the writer wanted kept about how it got there: the model, the token
                    // counts, and — only while the operator has asked for them — the prompt and the
                    // answer before the station tidied it.
                    ...(attempt.detail?.model === undefined ? {} : { model: attempt.detail.model }),
                    ...(attempt.detail?.source === undefined ? {} : { source: attempt.detail.source }),
                    ...(attempt.detail?.usage === undefined ? {} : { usage: attempt.detail.usage }),
                    ...(attempt.detail?.prompt === undefined ? {} : { prompt: attempt.detail.prompt }),
                    ...(attempt.detail?.raw === undefined ? {} : { raw: attempt.detail.raw }),
                })),
            );
        } catch (error) {
            this.logger.warn(`director: could not record what was written (${errorText(error)})`);
        }
    }

    /**
     * Leave the reason where an operator will look for it, rather than in a log line that scrolls.
     *
     * From `writing`, because this is only ever reached for a break this job has claimed.
     */
    private async fail(segmentId: string, reason: string): Promise<void> {
        await this.segments.markFailed(segmentId, reason, 'writing');
        this.logger.info('director: a break went unwritten', { job: this.context.id, segment: segmentId, reason });
    }

    /**
     * Give up on a break that has no running order to be written into.
     *
     * The one failure that happens BEFORE the claim, so it takes the claim on its way past. A row
     * left `planned` here would be offered again on every pass by a director whose order is gone,
     * which is a loop; failing it says why, once, where an operator will find it.
     */
    private async claimAndFail(segmentId: string, reason: string): Promise<void> {
        if ((await this.segments.claimForWrite(segmentId)) === undefined) return;
        await this.fail(segmentId, reason);
    }
}

/**
 * The records either side of a break, as the order stands now.
 *
 * Nearest record in each direction rather than strictly adjacent lines, so a break planted next to
 * another segment still knows what music it sits between. Either side may be absent, at the head or
 * the tail of an order, and that is a shape the writers already answer for.
 *
 * `undefined` for a break the order does not hold AT ALL, which is a different answer entirely and
 * the reason this does not just return an empty pair: a break with no neighbours is one at the edge
 * of an order, and a break the order has never heard of is one whose position this cannot speak for.
 * Answering the same thing for both is how every talk break ends up saying only the station's name.
 *
 * Which of the two reasons a break is absent for — too early, or not placed yet on purpose — is a
 * question about the REQUEST behind it and not about the order, so it is answered by the caller.
 */
function neighboursOf(lineup: StationLineup, segmentId: string): Neighbours | undefined {
    const items = lineup.all();
    const at = items.findIndex(item => item.kind === 'segment' && item.segmentId === segmentId);
    if (at < 0) return undefined;

    const nearest = (from: number, step: number, adjacentOnly = false): Neighbour | undefined => {
        for (let index = from; index >= 0 && index < items.length; index += step) {
            const item = items[index]!;
            // Something else between the break and the record: for a back-announce that is fine,
            // because what already played is a fact and stays one whatever sits in between. For the
            // record COMING UP it is not, and the caller asks for the adjacent line only.
            if (!isTrackItem(item)) {
                if (adjacentOnly) return undefined;
                continue;
            }

            // A record nobody will hear is not a neighbour. It matters most on the FORWARD side and
            // most of all on a rewrite: this job is re-offered precisely because the record a break
            // promised was taken out of the order, so reading the line anyway would have it promise
            // the same dead record a second time. Backwards it is the same rule for the same
            // reason — a back-announce of a record that never played is the worse half of the same
            // mistake — and the walk simply carries on to the record that did.
            if (item.state === 'unavailable' || item.state === 'skipped' || item.state === 'removed') {
                if (adjacentOnly) return undefined;
                continue;
            }

            return {
                itemId: item.id,
                track: {
                    title: item.track.title,
                    // The item's LEAD, never `artists[0]`, which `RundownItem.artists` prohibits in
                    // as many words: half the producers here only ever have the credit as one
                    // string, so a resolved collaboration carries "USHER, Lil Jon, Ludacris" in a
                    // single element. Reading position zero therefore announced the whole credit
                    // line for a resolved record and dropped every featured artist for a
                    // playlist-sourced one — the same words spoken differently depending on where
                    // the item came from. `||` rather than `??` because an item with no artist
                    // carries the empty string rather than `undefined`.
                    artist: item.track.artist || 'an unknown artist',
                    // Carried for what comes later rather than for anything today. See `BreakTrack`.
                    ...(item.track.trackId === undefined ? {} : { trackId: item.track.trackId }),
                },
            };
        }
        return undefined;
    };

    const previous = nearest(at - 1, -1);
    // The next record only when it is the very next LINE. An intervening segment is exactly the
    // region an operator is most likely to edit, and it may itself air or be skipped, so a promise
    // made across it is the least trustworthy kind there is. The cost is real and small: a break
    // planted beside another segment back-announces and promises nothing, which the writers already
    // have phrasings for and already choose when the next record is unknown. Withholding the record
    // IS withholding the claim, so nothing is invented and no writer has to change shape.
    const next = nearest(at + 1, 1, true);
    return {
        ...(previous === undefined ? {} : { previous }),
        ...(next === undefined ? {} : { next }),
    };
}

/** A record beside a break, and WHICH LINE of the order it is. */
interface Neighbour {
    itemId: string;
    track: BreakTrack;
}

interface Neighbours {
    previous?: Neighbour;
    next?: Neighbour;
}
