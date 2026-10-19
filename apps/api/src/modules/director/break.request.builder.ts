import { Injectable } from 'injectkit';
import type { SpeechCue, SpeechDelivery } from '@deadair/plugin-sdk';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EnrichmentReadService, type FactBudget } from '#modules/enrichment/enrichment.read.service.js';
import { padUseNotes, type PadUseNote } from '#modules/render/pad.cues.js';
import { padCanSting, PadRepository } from '#modules/render/pad.repository.js';
import { PersonaRepository } from '#modules/personas/persona.repository.js';
import { PersonaNotesRepository } from '#modules/personas/persona.notes.repository.js';
import type { PersonaNotesForPrompt } from '#modules/personas/persona.note.js';
import { PersonaStoriesRepository } from '#modules/personas/persona.stories.repository.js';
import { resolveThreadGapMs } from '#modules/personas/persona.thread.settings.js';
import type { PersonaStoryForPrompt } from '#modules/personas/persona.story.js';
import { occasionalQuirkOf, preoccupationOf, storytellingOf, triviaForBreak, TRIVIA_FACT_BUDGET } from '#modules/personas/persona.sheet.js';
import type { Persona } from '#modules/personas/persona.js';
import { ScriptHistoryRepository } from '#modules/render/script.history.repository.js';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { SpeechService } from '#modules/render/speech.service.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { BulletinSource } from './bulletin.source.js';
import { ChangeoverSource } from './changeover.source.js';
import { WeatherSource } from './weather.source.js';
import { AlmanacSource } from './almanac.source.js';
import { advisoryPolicy, speaksClean } from './advisory.policy.js';
import type { BreakTrack, BreakWriteRequest, PlayedRecord, SittingIn } from './break.writer.js';
import { CLOCK_KEYS, dayGreeting, dayPart, NAMES_THE_TIME_DEFAULT, roughTime, stationZone, weekday } from './clock.words.js';
import { TALK_BREAK_SHAPE } from './break.prompt.js';
import { TALK_BREAK_KIND } from './talk.break.writer.js';
import { STORY_KIND, STORY_SHAPE } from './story.break.writer.js';
import { isTrackItem, type StationLineup } from './station.lineup.js';
import { errorText } from '#modules/shared/error.text.js';
import { VocalMarkersReader } from '#modules/lyrics/vocal.markers.reader.js';
import { runwayFor } from '#modules/lyrics/vocal.runway.js';
import { resolveTalkUp, talkUpBudget } from './talk.up.js';
import { ABOUT_THE_RECORD_DEFAULT, ABOUT_THE_RECORD_KEYS } from './about.the.record.js';
import { LyricLabelsRepository } from '#modules/lyrics/lyric.labels.repository.js';
import { LyricsRepository } from '#modules/lyrics/lyrics.repository.js';
import { lyricLines } from '#modules/lyrics/lyric.subject.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { rotationOf } from '#modules/shared/rotation.js';

/** How many recent scripts a writer is shown, so it can avoid repeating itself. */
const RECENT_WINDOW = 6;

/**
 * How far back the station's memory of its own words reaches across a broadcast boundary.
 *
 * An hour, because that is about how long a listener stays, and a broadcast boundary is not an
 * audience boundary: a stand-down or a restart opens a new broadcast while the people who heard the
 * last one are still there. Bounded, because the other half of the old argument still holds: a
 * station coming back after a quiet night has nobody who heard last night's lines, and should start
 * with nothing spent rather than inheriting a ban from a programme nobody heard.
 */
const CARRY_WINDOW_MS = 60 * 60 * 1000;

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
 * Built from the SHAPES themselves rather than written out again, so this builder cannot hold a second
 * opinion about whether a talk break offers a story or insists on one. What it does decide is
 * MEMBERSHIP: a kind absent from here is asked for no story at all, which keeps a bulletin from
 * spending one it would never have been allowed to render.
 *
 * See `BreakRequestBuilder.story` for why the decision lives at this end rather than in the prompt.
 */
const STORY_MODES = new Map<string, 'offered' | 'told'>(
    (
        [
            [TALK_BREAK_KIND, TALK_BREAK_SHAPE.stories],
            [STORY_KIND, STORY_SHAPE.stories],
        ] as const
    ).flatMap(([kind, mode]) => (mode === undefined ? [] : [[kind, mode] as const])),
);

