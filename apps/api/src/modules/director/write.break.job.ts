import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { padCue, padPlacementsIn, padsIn, withoutPads } from '#modules/render/pad.cues.js';
import { padCanSting, PadRepository } from '#modules/render/pad.repository.js';
import { padEveryBreaks, padsAreOn } from '#modules/render/pad.settings.js';
import { PersonaRepository } from '#modules/personas/persona.repository.js';
import { PersonaTellingRepository } from '#modules/personas/persona.telling.repository.js';
import { hasKind, NEWSREADER_READS, type Persona } from '#modules/personas/persona.js';
import { ScriptHistoryRepository } from '#modules/render/script.history.repository.js';
import { SegmentRepository, type PadHit, type Segment } from '#modules/render/segment.repository.js';
import { isCarriedKind } from './carried.kind.js';
import { BreakRequestRepository } from './break.request.repository.js';
import { isRenderedFirst, priorityForUrgency, type StoredBreakRequest } from './break.request.js';
import type { BreakTrack, WrittenBreak } from './break.writer.js';
import { BreakWriterRegistry, declineText, isWritten, type BreakWriteResult } from './break.writer.registry.js';
import { BreakFloorWatch } from './break.floor.watch.js';
import { DETERMINISTIC_WRITER, TALK_BREAK_KIND } from './talk.break.writer.js';
import { isTrackItem, type StationLineup, type StationLineupItem } from './station.lineup.js';
import { songKey } from './rotation.keys.js';
import { StationLineupRepository } from './station.lineup.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import { BreakRequestBuilder, type ChosenStory, type Neighbour, type Neighbours } from './break.request.builder.js';
import { mentionsFact } from './fact.mentions.js';

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
        /** Everything the writers are handed about the moment. See `BreakRequestBuilder`. */
        private readonly builder: BreakRequestBuilder,
        private readonly personas: PersonaRepository,
        // The rack, read again once the words are back, to resolve what they hit. See {@link hits}.
        private readonly padRepository: PadRepository,
        /** The ledger behind the two stamps on a story. See {@link spend}. */
        private readonly tellings: PersonaTellingRepository,
        private readonly activity: ActivityRecorder,
        // Outlives this job, which is scoped: whether the model has been failing for an hour is a run
        // across many writes. See `BreakFloorWatch`.
        private readonly floorWatch: BreakFloorWatch,
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
        const found = neighboursOf(lineup, segmentId, await this.programmesOn(lineup));
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
        // This broadcast's own host where it named one, and the station's behind it, except that a
        // bulletin is the newsreader's where the station has one. `undefined` is an ordinary answer:
        // a station that has chosen no persona writes exactly what it wrote before personas existed.
        // Everything below reads this one persona (the sheet, the phrasing pool, the voice), which
        // is what keeps a declined bulletin from coming out in the host's words and the reader's voice.
        const presenting = await this.personas.presentingFor(segment.kind, lineup.personaId);
        // Who on the show says THIS break: the presenter, or on a show with co-hosts, whichever of
        // them has been heard least recently, so every voice comes round in turn.
        const { persona, coPresenters } = await this.speakerFor(segment.kind, lineup, presenting);

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

        // Everything the station knows about the moment, read once for whichever writer takes it.
        // The story comes back beside the request because it is SPENT here, once a writer has won
        // and the words are this segment's. See `BreakRequestBuilder`.
        const {
            request: built,
            chosen,
            handedFact,
        } = await this.builder.build({
            kind: segment.kind,
            turn: segment.id,
            neighbours,
            persona,
            coPresenters,
            lineup,
            ...(segment.airsAt === undefined ? {} : { airsAt: segment.airsAt }),
            ...(context === undefined ? {} : { context }),
            // What this break's words are worth at the one model slot, judged by `priorityForUrgency`
            // alone. Absent for a planted break, which is the gate's `air` default.
            ...(asked === undefined ? {} : { priority: priorityForUrgency(asked.urgency) }),
        });

        const result = await this.writers.write(built);

        // Before the row is touched, and before any early return below, so an attempt is recorded
        // whichever way this goes. What the station TRIED is as much of the record as what it said.
        await this.remember(segmentId, segment.kind, neighbours, result, persona?.key, handedFact);

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

        // The mirror, for a break that back-announced instead: stamped only when the words actually
        // named the record behind it, and naming the LINE for the same reason `claimsItemId` does.
        // See `segments.claims_previous_item_id`.
        const claimsPreviousItemId = result.written.claimsPrevious === true ? neighbours.previous?.itemId : undefined;

        // The voice is offered only when the ROW has none. A segment planned by hand through
        // `POST /segments` may name one, and that is an operator's explicit instruction rather than
        // a default to recompute — while a break the station planted for itself should be spoken by
        // whoever the station currently is. Decided here, with the words, so a persona swapped
        // before the render cannot have this sentence read out by a different character.
        const voice = segment.voice ?? persona?.voice;
        // The reading needs no line of its own: it rides on `result.written` into `writeScript`, which
        // writes it every time and clears it when absent. The opposite of the voice above on purpose,
        // since the voice is an instruction about who speaks and the reading is part of what was
        // written, so a floor line replacing a model's clears whatever reading the model had chosen.

        // What the script actually hit, resolved HERE because here is the only place the presenting
        // character's board is in hand. See `segments.pads`: a pad name is unique per board and not
        // across the station, so a renderer resolving `[sfx:airhorn]` for itself would have to ask
        // who is presenting NOW — which after a recast is somebody else with a different rack, and
        // the sound joined would not be the one the words were written for.
        // The FLOOR runs first, because it can only ever change a script that hit nothing — so what
        // `hits` resolves below is the finished words either way, whoever decided them.
        const finished = await this.floorPad(result, persona, segment.kind);
        const { hits: pads, misplaced } = await this.hits(finished, persona);
        // A hit the pad may not take where it landed is out of the row already; taking its token out
        // of the words too is what keeps the console showing the break that airs.
        const script =
            misplaced.length === 0
                ? finished
                : withoutPads(
                      finished,
                      padsIn(finished).filter(name => !misplaced.includes(name)),
                  );

        if (
            !(await this.segments.writeScript(segmentId, {
                ...result.written,
                // The floor may have added a hit, so this is the script rather than the writer's own.
                script,
                writer: result.writer,
                ...(claimsItemId === undefined ? {} : { claimsItemId }),
                ...(claimsPreviousItemId === undefined ? {} : { claimsPreviousItemId }),
                ...(persona === undefined ? {} : { personaId: persona.id }),
                ...(voice === undefined ? {} : { voice }),
                pads,
            }))
        ) {
            // The row moved out of `planned` while this was being written. Whoever moved it owns it.
            // Nothing is spent: the story this job chose is still owed to whatever airs here.
            this.logger.info('director: a break was written after something else had claimed it', { job: this.context.id, segment: segmentId });
            return;
        }

        // These words are this segment's now, so whatever they did with the story is a fact. Before
        // this line the break could still have been lost; after it, what a listener will hear is
        // settled. See `spend`.
        await this.spend(segmentId, chosen, { ...result.written, script });

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

        // The row above is one break. Whether the MODEL has been gone for an hour is a run across many,
        // and only the watch can see it. See `BreakFloorWatch`.
        this.floorWatch.observe(result, this.writers.writersFor(segment.kind));
    }

    /**
     * Every programme segment the order holds, by id, for {@link neighboursOf}.
     *
     * One read, and none at all for an order carrying no programme, which is nearly every order: the
     * segment KIND rides the lineup item, so which lines are programmes is known without asking.
     */
    private async programmesOn(lineup: StationLineup): Promise<Map<string, Segment>> {
        const ids = lineup.all().flatMap(item => (item.kind === 'segment' && isCarriedKind(item.segmentKind ?? '') ? [item.segmentId] : []));
        if (ids.length === 0) return new Map();

        return await this.segments.findByIds(ids);
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

            // Least recently hit among those that may close a break unprompted, which is the order the
            // read already answers in. A rack of nothing but mid-break and cued sounds gets no sting.
            const sting = rack.find(padCanSting);
            if (sting === undefined) return script;

            return `${script} ${padCue(sting.name)}`;
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
    private async hits(script: string, persona: Persona | undefined): Promise<{ hits: PadHit[]; misplaced: string[] }> {
        const board = persona?.soundboard;
        if (board === undefined) return { hits: [], misplaced: [] };

        const placed = padPlacementsIn(script);
        if (placed.length === 0) return { hits: [], misplaced: [] };

        try {
            const hits: PadHit[] = [];
            const misplaced: string[] = [];
            for (const { name, at } of placed) {
                const pad = await this.padRepository.named(board, name);
                if (pad === undefined) {
                    this.logger.info('director: a break hit a pad the board no longer holds', { job: this.context.id, board, pad: name });
                    continue;
                }

                // Where the operator said this sound may not go. Dropped, on the bargain above for a
                // pad that has gone: the words are fine, they air without the sound. Not rested,
                // since it never played.
                if (!pad.placements.includes(at)) {
                    this.logger.info('director: a break hit a pad where it may not land', { job: this.context.id, board, pad: name, at });
                    misplaced.push(name);
                    continue;
                }

                hits.push({ name, padId: pad.id });
                await this.padRepository.markUsed(pad.id);
            }
            return { hits, misplaced };
        } catch (error) {
            this.logger.warn(`director: could not resolve a soundboard hit (${errorText(error)})`);
            return { hits: [], misplaced: [] };
        }
    }

    /**
     * Who says this break, and who else is presenting beside them.
     *
     * Only a talk break rotates. The changeover and the welcome are the lead's, since they are the
     * show handing over and opening; a bulletin is the newsreader's; and every other kind of break is
     * a job one presenter does, so it stays with the lead rather than passing the job round. Among
     * the lead and tonight's co-hosts the least recently heard speaks, which is the caster's rule for
     * callers and gives every voice its turn. A co-host the roster cannot read, or who is no longer a
     * host, is passed over rather than failing the break.
     */
    private async speakerFor(
        kind: string,
        lineup: StationLineup,
        presenting: Persona | undefined,
    ): Promise<{ persona: Persona | undefined; coPresenters: string[] }> {
        const ids = lineup.coHostPersonaIds;
        // A bulletin is the newsreader's alone, with nobody beside them. Asked of the BREAK rather than
        // of the persona, because the newsreader may be tonight's host too, and every other break of
        // theirs is an ordinary one to share round.
        const bulletin = presenting !== undefined && NEWSREADER_READS.has(kind) && hasKind(presenting, 'newsreader');
        if (ids.length === 0 || presenting === undefined || bulletin) return { persona: presenting, coPresenters: [] };

        const found = await Promise.all(ids.map(id => this.personas.find(id).catch(() => undefined)));
        const coHosts = found.filter(
            (persona): persona is Persona => persona !== undefined && hasKind(persona, 'host') && persona.id !== presenting.id,
        );
        const everyone = [presenting, ...coHosts];

        let speaker = presenting;
        if (kind === TALK_BREAK_KIND && coHosts.length > 0) {
            const heard = await this.segments.lastSpokenBy(everyone.map(persona => persona.id)).catch(() => new Map<string, number>());
            // `reduce` keeps the first of equals, so a tie (everybody unheard) goes to the lead.
            speaker = everyone.reduce((best, next) => ((heard.get(next.id) ?? 0) < (heard.get(best.id) ?? 0) ? next : best));
        }

        const names = everyone
            .filter(persona => persona.id !== speaker.id)
            .flatMap(persona => {
                const name = (persona.djName ?? persona.label).trim();
                return name ? [name] : [];
            });

        return { persona: speaker, coPresenters: names };
    }

    /**
     * Write down that this break carried a story, once it is actually this break's script.
     *
     * Called only after `writeScript` has won, so nothing is spent by a break that failed, was
     * rewritten into something else, or was claimed by another job between the writing and the
     * commit. That is the whole correction this method exists for; see {@link story}.
     *
     * `replaceForSegment` rather than an insert, because a segment is rewritten often and every
     * rewrite of one break is still one thing a listener hears. It is also why the no-story case has
     * to reach this at all — a break rewritten into one that carries nothing must take the previous
     * attempt's row with it, or the aired edge stamps a telling that never went out.
     *
     * Best-effort, like the reads that fed it: a ledger that could not be written costs the record
     * of a telling and never the break.
     */
    private async spend(segmentId: string, chosen: ChosenStory | undefined, written: WrittenBreak): Promise<void> {
        try {
            if (chosen === undefined) {
                await this.tellings.replaceForSegment(segmentId, undefined);
                return;
            }

            await this.tellings.replaceForSegment(segmentId, {
                personaKey: chosen.personaKey,
                storyId: chosen.id,
                // WHICH part it told, so the next one is owed rather than guessed at. Absent for
                // anything that is not an arc.
                ...(chosen.beatId === undefined ? {} : { beatId: chosen.beatId }),
                source: 'break',
                mode: chosen.mode,
                // The WRITER's own read-back, never the model's word for it. A story offered on a
                // talk break may simply be ignored, and a break that fell through to the phrasings
                // said nothing of it at all — see `mentionsStory`.
                told: written.toldStory === true,
                // Kept only where something was actually told, because this is what a later break is
                // shown so it can refer back, and the words of a break that ignored the story are
                // not that. It also satisfies the store's own constraint.
                ...(written.toldStory === true ? { said: written.script } : {}),
            });
        } catch (error) {
            this.logger.warn(`director: could not record that a story was told (${errorText(error)})`);
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
    private async remember(
        segmentId: string,
        kind: string,
        neighbours: Neighbours,
        result: BreakWriteResult,
        personaKey?: string,
        handedFact?: string,
    ): Promise<void> {
        if (result.attempts.length === 0) return;

        // A link names its records anyway, so their names are no evidence the fact was said.
        const recordNames = [neighbours.previous, neighbours.next].flatMap(side => (side === undefined ? [] : [side.track.title, side.track.artist]));
        const factUsedBy = (script: string | undefined): { factUsed?: boolean } => {
            const used = handedFact === undefined || script === undefined ? undefined : mentionsFact(script, handedFact, recordNames);
            return used === undefined ? {} : { factUsed: used };
        };

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
                    ...(attempt.written?.delivery === undefined ? {} : { delivery: attempt.written.delivery }),

                    ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
                    // Read back by the station, for a presenter asked for one fact. See `mentionsFact`.
                    ...factUsedBy(attempt.written?.script),
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
function neighboursOf(lineup: StationLineup, segmentId: string, programmes: ReadonlyMap<string, Segment> = new Map()): Neighbours | undefined {
    const items = lineup.all();
    const at = items.findIndex(item => item.kind === 'segment' && item.segmentId === segmentId);
    if (at < 0) return undefined;
    // The show's call rather than the persona's: see `StationLineupRules.chartPositions`.
    const sayChart = lineup.rules.chartPositions !== false;

    const nearest = (from: number, step: number, adjacentOnly = false): Neighbour | undefined => {
        for (let index = from; index >= 0 && index < items.length; index += step) {
            const item = items[index]!;

            // An episode of somebody else's programme is a neighbour the way a record is: it is what
            // just played, or what is coming up, and a presenter around it says so. It is found here
            // from its own segment row, read by the caller, and is subject to the same two rules a
            // record is — not across an intervening line for what is coming up, and not at all once
            // nobody will hear it.
            if (!isTrackItem(item) && programmes.has(item.segmentId)) {
                if (item.state === 'unavailable' || item.state === 'skipped' || item.state === 'removed') {
                    if (adjacentOnly) return undefined;
                    continue;
                }
                return { itemId: item.id, track: programmeTrack(programmes.get(item.segmentId)!) };
            }

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
                    // The three the order already holds. Passed through one at a time rather than
                    // spread, so an item that knows the year and not the album hands over the year
                    // and stays silent about the album — `describe` renders what is here and a
                    // blank field is an invitation to invent one.
                    ...(item.track.year === undefined ? {} : { year: item.track.year }),
                    ...(item.track.album === undefined ? {} : { album: item.track.album }),
                    ...(item.track.durationMs === undefined ? {} : { durationMs: item.track.durationMs }),
                    // Why it is here, when a chart is the reason and the show says so. See `BreakTrack.chart`.
                    ...(item.track.chart === undefined || !sayChart ? {} : { chart: item.track.chart }),
                    // And when being an unheard album track is the reason. See `BreakTrack.deepCut`.
                    ...(item.track.deepCut === true ? { deepCut: true as const } : {}),
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
        ...(next === undefined ? {} : { next: withLink(next, previous, items) }),
    };
}

/**
 * The record coming up, with how it connects to the one before when a route planned that connection
 * and the record before really is the one it was planned after. An edit or a skip between the two
 * makes the connection a claim about a pair that is not on air, so it is dropped rather than said.
 */
function withLink(next: Neighbour, previous: Neighbour | undefined, items: readonly StationLineupItem[]): Neighbour {
    const item = items.find(line => line.id === next.itemId);
    const link = item !== undefined && isTrackItem(item) ? item.track.link : undefined;
    if (link === undefined || previous === undefined) return next;
    if (songKey(previous.track.title, [previous.track.artist]) !== link.fromSongKey) return next;
    return { ...next, track: { ...next.track, link: link.reason } };
}

/**
 * An episode of somebody else's programme as a neighbour a writer is shown: the episode as the title
 * and the show as the artist, so every phrasing that names a record names the programme the way a
 * presenter would, and `programme` so a model is told it is not a song. Both off the segment's own
 * context, written when the episode was fetched; the label is the fallback for a mangled one.
 */
function programmeTrack(segment: Segment): BreakTrack {
    const context = segment.context ?? {};
    const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);
    const summary = text(context.summary);

    return {
        title: text(context.episodeTitle) ?? segment.label,
        artist: text(context.showTitle) ?? 'a programme the station carries',
        ...(segment.durationMs === undefined ? {} : { durationMs: segment.durationMs }),
        programme: summary === undefined ? {} : { summary },
    };
}