/**
 * Which kinds of break may be handed a keen presenter's wider read of the facts.
 *
 * {@link STORY_MODES}' shape and its reason: built from the shapes, so the builder holds no second
 * opinion about `BreakPromptShape.allowsTrivia`. A kind absent from here reads the ordinary budget
 * whoever is presenting, which keeps four notes out of a prompt whose notes paragraph still says
 * "never more than one".
 */
const TRIVIA_KINDS = new Set<string>(
    (
        [
            [TALK_BREAK_KIND, TALK_BREAK_SHAPE],
            [STORY_KIND, STORY_SHAPE],
        ] as const
    ).flatMap(([kind, shape]) => (shape.allowsTrivia === true ? [kind] : [])),
);

/**
 * How this break reads what the station knows about each record, and whether it is shown any of it.
 *
 * `budget` absent is the ordinary read. `withhold` is a presenter at `never`: the facts are read
 * unstamped, so the break still knows whether there was anything to say, and then kept from the
 * prompt. `one` is a presenter at `always`: code chooses the single fact the break carries
 * (`factForBreak`) rather than offering a list. A kind that does not offer the rung reads as ordinary
 * whoever is presenting.
 */
interface FactPlan {
    budget?: FactBudget;
    withhold: boolean;
    one: boolean;
}

function factPlan(persona: Persona | undefined, kind: string, segmentId: string): FactPlan {
    // `sometimes` arrives here already drawn into `always` or `never`, so the two paths below are its.
    const rung = TRIVIA_KINDS.has(kind) ? triviaForBreak(persona, segmentId) : undefined;
    if (rung === 'never') return { withhold: true, one: false };
    if (rung === 'always') return { withhold: false, one: true };
    const budget = rung === undefined ? undefined : TRIVIA_FACT_BUDGET[rung];
    return budget === undefined ? { withhold: false, one: false } : { budget, withhold: false, one: false };
}

/** Takes the notes off both records, for a presenter at `never`. See {@link factPlan}. */
function withholdFacts(neighbours: Neighbours): void {
    for (const side of [neighbours.previous, neighbours.next]) {
        if (side?.track.facts === undefined) continue;
        const { facts: _, ...rest } = side.track;
        side.track = rest;
    }
}

/** Whether every record this break was shown came with nothing to say about it. See {@link BreakRequestBuilder.story}. */
const nothingKnownAbout = (neighbours: Neighbours): boolean =>
    [neighbours.previous, neighbours.next].every(side => side === undefined || (side.track.facts?.length ?? 0) === 0);

/**
 * The one preoccupation this break is offered, spread over the segment id.
 *
 * A free function and not a method, because unlike the notebook, the story and the pads beside it
 * this reads nothing: the list is already on the sheet the caller is holding. That is also why it is
 * attached to every break regardless of kind — there is no rotation to spend and no query to waste,
 * so the veto can live entirely in `BreakPromptShape.allowsPreoccupation` instead of being a rule
 * this builder holds a second copy of.
 *
 * Answers `{}` rather than `{ preoccupation: undefined }` so a character with an empty list produces
 * a request byte-identical to one from before the field existed.
 */
function preoccupation(persona: Persona | undefined, segmentId: string): { preoccupation?: string } {
    const chosen = preoccupationOf(persona, segmentId);
    return chosen === undefined ? {} : { preoccupation: chosen };
}

/**
 * The one quirk with a cadence that came up for this break, drawn over the segment id, on
 * {@link preoccupation}'s terms: attached to every kind, vetoed by `BreakPromptShape.allowsOccasionalQuirk`,
 * and `{}` when nothing came up, so most breaks are byte-identical to one from before quirks had a cadence.
 */
function occasionalQuirk(persona: Persona | undefined, segmentId: string): { occasionalQuirk?: string } {
    const chosen = occasionalQuirkOf(persona, segmentId);
    return chosen === undefined ? {} : { occasionalQuirk: chosen };
}

/**
 * What one break is being written for, as the caller found it.
 *
 * Everything here is something only the caller can know: which line of which order the break sits
 * on, who is saying it, and what asked for it. Everything the builder reads for itself is a property
 * of the moment rather than of the caller, which is the whole of the split.
 */
export interface BreakRequestInput {
    kind: string;
    /**
     * Stable for this break and different for the next one: the segment id on air. The facts, the
     * preoccupation and the now-and-then quirk are all drawn over it, so a re-offered break is about
     * the same things and the next one is about different ones.
     */
    turn: string;
    /** The records either side, as the order stands now. Facts and subjects are attached in place. */
    neighbours: Neighbours;
    /** Who says this break, or `undefined` on a station presenting as nobody. */
    persona: Persona | undefined;
    /** Everybody else presenting tonight, by on-air name. */
    coPresenters: readonly string[];
    /** The order the break sits in, for the next record's intro and whose show a guest is sitting in on. */
    lineup: StationLineup;
    /** When the break airs, off its row. Absent for one with no slot. */
    airsAt?: number;
    /** What the break was asked to be about: the segment's context with any request's on top. */
    context?: BreakWriteRequest['context'];
    /** What a requested break's words are worth at the model slot. Absent for a planted break. */
    priority?: BreakWriteRequest['priority'];
}

/**
 * Builds what the writers are handed for one break: everything the station knows about the moment.
 *
 * Lifted out of `WriteBreakJob` so the request has one author. The job keeps what belongs to a
 * SEGMENT (claiming it, finding its neighbours, choosing who speaks, writing the answer down and
 * spending what it used); this keeps what belongs to the MOMENT (the facts, the clock, the weather,
 * the notebook, the story, the rack), read once per break so every binding asked agrees about what
 * was on offer.
 *
 * Scoped like the sources it reads, since the job runner gives each execution its own scope.
 */
@Injectable()
export class BreakRequestBuilder {
    constructor(
        private readonly segments: SegmentRepository,
        private readonly history: ScriptHistoryRepository,
        private readonly enrichment: EnrichmentReadService,
        private readonly bulletin: BulletinSource,
        /** The bulletin's opposite number, for the kind of break that says what it is like outside. */
        private readonly weather: WeatherSource,
        private readonly almanac: AlmanacSource,
        /** The two programmes either side of a scheduled changeover, for the break that marks one. */
        private readonly changeovers: ChangeoverSource,
        private readonly personas: PersonaRepository,
        // The rack, read once per break beside the persona that names it. See {@link pads}.
        private readonly padRepository: PadRepository,
        private readonly notes: PersonaNotesRepository,
        private readonly stories: PersonaStoriesRepository,
        private readonly plays: PlayHistoryRepository,
        /** Where the singing starts on the record a talk link leads into. See {@link talkUp}. */
        private readonly vocalMarkers: VocalMarkersReader,
        /** What each record is about, and its words for the guard. See {@link aboutTheRecords}. */
        private readonly lyricLabels: LyricLabelsRepository,
        private readonly lyrics: LyricsRepository,
        private readonly identity: StationIdentity,
        private readonly speech: SpeechService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * The request for this break, and the story it was handed, which the caller spends once its
     * words have won. Nothing in here can fail the break: every read is best-effort.
     */
    async build(input: BreakRequestInput): Promise<{ request: BreakWriteRequest; chosen?: ChosenStory }> {
        const { kind, turn, neighbours, persona, coPresenters, lineup, airsAt, context, priority } = input;

        const zone = stationZone(this.config);
        // Gated on the setting rather than on `airsAt` alone: an hour phrasing is only as true as
        // the projection it is derived from, and on this station that projection runs ahead of the
        // order by more than the phrasing's own window. See `NAMES_THE_TIME_DEFAULT`, which carries
        // the measurement. Undefined here is the shape every writer already handles — the same one a
        // break with no `airs_at` is handed — so nothing downstream needs a second branch.
        const namesTheTime = settingIsOn(this.config, CLOCK_KEYS.namesTheTime, NAMES_THE_TIME_DEFAULT);
        const clock = airsAt === undefined || !namesTheTime ? undefined : roughTime(airsAt, zone);
        // Off the same instant as the clock, and offered to every kind: which breaks have any
        // business greeting anybody is the writer's own question, and answering it here would put a
        // decision about one kind of break in the code that serves all of them.
        const greeting = airsAt === undefined ? undefined : dayGreeting(airsAt, zone);
        // Off the same instant again, and offered for the same reason the greeting is. What it adds
        // over the greeting is the small hours, which is the one stretch of the day a greeting has
        // nothing for and a presenter has the most to say about; see `dayPart`.
        const part = airsAt === undefined ? undefined : dayPart(airsAt, zone);
        // And the day it falls on, for a phrasing that says "Friday". No model is told it.
        const day = airsAt === undefined ? undefined : weekday(airsAt, zone);

        // After the claim, so a job that was merely early does no work at all, and for EVERY break
        // rather than only when a model might use them: what the station knows about a record is a
        // property of the moment, not of whichever binding takes it, and reading `llm.breakWriter`
        // here would make the substrate depend on a setting.
        //
        // After the persona too, since how much a record brings is partly who is presenting: a
        // presenter keen on the story behind a record is handed more of it, and one at `never` none.
        // See `factPlan`.
        const facts = factPlan(persona, kind, turn);
        await this.attachFacts(turn, neighbours, facts);
        // Read before a `never` presenter's notes are withheld, because whether a story fills the
        // silence is a question about what the station knows, not about what this break is shown.
        const nothingKnown = nothingKnownAbout(neighbours);
        if (facts.withhold) withholdFacts(neighbours);
        // Beside the facts and the same kind of thing: what the records are about, for a talk link,
        // with the records' own words kept back for the guard. Empty unless `breaks.aboutTheRecord` is on.
        const lyricGuard = await this.aboutTheRecords(kind, neighbours);

        // What a bulletin has to report, for the kinds that report. `undefined` for every other
        // kind, which is how the branch about news stays inside a file about news: this builder serves
        // every kind and knowing which of them read the headlines is not its business. Fetched
        // AFTER the claim for the facts' reason — a job that was merely early does no work at all —
        // and against the moment the break was placed for rather than now, so a bulletin written a
        // quarter of an hour early is judged fresh against the slot it will actually air in.
        const bulletin = await this.bulletin.storiesFor(kind, context, airsAt ?? Date.now());

        // The same arrangement for the kind that reports a PLACE rather than an event. TWO kinds
        // answer here now: the weather break always, and the talk break when the operator has
        // switched `rotation.weatherInTalk` on. Every other kind is `undefined` for the reason that
        // setting exists at all — asking a weather service costs a request, and the talk break is
        // the kind this station makes most of.
        //
        // This used to say that a talk break wanting the weather "reaches `get_weather` itself". It
        // could not: every break writer passes `tools: false`, so no tool answer has ever reached
        // air, and the comment described a route that was never open.
        //
        // Against the same instant as the bulletin above, and it was the only call in this file that
        // did not know one. A reading is a statement about the present with a shelf life, so which
        // moment it has to be true AT is the slot rather than now — the two sources ask the same
        // question of their substrate and must not answer it differently.
        const forecast = await this.weather.readingFor(kind, context, airsAt ?? Date.now());

        // The third of them, for the kind that reads a DATE out, and the only one of the three that
        // needs no context: a band about the day names no subject, because a date is not a choice an
        // operator makes. Against the same instant as the two above, and the reason is sharpest here
        // — a break written at ten to midnight airs on a date whose history is not the one the
        // writer would otherwise have been shown.
        //
        // Like the weather, it also answers for a TALK break, behind `rotation.dateInTalk` and off
        // by default. The same two sources therefore serve two kinds each, which is why the chain
        // below still reads as one: each source refuses every kind it was not asked about.
        const history = await this.almanac.entriesFor(kind, airsAt ?? Date.now());

        // The fourth, for the kind that marks a change of programme, and the only one that needs the
        // persona: whether the host who just finished is somebody else is a comparison against the
        // character this break will be written under. See `ChangeoverSource`.
        const changeover = await this.changeovers.changeoverFor(kind, context, persona);

        // The sources cannot all answer, because each refuses every kind but its own, so this reads
        // as a chain rather than a merge.
        const subject = bulletin?.subject ?? forecast?.subject;

        // Chosen here and SPENT further down, once a writer has actually won. The two used to be one
        // step, which is what let a break that was rewritten, failed, or claimed by something else
        // still count as a telling — `breaks.md` records what the same mistake cost the bulletin
        // that made it: three rewrites emptied the window and lost seven bulletins in two hours.
        const chosen = await this.story(persona, kind, nothingKnown);

        const request: BreakWriteRequest = {
            kind: kind,
            ...(clock === undefined ? {} : { clock }),
            ...(greeting === undefined ? {} : { greeting }),
            ...(part === undefined ? {} : { dayPart: part }),
            ...(day === undefined ? {} : { weekday: day }),
            // The same instant a fourth time, and the only one of the four nothing is TOLD. The three
            // above are the moment as words, which is what a model can use; this is the moment as a
            // number, which is what a guard needs to catch a script naming a point in the day rather
            // than a half of one. See `namesWrongTimeOfDay`.
            ...(airsAt === undefined ? {} : { moment: { at: airsAt, zone } }),
            ...(context === undefined ? {} : { context }),
            ...(bulletin === undefined ? {} : { stories: bulletin.stories }),
            ...(forecast?.reading === undefined ? {} : { weather: forecast.reading }),
            // The reading's own shelf life, travelling beside it so whichever writer takes it stamps
            // the same expiry. See `BreakWriteRequest.weatherFreshUntil`.
            ...(forecast?.freshUntil === undefined ? {} : { weatherFreshUntil: forecast.freshUntil }),
            // The day and its entries together, which is one answer rather than a substrate and a
            // policy — see `BreakWriteRequest.almanac`.
            ...(history?.almanac === undefined ? {} : { almanac: history.almanac }),
            ...(changeover === undefined ? {} : { changeover }),
            // What the format clock asked this break to be ABOUT, resolved out of the context above
            // by the thing that owns the kind's substrate. A writer reads it here rather than
            // digging the key out of `context` itself, so the model binding and the floor cannot
            // resolve it differently.
            ...(subject === undefined ? {} : { subject }),
            ...(neighbours.previous === undefined ? {} : { previous: neighbours.previous.track }),
            ...(neighbours.next === undefined ? {} : { next: neighbours.next.track }),
            ...(await this.talkUp(lineup, kind, neighbours.next)),
            ...lyricGuard,
            station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
            ...(await this.memory(kind)),
            // Read here rather than held by any writer, for the reason the facts above are: the
            // character the station is in is a property of the moment, and every binding uses a
            // different half of it. Read per break, so an operator putting a different persona on
            // air hears it on the next one rather than after a restart.
            ...(persona === undefined ? {} : { persona }),
            // Whose show it is, on a night a guest host sits in. Only for the presenter: a bulletin
            // is the newsreader's, who is not sitting in for anybody.
            ...(await this.sittingIn(lineup, persona)),
            // Everybody else presenting tonight, by on-air name, so whoever speaks can say so.
            ...(coPresenters.length === 0 ? {} : { coPresenters }),
            // What this character has accumulated, read here for the persona's own reason and rested
            // here for a sharper one: the rotation belongs to whatever is actually going on air, and
            // a writer that fetched its own would spend it again on every binding that was asked.
            ...(await this.notebook(persona?.key)),
            // Read here and RESTED here, for the notebook's reason and one of its own: the rung that
            // decides whether this break gets a story at all is applied in the same step as the
            // stamp, or the store fills up with tellings nobody heard. See `story`.
            ...(chosen === undefined ? {} : { story: chosen.story }),
            // What the engine that will speak this can do beyond reading. Read here for the notebook's
            // reason and answered once, so every binding asked for this break agrees about what was on
            // offer — and so a station that changed engine between two breaks writes for the one that
            // is installed now.
            ...(await this.reactions()),
            // The readings the same engine can perform, asked for the reactions' reason and answered
            // once for every binding. Offered only to a kind of break whose shape allows one.
            ...(await this.deliveries()),
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
            ...preoccupation(persona, turn),
            // And the now-and-then quirk, if this is one of its times, on exactly those terms.
            ...occasionalQuirk(persona, turn),
            // What this break's words are worth at the one model slot. Absent for a planted break,
            // which is the gate's `air` default: it has a deadline like everything on air, and no
            // claim to jump the ones in front of it. A REQUESTED break is worth what its urgency
            // says, and `priorityForUrgency` is the only place that judgement is made — an
            // `interrupt` or a `next` exists because something happened and its moment does not come
            // round again, so it goes in front of the station's routine talk.
            ...(priority === undefined ? {} : { priority }),
            // When this is due, so a model binding can work out how long it can afford to queue.
            // Absent for an ordinary planted break, which `patienceFor` answers with the default.
            ...(airsAt === undefined ? {} : { airsAt: airsAt }),
        };

        return { request, ...(chosen === undefined ? {} : { chosen }) };
    }

    /**
     * What the station remembers of the show it is in the middle of.
     *
     * Two reads, both keyed by the BROADCAST first, because "what have we played tonight" is a
     * question about a programme: a window answers it with the tail of the previous show whenever
     * one has just started, which is a presenter referring back to something this audience never
     * heard. So `played` stays the broadcast's own and nothing else.
     *
     * **What was SAID is an avoid-list, and that changes the answer.** A broadcast that has only just
     * begun has said little or nothing, and the listener who was here five minutes ago heard the last
     * show's lines. So when this broadcast has said fewer than {@link RECENT_WINDOW} things, the list
     * is topped up from what the station said outside it within {@link CARRY_WINDOW_MS}, newest first
     * and after this broadcast's own. Inheriting a phrase to avoid costs a writer one choice; airing
     * the same opening twice across a boundary is the repetition the list exists to stop.
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
            const [said, played] = await Promise.all([
                this.history.spokenDuring(broadcastId, RECENT_WINDOW),
                this.plays.duringBroadcast(broadcastId, PLAYED_WINDOW),
            ]);
            const recent = said.length >= RECENT_WINDOW ? said : await this.carriedOver(said, broadcastId);

            return { recent, ...(played.length === 0 ? {} : { played }) };
        } catch (error) {
            this.logger.warn(`director: could not read what the station has said this broadcast (${errorText(error)})`);
            return { recent: await this.segments.recentScripts(kind, RECENT_WINDOW) };
        }
    }

    /**
     * This broadcast's own words, topped up to {@link RECENT_WINDOW} from the hour before it.
     *
     * Everything carried over is older than everything said during this broadcast, so appending
     * keeps the list newest first. A line that appears in both (the same phrasing used either side
     * of the boundary) is kept once, at its newer place: listed twice it would tell a writer the
     * station said it twice.
     */
    private async carriedOver(said: readonly string[], broadcastId: string): Promise<readonly string[]> {
        const before = await this.history.spokenSince(CARRY_WINDOW_MS, RECENT_WINDOW, broadcastId);
        // Asked for a whole window rather than the shortfall, so a line dropped as a duplicate below
        // does not leave the list short.
        const recent = [...said];
        for (const script of before) {
            if (recent.length >= RECENT_WINDOW) break;
            if (!recent.includes(script)) recent.push(script);
        }

        return recent;
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
    /**
     * How long the intro of the record this link leads into runs, for a writer that can aim at it.
     *
     * Only for a talk break, only with talking up on, and only before a record whose markers say
     * where the singing starts. A failure to read them costs the advice and never the break.
     */
    private async talkUp(lineup: StationLineup, kind: string, next: Neighbour | undefined): Promise<Partial<Pick<BreakWriteRequest, 'talkUp'>>> {
        if (kind !== TALK_BREAK_KIND || next?.track.trackId === undefined) return {};
        const settings = resolveTalkUp(this.config);
        if (!settings.enabled) return {};

        const item = lineup.all().find(candidate => candidate.id === next.itemId);
        const cueInMs = item !== undefined && isTrackItem(item) ? item.track.cueInMs : undefined;
        const trackId = next.track.trackId;

        try {
            const markers = (await this.vocalMarkers.forTracks([trackId])).get(trackId);
            const budget = markers === undefined ? undefined : talkUpBudget(runwayFor(markers, cueInMs), settings.safetyMs);
            return budget === undefined ? {} : { talkUp: budget };
        } catch (error) {
            this.logger.warn('write break: could not read where the singing starts on the next record', { error: errorText(error) });
            return {};
        }
    }

    /**
     * Stamps what each neighbour is about onto it, and answers the neighbours' lyric lines for the guard.
     *
     * Only for a talk link and only with `breaks.aboutTheRecord` on. The lines go to
     * `BreakWriteRequest.lyricLines`, which nothing renders: the writer sees the subject, the guard sees
     * the words. Best-effort like the facts: a read that fails costs the subject AND the guard together,
     * so a break is never shown a subject it is not also guarded against quoting from.
     *
     * A station that speaks clean (`speaksClean`) is shown no subject for a record with an explicit copy,
     * since its writer is told to keep it clean in the same prompt. The lyric lines still reach the guard.
     */
    private async aboutTheRecords(kind: string, neighbours: Neighbours): Promise<Partial<Pick<BreakWriteRequest, 'lyricLines'>>> {
        if (kind !== TALK_BREAK_KIND || !settingIsOn(this.config, ABOUT_THE_RECORD_KEYS.enabled, ABOUT_THE_RECORD_DEFAULT)) return {};

        const sides = [neighbours.previous, neighbours.next].filter((side): side is Neighbour => side?.track.trackId !== undefined);
        if (sides.length === 0) return {};
        const ids = sides.map(side => side.track.trackId!);

        try {
            const [subjects, words] = await Promise.all([
                this.lyricLabels.subjectsForTracks(ids, { withholdExplicit: speaksClean(advisoryPolicy(this.config)) }),
                this.lyrics.textForDerivation(ids),
            ]);
            for (const side of sides) {
                const about = subjects.get(side.track.trackId!);
                if (about !== undefined) side.track = { ...side.track, about };
            }
            const lines = ids.flatMap(id => (words.has(id) ? lyricLines(words.get(id)!) : []));
            return lines.length === 0 ? {} : { lyricLines: lines };
        } catch (error) {
            for (const side of sides) {
                const { about: _, ...rest } = side.track;
                side.track = rest;
            }
            this.logger.warn('write break: could not read what the records are about', { error: errorText(error) });
            return {};
        }
    }

    private async attachFacts(segmentId: string, neighbours: Neighbours, plan: FactPlan): Promise<void> {
        const sides = [neighbours.previous, neighbours.next].filter((side): side is Neighbour => side !== undefined);
        const trackIds = sides.map(side => side.track.trackId).filter((trackId): trackId is string => trackId !== undefined);
        if (trackIds.length === 0) return;

        try {
            if (plan.one) {
                // One fact for the whole break, on the record it is about, and the other shown none:
                // a second record's notes beside it would be the list this rung exists to replace.
                const chosen = await this.enrichment.factForBreak(
                    neighbours.previous?.track.trackId,
                    neighbours.next?.track.trackId,
                    rotationOf(segmentId),
                );
                const side =
                    chosen === undefined ? undefined : [neighbours.next, neighbours.previous].find(side => side?.track.trackId === chosen.trackId);
                if (chosen !== undefined && side !== undefined) side.track = { ...side.track, facts: [chosen.fact] };
                return;
            }

            const facts = await this.enrichment.factsForTracks(trackIds, rotationOf(segmentId), {
                ...(plan.budget === undefined ? {} : { budget: plan.budget }),
                // Nothing is rested for a presenter who will not be shown it.
                ...(plan.withhold ? { stamp: false } : {}),
            });
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

    /** {@link reactions}' twin for a reading of the whole break, and quiet for the same reasons. */
    private async deliveries(): Promise<{ deliveries?: readonly SpeechDelivery[] }> {
        try {
            const deliveries = await this.speech.deliveries();
            return deliveries.length === 0 ? {} : { deliveries };
        } catch (error) {
            this.logger.debug(`director: could not ask how the engine can read a break (${errorText(error)})`);
            return {};
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
    private async pads(
        persona: Persona | undefined,
    ): Promise<{ pads?: readonly string[]; stings?: readonly string[]; padUse?: Readonly<Record<string, PadUseNote>> }> {
        if (persona?.soundboard === undefined) return {};

        try {
            const rack = await this.padRepository.onSet(persona.soundboard);
            if (rack.length === 0) return {};

            const stings = rack.filter(padCanSting).map(pad => pad.name);
            const padUse = padUseNotes(rack);
            return { pads: rack.map(pad => pad.name), ...(stings.length === 0 ? {} : { stings }), ...(padUse === undefined ? {} : { padUse }) };
        } catch (error) {
            this.logger.debug(`director: could not read the soundboard (${errorText(error)})`);
            return {};
        }
    }

    /**
     * The one story this break may draw on. Chosen here, and spent by `WriteBreakJob.spend` once the words have won.
     *
     * ## The rung is applied HERE, and that is the whole reason this is not in the prompt builder
     *
     * A rung consulted at RENDER time would leave this method choosing a story for every break under
     * `occasionally` and the prompt then quietly dropping most of them — a store reporting tellings
     * nobody heard, and a "you have told this before" rule firing over breaks that never carried it.
     * The rung and the prompt have to agree, so the rung is read where the material is.
     *
     * ## Choosing and spending are NOT the same step, which is a correction
     *
     * They were, and a break that was rewritten, failed, or claimed by another job still counted as
     * a telling. The stamp now happens after `writeScript` has won, which is also the only point at
     * which the writer's answer exists to be read back. See `WriteBreakJob.spend`.
     *
     * ## What each kind may have, from the shapes themselves
     *
     * {@link STORY_MODES} maps a kind to what its shape declares, rather than this builder holding a
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
    private async story(persona: Persona | undefined, kind: string, nothingKnown: boolean): Promise<ChosenStory | undefined> {
        if (persona === undefined) return undefined;

        const mode = STORY_MODES.get(kind);
        if (mode === undefined) return undefined;

        if (mode === 'offered') {
            const rung = storytellingOf(persona);
            if (rung === 'never') return undefined;
            // Every record the break was shown carries something to say, so there is no silence for
            // a story to fill. A break with no records at all is not one of these kinds.
            if (rung === 'occasionally' && !nothingKnown) return undefined;
        }

        try {
            const found = await this.stories.forPrompt(persona.key, { now: Date.now(), gapMs: resolveThreadGapMs(this.config) });
            if (found === undefined) return undefined;

            return {
                id: found.id,
                story: found.story,
                mode,
                personaKey: persona.key,
                ...(found.beatId === undefined ? {} : { beatId: found.beatId }),
            };
        } catch (error) {
            this.logger.warn(`director: could not read this character's own stories (${errorText(error)})`);
            return undefined;
        }
    }

    /**
     * The regular presenter a guest host is sitting in for, by on-air name, with the show's name.
     *
     * Read here for the persona's reason: who is presenting is a property of the moment, and every
     * binding asked for this break must agree. Nothing on an ordinary night, nothing for a break the
     * guest is not presenting (a bulletin read by the newsreader), and nothing when the regular host
     * cannot be read, which costs the line and never the break.
     */
    private async sittingIn(lineup: StationLineup, persona: Persona | undefined): Promise<{ sittingInFor?: SittingIn }> {
        const regularId = lineup.regularPersonaId;
        // The LEAD only: a guest host sits in for the regular one, and a co-host beside them is not
        // sitting in for anybody.
        if (regularId === undefined || persona === undefined || persona.id !== lineup.personaId || persona.id === regularId) return {};

        const regular = await this.personas.find(regularId).catch(() => undefined);
        const name = (regular?.djName ?? regular?.label)?.trim();
        if (!name) return {};

        // The show's own name only when the clock put it on: an operator's broadcast is named after
        // its source, which is a label for the desk rather than a show to name on air.
        const show = lineup.placedBy === 'schedule' && lineup.name.trim() ? lineup.name.trim() : undefined;

        return { sittingInFor: { name, ...(show === undefined ? {} : { show }) } };
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
}

/** A record beside a break, and WHICH LINE of the order it is. */
export interface Neighbour {
    itemId: string;
    track: BreakTrack;
}

export interface Neighbours {
    previous?: Neighbour;
    next?: Neighbour;
}

/**
 * The story a break was given, held between choosing it and spending it.
 *
 * Carries what the prompt needs and what the ledger needs, because the two happen either side of the
 * writers: the request is built before anything is written, and the row is only a fact once a script
 * has won. See `BreakRequestBuilder.story` and `WriteBreakJob.spend`.
 */
export interface ChosenStory {
    id: string;
    story: PersonaStoryForPrompt;
    /** What the kind's shape said this story was FOR, recorded so a timeline can say which. */
    mode: 'offered' | 'told';
    personaKey: string;
    /** The part of an arc this break was handed, when it was handed one. */
    beatId?: string;
}
