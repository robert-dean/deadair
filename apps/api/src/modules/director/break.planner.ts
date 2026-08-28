import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { nextBoundaryAtOrAfter, projectAirTimes } from './air.clock.js';
import { brokenClaim, type BrokenClaim } from './break.claims.js';
import { errorText } from '#modules/shared/error.text.js';
import { isAnchored, nextOccurrence, type ClockBand, type ClockBandSubject } from './clock.bands.js';
import { ClockBandRepository } from './clock.band.repository.js';
import { PersonaRepository } from '#modules/personas/persona.repository.js';
import { CHATTINESS_SPACING, chattinessOf, type PersonaChattiness } from '#modules/personas/persona.sheet.js';
import { isProductionKind } from '#modules/productions/production.scheduler.js';
import { stationZone } from './clock.words.js';
import { SegmentRepository, type Segment, type StrandedRelease } from '#modules/render/segment.repository.js';
import { SpeechService } from '#modules/render/speech.service.js';
import { BreakWriterRegistry } from './break.writer.registry.js';
import { isTrackItem, type StationLineup, type StationLineupItem, type StationLineupSegmentItem } from './station.lineup.js';
import type { ResolvedRules } from './rotation.rules.js';
import type { BreakRequestResult, BreakUrgency, StoredBreakRequest } from './break.request.js';
import { TALK_BREAK_KIND } from './talk.break.writer.js';
import { WELCOME_KIND } from './welcome.writer.js';

/**
 * The kind of break whose audio already exists, because somebody recorded it and
 * dropped it in the inbox.
 *
 * A station ident is the thing every station does, and it is what this plants
 * when the station cannot write and speak one of its own.
 */
const IDENT_KIND = 'ident';

/**
 * How far past the cursor a break may be planted.
 *
 * Never into the window the director is about to hand over. An item already
 * committed is one an operator can no longer move or remove, and dropping a
 * break into that window would be programming the station a listener is already
 * hearing.
 *
 * It also buys the thing the next piece of work needs: a segment planted this
 * far out has whole records of airtime before its slot arrives, which is the
 * difference between a renderer having time to finish and the director skipping
 * a break that was never ready. Nothing renders yet, so today this is only about
 * the operator's reach.
 */
export const PLANT_AHEAD = 4;

/**
 * How near its slot a break gets before anything is written for it.
 *
 * Planting is cheap and happens all the way down the order, because the POSITION is what keeps the
 * spacing stable and what lets an operator see the shape of the hour. Writing is the expensive half
 * and waits here.
 *
 * It used to not wait at all. `plant` sent a write for every slot the moment it put one down, and
 * with a tail of eight to twenty-three items that meant up to five breaks written and rendered at
 * once, the furthest about an HOUR of airtime ahead. That hour is paid for three ways: it is an hour
 * for a forward claim to go stale under an operator edit, it is model and speech work thrown away
 * whenever the order changes, and on a slow model it is spent when the station can least afford it.
 *
 * Eight, against a `COMMIT_LEAD` of 1. A break must be `ready` before the pass that hands it over
 * reaches it, so the window leaves roughly seven records of airtime — call it twenty minutes — for a
 * write and a render to finish, which is generous against a model answering at a couple of tokens a
 * second and still cuts the horizon from about an hour. It got two records longer when the commit
 * lead collapsed, which is the right direction: the work has more time, not less.
 *
 * Measured in ITEMS, deliberately, while the spacing beside it is measured in minutes. This is a
 * bound on how much WORK may be in flight, and the work is one write and one render per break
 * regardless of how long the records between them run — so items is the unit that actually
 * describes it, and a station of long album cuts would otherwise have a write window covering
 * fewer breaks than a station of short ones for no reason.
 *
 * It scales with the break interval rather than against it: at the default quarter of an hour the
 * window holds two or three breaks, and at a break every few minutes it holds up to eight. That is
 * correct — a station told to talk that often is asking for that much — and it is deliberately not
 * capped per pass, because a claim makes a duplicate send free, renders queue like any other job,
 * and a model is serialised by `LlmGate` however many are asked for.
 */
export const WRITE_AHEAD = 8;

/**
 * How near its slot a requested break may be placed, per urgency, and how long it stays worth
 * airing.
 *
 * One table, here, rather than a number in each producer. A producer knows that a listener arrived
 * or that a bulletin came in; it has no way to know how long a write and a render take on this
 * station, and a dozen of them each guessing would be a dozen numbers to correct when the speech
 * engine changes.
 *
 * `leadMs` is the only thing a placement needs: the first boundary at least this far away. For the
 * two urgencies that are rendered before they are injected it is what the writer and the renderer
 * get, and for the two that are planted it is what stands between the slot and the commit window.
 *
 * `deadlineMs` bounds the OTHER end and only `soon` has one: asked for "within a few records" and
 * offered nothing inside ten minutes, the honest answer is to decline and let the caller ask again.
 * `next` has none because the next boundary is the next boundary however far off it is.
 *
 * `expiresMs` is how long the words stay worth speaking, and it exists only for the two that wait
 * for their audio: a planted break's expiry is its POSITION, which cannot go stale the way a
 * finished recording held back for a slot can. A bulletin that took twenty minutes to render is not
 * news, and a welcome for a listener who has since left is worse than silence.
 */
export interface UrgencyBounds {
    /** How far away the boundary has to be for a write and a render to make it. */
    leadMs: number;
    /** How far away it may be before the request has missed what it was asking for. */
    deadlineMs?: number;
    /** How long the words stay worth speaking, for one held back until its audio exists. */
    expiresMs?: number;
}

export const URGENCY: Record<BreakUrgency, UrgencyBounds> = {
    // The shortest lead of the four, because a talk-over does not wait for a boundary: it rides a
    // record and speaks part-way in, so the renderer has the head of that record as well.
    interrupt: { leadMs: 20_000, expiresMs: 10 * 60_000 },
    next: { leadMs: 90_000, expiresMs: 15 * 60_000 },
    soon: { leadMs: 90_000, deadlineMs: 10 * 60_000 },
    whenever: { leadMs: 0 },
};

/**
 * How long a request of this urgency stays worth airing, or `undefined` for one with no deadline.
 *
 * A function rather than a property read, because only two of the four have one and the table above
 * says why: an expiry belongs to a break whose audio is being held back, and a planted break's
 * expiry is its own position.
 */
export const expiryFor = (urgency: BreakUrgency): number | undefined => URGENCY[urgency].expiresMs;

/**
 * How far into a record an interrupting talk-over speaks.
 *
 * Not zero: a cue that fires the instant a record starts talks over its intro, which is the one
 * part of a record a presenter is actually supposed to talk over and the one part they are supposed
 * to get out of the way of. Thirty seconds is past almost every intro and still early enough that
 * the interruption is heard as one.
 */
export const INTERRUPT_OVER_AT_MS = 30_000;

/**
 * How long an unmeasured record is assumed to run when spacing is being decided.
 *
 * **The one place this file deliberately disagrees with `air.clock.ts`,** which counts everything
 * unknown as zero so that a boundary is never projected later than it really is. The two rules want
 * opposite things from a guess. An anchored break must never land EARLY, because "just after nine"
 * said at four minutes to is a lie no phrasing can absorb, so there a missing duration contributes
 * nothing and the break slides late. Spacing only wants to be roughly right, and a run of records
 * that each counted zero would mean a station that never reached its interval and never talked at
 * all — which is far worse than a break arriving two minutes off.
 *
 * Four and a half minutes, which is what this catalog actually averages. Nothing is measured off
 * the library at runtime: a constant that is close is worth more than a query on every boundary,
 * and every record the station owns carries a real duration anyway, so this is reached for only by
 * something newly discovered and not yet ingested.
 */
const NOMINAL_TRACK_MS = 270_000;

/**
 * How late a boundary may be and still count as the slot an operator asked for.
 *
 * The running order is made of whole records, so a band almost never falls on a boundary: asked for
 * half past, the station takes the first gap at or after it. This is how far it may reach.
 *
 * **Deliberately not the phrasing's own window**, which is what this was first written as and which
 * running it immediately exposed. Those windows are anchored to the hour — see `clock.words.ts` —
 * so a band at :00 had seven minutes of slack and one at :14 had one, and the second could
 * essentially never be filled. How late is too late is a question about the OPERATOR'S slot and has
 * the same answer wherever in the hour they put it.
 *
 * Ten minutes: at this catalog's average that is at most two records past the mark, and comfortably
 * inside the half hour between the two bands most stations would write. Past it, the station has
 * missed the slot, and the next occurrence is the honest answer.
 */
const BAND_LATENESS_MS = 600_000;

/**
 * How long a break may sit half-written before the job that claimed it is taken to be gone.
 *
 * Five minutes, against a `director.write_break` that expires in three (`job.mappings.ts`). The
 * margin is deliberate and one-directional: releasing a row a live job still holds would have two
 * writers for one break, while releasing one late costs nothing but a boundary. Not imported from
 * the jobs module, because the module edge runs director ← jobs and a number with the reason beside
 * it is worth more here than a shared constant would be.
 */
const WRITING_STRANDED_MS = 300_000;

/**
 * The same, for a break half-spoken. Fifteen minutes, against a `render.segment` that expires in
 * ten, and generous for the same reason: speech on CPU is slow, and a render still running is a
 * render nobody should interrupt.
 */
const RENDERING_STRANDED_MS = 900_000;

/**
 * What one pass over the write-ahead window did.
 *
 * `offered` is what it asked for the words of, which is the number this used to answer with on its
 * own. The other two are lists rather than counts because an operator is told about those: a break
 * being written a second time is usually the consequence of an edit they made a moment ago, and one
 * handed back by the sweep is the station recovering from something they never saw.
 */
export interface RipenResult {
    offered: number;
    /** Breaks whose words had stopped being true, and are being written again. */
    rewritten: string[];
    /** Breaks whose writer or renderer died holding them, now back in the pool. */
    released: string[];
    /** Breaks whose words survived a render that did not, being spoken again. */
    rerendered: string[];
}

/** A pass with no segments in its window at all, which is most of them. */
const NOTHING_RIPENED: RipenResult = { offered: 0, rewritten: [], released: [], rerendered: [] };

/**
 * Whether a broken claim is one a rewrite would actually repair.
 *
 * Everything is, except a time claim that has not arrived yet: those words are not wrong, they are
 * early, and the second attempt would derive the same phrasing from the same `airsAt` and land in
 * the same place. See the note in `break.claims.ts` for what acting on it cost the news.
 */
const worthRewriting = (broken: BrokenClaim | undefined): boolean => broken !== undefined && !(broken.kind === 'time' && broken.when === 'early');

/**
 * How many times the station will ask for the audio of one break before letting it go.
 *
 * Three, counted over the row's whole history rather than a recent window. The failure it is
 * bounding is an engine that is not there, which does not get better by being asked again on the
 * next boundary and the one after that — and the cost of asking forever is a job queue and an event
 * table filling up for as long as the engine stays down. Three is enough to cover a restart, which
 * is the case worth recovering.
 */
const MAX_RENDER_ATTEMPTS = 3;

/**
 * The station putting its own segments into a lineup.
 *
 * The rule is one break every `breakEveryMinutes` of airtime, counted PER KIND. A rule looks back
 * for the last break of its own sort and treats every other segment as ordinary airtime, so a news
 * bulletin at nine says nothing about when the DJ should next name the station and vice versa. That
 * is simpler than one shared clock rather than more complicated: it makes "what does a foreign
 * break do to somebody else's spacing" a question with no meaning.
 *
 * Idempotent by construction rather than by a guard. It measures from the last break of its kind
 * ALREADY in the order, so a second pass over a lineup it has just planted into finds every gap
 * short and plants nothing. **Nothing here remembers anything between passes** — the order is the
 * memory — which is what makes it safe to call from the director's commit pass on every track
 * boundary, and what keeps two passes racing each other from producing two breaks.
 *
 * Scoped, like the repositories it reads: it is called from a job's scope and
 * from the scope the director opens per unit of work.
 */
@Injectable()
export class BreakPlanner {
    constructor(
        private readonly segments: SegmentRepository,
        private readonly writers: BreakWriterRegistry,
        private readonly speech: SpeechService,
        private readonly bands: ClockBandRepository,
        private readonly personas: PersonaRepository,
        private readonly jobs: PgBossJobBroker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Plant whatever breaks the tail is missing. Answers how many went in.
     *
     * Reads the library only when there is somewhere to put something, so the
     * ordinary case — a lineup whose breaks are already in place — costs the walk
     * below and no query at all. On the commit path that matters: this runs on
     * every boundary.
     *
     * ## Written breaks are planted empty
     *
     * A talk break goes in as a `planned` segment with no script, and a job
     * writes it afterwards. The row and its place in the running order are one
     * cheap write each and both happen HERE, synchronously, because that is what
     * keeps this idempotent: the segment is in the order before the next commit
     * pass walks it, so that pass finds the gap filled and plants nothing. Only
     * the slow half is deferred, and a break that is never written is skipped by
     * the director exactly like one that was never rendered.
     */
    async plant(lineup: StationLineup, rules: ResolvedRules, clock: AirClock): Promise<number> {
        if (!rules.breaks) return 0;

        // Read once per pass and handed down, which is what keeps `slotsFor` a pure walk over the
        // order: the rules are a document this reads, exactly as the schedule is, and a walk that
        // went to the database in the middle of claiming boundaries would be a walk nothing could
        // test without a stack.
        // Who is presenting, through the one method that owns that precedence: a broadcast's own
        // host, else the station's. Read here rather than inside the walk so `slotsFor` stays a pure
        // function of the order — the reason `bands.active()` is read here too.
        //
        // A read per pass, and this runs on every boundary. It sits beside the band read that was
        // already here and behind the same `rules.breaks` gate above, so a station with its breaks
        // off pays for neither.
        const presenting = await this.personas.presenting(lineup.personaId);
        const wanted = this.slotsFor(lineup, rules, clock, await this.bands.active(), chattinessOf(presenting));
        if (wanted.length === 0) return 0;

        // Both halves of being able to say something of the station's own: words to say, and a voice
        // to say them in. Without a speaker a written break could never be rendered and would be
        // skipped at every slot, which would cost the station the ident it could have had instead.
        const canWrite = this.writers.canWrite(TALK_BREAK_KIND) && this.speech.speaker() !== undefined;
        const idents = await this.segments.listReady(IDENT_KIND);

        if (!canWrite && idents.length === 0 && wanted.every(slot => slot.band === undefined)) {
            // Not a fault, and deliberately not a warning: a station with no idents recorded and
            // nothing able to write its own is an ordinary state, and it plays records. Said once
            // per pass at info, because an operator wondering why the station never says its own
            // name needs somewhere to look.
            this.logger.info('director: the running order wants a break, but nothing can write one and the library holds no idents');
            return 0;
        }

        const placements = await this.fill(wanted, idents, canWrite, await this.lastKindBefore(lineup, wanted[0]!.atIndex));
        if (placements.length === 0) return 0;

        if (!(await this.insert(lineup, placements))) return 0;

        // Nothing is sent for writing here. A break is written when its slot comes near rather than
        // when it is planted, which is {@link ripen}'s job on the same pass. What that preserves is
        // this method's whole shape: planting stays one cheap write per slot with no model and no
        // speech engine anywhere near it, so an order gets its breaks laid out an hour ahead and
        // pays for the words fifteen minutes ahead.
        this.logger.info('director: planted breaks into the running order', { count: placements.length, written: canWrite });
        return placements.length;
    }

    /**
     * Put a break something ASKED for into the order. Answers whether it took, and why not.
     *
     * The sibling of {@link plant} and deliberately not a case inside it. Planting answers "where do
     * the station's own rules want a break", which is a question about elapsed airtime and is
     * recomputed from the order on every pass. This answers "where can a break somebody asked for
     * still go", which is a question about the CLOCK — how long a write and a render need — and is
     * asked exactly once per request. The two share how a break gets into the order ({@link insert})
     * and nothing else, and folding them together would make each worse at its own question.
     *
     * Every way of declining is an ordinary outcome with a sentence attached, because the caller is
     * a producer that will hear about it and, more often, an operator reading a log line wondering
     * why the station said nothing.
     */
    async plantRequested(lineup: StationLineup, rules: ResolvedRules, clock: AirClock, request: StoredBreakRequest): Promise<BreakRequestResult> {
        const refusal = this.refuse(request.kind, rules);
        if (refusal !== undefined) return { accepted: false, reason: refusal };

        const slot = this.slotFor(lineup, clock, request.urgency);
        if (slot === undefined) {
            return {
                accepted: false,
                reason: `the running order has no boundary far enough ahead to fit a ${request.kind} that is wanted ${request.urgency}`,
            };
        }

        // A talk-over rides the record after it rather than sitting in the gap before it, which is
        // the whole of what makes an interruption one. Everything else about placing it is identical.
        const over = request.urgency === 'interrupt' ? { atMs: INTERRUPT_OVER_AT_MS } : undefined;
        const segment = await this.segments.plan({
            kind: request.kind,
            label: labelFor(request.kind),
            requestId: request.id,
            // The projected time, exactly as a band's slot stamps it: the writer is asked for the
            // words on a later pass and this is the only thing that will still know when they are
            // going to be spoken.
            ...(slot.airsAt === undefined ? {} : { airsAt: slot.airsAt }),
        });
        const placement: Placement = { segmentId: segment.id, atIndex: slot.atIndex, kind: request.kind, written: true, ...(over ? { over } : {}) };

        if (!(await this.insert(lineup, [placement]))) {
            return { accepted: false, reason: 'the running order moved while this break was being placed' };
        }

        this.logger.info('director: put a requested break into the running order', {
            kind: request.kind,
            urgency: request.urgency,
            source: request.source,
            at: slot.atIndex,
        });
        return { accepted: true, requestId: request.id, segmentId: segment.id, atIndex: slot.atIndex };
    }

    /**
     * Write down a break that will take its slot only once it can actually be heard.
     *
     * The inversion, and the whole of why the two urgent urgencies exist. A planted break is put in
     * the order first and written afterwards, which is right for a routine one: another is coming, so
     * arriving at its slot unready costs a break the station could spare. A requested break has no
     * other one coming — the moment that caused it does not come round again — so nothing goes into
     * the order until there is audio, and {@link injectRequested} is what puts it there.
     *
     * `airsAt` is an ESTIMATE here rather than a projection, and it says so: nothing has a position
     * yet, so the best available answer is the soonest this urgency could be heard. It is what the
     * writer says the time from, and being wrong about it is caught twice over — by the request's own
     * expiry, and by the claim window the director checks at hand-over.
     */
    async prepareRequested(rules: ResolvedRules, request: StoredBreakRequest): Promise<{ segmentId: string } | { reason: string }> {
        const refusal = this.refuse(request.kind, rules);
        if (refusal !== undefined) return { reason: refusal };

        const segment = await this.segments.plan({
            kind: request.kind,
            label: labelFor(request.kind),
            requestId: request.id,
            airsAt: Date.now() + URGENCY[request.urgency].leadMs,
        });

        return { segmentId: segment.id };
    }

    /**
     * Put a break whose audio now exists at the front of what has not been committed.
     *
     * The other half of {@link prepareRequested}, and it needs no lead at all: the words are spoken,
     * the file is on disk, and the only thing left is a position. So it takes the earliest one the
     * order will accept, which is the next boundary the station reaches.
     *
     * A boundary already holding a break is walked past for {@link slotFor}'s reason — two breaks
     * back to back is worse than one boundary later — and an interruption rides the record it lands
     * in front of rather than sitting in the gap.
     *
     * Answers the index it took, or `undefined` for an order with nothing left to put a break in
     * front of. That is an ordinary answer rather than a failure: the request stays `ready` and the
     * next pass tries again against an order that has since been topped up.
     */
    async injectRequested(lineup: StationLineup, request: StoredBreakRequest, segmentId: string): Promise<number | undefined> {
        const items = lineup.all();
        let atIndex: number | undefined;
        for (let index = Math.max(0, lineup.committedThrough()); index < items.length; index++) {
            if (items[index]!.kind === 'segment') continue;
            atIndex = index;
            break;
        }
        if (atIndex === undefined) return undefined;

        const over = request.urgency === 'interrupt' ? { atMs: INTERRUPT_OVER_AT_MS } : undefined;
        const placed = await this.insert(lineup, [
            { segmentId, atIndex, kind: request.kind, written: true, ...(over === undefined ? {} : { over }) },
        ]);

        return placed ? atIndex : undefined;
    }

    /**
     * Whether this break can be produced at all, as a sentence saying why not.
     *
     * Public because a request is judged BEFORE anything is written down, which is what stops the
     * table filling with rows for a kind the station has no writer or no voice for. See
     * {@link refuse}.
     */
    cannotProduce(kind: string, rules: ResolvedRules): string | undefined {
        return this.refuse(kind, rules);
    }

    /**
     * Where a break of this urgency can still go, and when it would be heard.
     *
     * The first boundary at least `leadMs` away, which is what makes this a question about the clock
     * rather than about positions: a record with twenty seconds left and one with four minutes left
     * occupy the same INDEX and offer completely different amounts of time to write and speak in.
     *
     * A boundary already holding a segment is walked past rather than declined. Landing on one would
     * put two breaks back to back, and declining outright would lose a welcome because an ordinary
     * talk break happened to be planted where it wanted to go.
     *
     * `undefined` when the order does not reach far enough, or when everything inside a `soon`
     * request's deadline is taken. That is an ordinary answer: the caller may ask again on the next
     * boundary, against an order that has since been topped up.
     */
    private slotFor(lineup: StationLineup, clock: AirClock, urgency: BreakUrgency): { atIndex: number; airsAt?: number } | undefined {
        const items = lineup.all();
        const bounds = URGENCY[urgency];
        // `whenever` is the one urgency measured in positions rather than in time: it is asking for
        // an ordinary slot, and an ordinary slot stays out of the operator's reach exactly as far as
        // a planted break does.
        const from = lineup.committedThrough() + (urgency === 'whenever' ? PLANT_AHEAD : 0);
        const projected = projectAirTimes(items, clock.anchorAt, clock.from);
        const deadline = bounds.deadlineMs === undefined ? undefined : clock.now + bounds.deadlineMs;

        for (let index = Math.max(0, from); index < items.length; index++) {
            const at = projected[index];
            if (at === undefined || at < clock.now + bounds.leadMs) continue;
            if (deadline !== undefined && at > deadline) return undefined;
            if (items[index]!.kind === 'segment') continue;

            return { atIndex: index, airsAt: at };
        }

        return undefined;
    }

    /**
     * Why this break cannot be written at all, or `undefined` when it can.
     *
     * The same pair {@link plant} checks before it reads the library, for the same reason: a break
     * nothing can write, or nothing can speak, is a slot the station is silent in rather than a break
     * it takes. Answered as a sentence because a request has somebody waiting to be told.
     */
    private refuse(kind: string, rules: ResolvedRules): string | undefined {
        if (!rules.breaks) return 'the station has been told not to interrupt itself';
        // Judged HERE rather than in whatever asked, for the reason a pick is judged where it becomes
        // a track: this is the one place every welcome passes through, so the rule is true for a
        // console button and a scheduler as well as for the audience watch — and it is resolved
        // against the running order, so a broadcast may turn greetings off without touching the
        // station's own setting.
        if (kind === WELCOME_KIND && !rules.welcome) return 'the station has been told not to greet new listeners';
        if (!this.writers.canWrite(kind)) return `nothing on this station knows how to write a ${kind}`;
        if (this.speech.speaker() === undefined) return 'the station has no voice to speak with';

        return undefined;
    }

    /**
     * Put placements into the order, and clean up after an order that moved.
     *
     * Shared by both planting paths, because how a break ENTERS the running order is one decision
     * however it was chosen: positions are computed against the order as it stood a moment ago, and
     * a commit or an operator edit landing in between refuses the lot. Nothing is lost when it does
     * — the rows are failed rather than left looking like breaks that are still coming.
     */
    private async insert(lineup: StationLineup, placements: readonly Placement[]): Promise<boolean> {
        const result = lineup.insertSegments(
            placements.map(({ segmentId, atIndex, kind, over }) => ({
                segmentId,
                atIndex,
                segmentKind: kind,
                ...(over === undefined ? {} : { over }),
            })),
        );
        if (result.ok) return true;

        // The order moved under the walk: the director committed, or an operator edited, between
        // computing these positions and writing them. Nothing is lost — the next pass walks the
        // order as it stands and plants against that.
        this.logger.info('director: a break placement was refused; it will be planned again', { reason: result.reason });
        await this.abandon(placements);
        return false;
    }

    /**
     * Every slot the order is missing a break in, in the order the rules are allowed to claim them.
     *
     * ## Precedence is evaluation order
     *
     * Anchored rules first, then the operator's interval rules in the order they wrote them, then
     * the station's own spacing last as the floor. That is the same shape `BreakWriterRegistry` and
     * `SetGeneratorChain` already settle preference with, and it means an operator reorders lines
     * rather than learning a priority field.
     *
     * The one part that is NOT operator-ordered is anchored-before-spacing, and it is not a
     * judgement about importance: an anchored rule is the only one that cannot move. A spacing rule
     * asked to talk every fifteen minutes is equally right at fourteen or sixteen, so it can give
     * up a boundary and take the next one. A bulletin at nine cannot be at ten past.
     *
     * ## Nothing here remembers anything
     *
     * Every rule is recomputed from the order as it stands, so a restart changes nothing. `taken`
     * lives for the length of this call only, and its job is stopping two rules claiming one
     * boundary in a single pass — across passes that is the order's own business, because by then
     * the break is really in it.
     *
     * That last sentence used to end "so two passes racing produce the same answer", and it was true
     * of the two SPACING walks and false of the anchored one. A spacing rule asks a question about
     * the order and reads its own answer back out of it; an anchored rule asks a question about the
     * CLOCK, and what it reads back is a boundary index that moves as the tail grows. So the same
     * occurrence landed on two indices on two passes and was planted twice. {@link servedAlready} is
     * what makes the anchored walk read its own answer back the way the other two always did.
     */
    private slotsFor(
        lineup: StationLineup,
        rules: ResolvedRules,
        clock: AirClock,
        bands: readonly ClockBand[],
        chattiness: PersonaChattiness,
    ): Slot[] {
        const items = lineup.all();
        const cursor = lineup.committedThrough();
        const zone = stationZone(this.config);
        const projected = projectAirTimes(items, clock.anchorAt, clock.from);
        // A band naming a PRODUCTION kind is not asking for a break at a boundary, and this walk is
        // the wrong machinery for it entirely: making one takes minutes to hours, so it has to be
        // commissioned well ahead of its slot rather than filled at the boundary the slot lands on.
        // `ProductionScheduler` reads the same bands and does that. Left in, `fillBand` would ask
        // `BreakWriterRegistry` for a writer of that kind, find none, and decline the slot silently
        // once per pass — which reads exactly like a band that does not work.
        const forBreaks = bands.filter(band => !isProductionKind(band.kind, this.config));
        const taken = new Set<number>();
        const slots: Slot[] = [];

        // `airsAt` is the PROJECTION at this index, and every one of the three walks below passes it
        // now. It used to be the anchored walk's alone, on the reading that a time is what a
        // SCHEDULED break is for — which is true of why the projection is computed and false about
        // who needs it. What needs it is the writer: `WriteBreakJob` derives the clock, the greeting
        // and the daypart from `segments.airs_at` and skips all three when there is none, so a break
        // planted by the spacing floor was written by a model that had not been told what time of day
        // it was. Measured on the live station: 940 talk breaks, none with an `airs_at`, against
        // every news and welcome having one — and "tonight" going out at seven in the morning.
        //
        // Undefined is still an ordinary answer and is still dropped. `projectAirTimes` runs out past
        // the end of the order, which is a slot the walk can reach and the clock cannot describe.
        const claim = (atIndex: number, band?: ClockBand, airsAt?: number): void => {
            if (taken.has(atIndex)) return;
            taken.add(atIndex);
            slots.push({
                atIndex,
                ...(band === undefined ? {} : { band: band.kind }),
                ...(band?.topic === undefined ? {} : { topic: band.topic }),
                ...(airsAt === undefined ? {} : { airsAt }),
            });
        };

        // ── anchored ───────────────────────────────────────────────────────────
        for (const band of forBreaks) {
            if (!isAnchored(band)) continue;

            const target = nextOccurrence(band, clock.now, zone);
            const at = nextBoundaryAtOrAfter(projected, target, cursor + PLANT_AHEAD);

            // The order does not reach that far yet. Not a failure and not worth a log: the tail is
            // topped up continuously and a later pass asks again against a longer order.
            if (at === undefined) continue;

            // At or after the target is necessary and not sufficient. The first reachable boundary
            // can be a long way past it — the whole gap between here and it may already be inside
            // the window the player is holding, so the earliest slot the station can still program
            // is half an hour after the bulletin was due. A break that late is not a late bulletin,
            // it is the wrong one.
            if (projected[at]! - target > BAND_LATENESS_MS) {
                this.logger.info('director: a slot on the station clock came round with no boundary near enough to use', {
                    kind: band.kind,
                    at: new Date(target).toISOString(),
                });
                continue;
            }

            // Already a break here. Left alone rather than doubled, exactly as the spacing walk
            // leaves one alone — and correct even when it is somebody else's kind, because two
            // breaks in one gap is worse than a bulletin the DJ introduced.
            if (items[at]!.kind === 'segment') continue;

            // An occurrence this order already serves, which is the question the line above only
            // LOOKS like it asks. That one asks whether the boundary THIS pass chose is free, and
            // that is idempotent only while the projection holds still — which it does not, because
            // the tail is topped up continuously. So a later pass projects the same occurrence onto
            // a different index, finds that one empty, and plants a second bulletin for a slot that
            // is already covered. `nextOccurrence` reads the wall clock rather than the order, so
            // `target` sits still while the index under it moves, which is what makes the two passes
            // disagree about a question neither of them thinks it is asking.
            //
            // Measured on the live station: two news segments for one half past five, planted
            // thirty-three minutes apart at indices 24 and 26, projected to air fifty-four seconds
            // apart with a talk break between them. The second failed to write — `ReadLog` refusing
            // to read the same stories twice — which is the only reason it was ever visible.
            if (servedAlready(items, projected, cursor, band.kind, target)) continue;

            // Beside a break rather than on one: the line above covers the boundary's far side and
            // this covers the near one. An anchored rule cannot move — that is the whole of what
            // anchored means — so the occurrence is dropped rather than shifted, on the same terms
            // it is dropped when the boundary itself is taken. `taken` is the same question asked
            // about this pass, where the slot is a promise rather than a row.
            if (items[at - 1]?.kind === 'segment' || blockedBy(taken).has(at)) continue;

            // The PROJECTED time rather than the target, and the difference is what the break will
            // SAY. A band asked for 14:14 and the boundary that can take it airs at 14:17, so words
            // written about 14:14 describe a moment that has passed by the time anybody hears them.
            // The writer needs to know when this will actually be spoken; that the projection may be
            // a minute out is exactly what the claim window covers.
            claim(at, band, projected[at]!);
        }

        // ── the operator's own intervals ───────────────────────────────────────
        for (const band of forBreaks) {
            if (isAnchored(band)) continue;

            const counts = (item: StationLineupSegmentItem): boolean => item.segmentKind === band.kind;
            for (const at of placementsFor(items, cursor, band.everyMs, counts, sameKind(slots, band.kind), blockedBy(taken)))
                claim(at, band, projected[at]);
        }

        // ── the station's own, last, because the floor goes last ───────────────
        if (rules.breakEveryMinutes > 0) {
            const pending = new Set(slots.filter(slot => slot.band === undefined || isStationKind(slot.band)).map(slot => slot.atIndex));
            // The presenter's chattiness scales THIS interval and none of the three walks above it.
            // A band is an operator asking for a break at a time in as many words, and a habit does
            // not overrule an instruction — the same asymmetry `storytelling` has against a `story`
            // band. Rounded to a whole minute rather than left fractional, because the number an
            // operator typed is in minutes and a floor of 11.25 is a figure nothing on the console
            // could explain.
            const everyMs = Math.max(1, Math.round(rules.breakEveryMinutes * CHATTINESS_SPACING[chattiness])) * 60_000;
            for (const at of placementsFor(items, cursor, everyMs, isStationBreak, pending, blockedBy(taken))) claim(at, undefined, projected[at]);
        }

        return slots.sort((left, right) => left.atIndex - right.atIndex);
    }

    /**
     * Ask for the words of any break whose slot is coming up. Answers how many were asked for.
     *
     * Called from the same commit pass as {@link plant}, on every track boundary, and costs nothing
     * on the overwhelming majority of them: the window is a slice of an array in memory, and the one
     * query happens only when that slice actually holds a segment nobody has written yet.
     *
     * ## Sending is free, so this does not have to remember
     *
     * `WriteBreakJob` claims the row (`planned → writing`) before it does anything, so a second send
     * for the same break finds nothing to claim and stops. That is what lets this re-offer whatever
     * is still `planned` every single boundary instead of keeping a list of what it already asked
     * for — a list which, being in memory, would be wrong after every restart in exactly the
     * direction that loses breaks.
     *
     * It also means a lost job heals itself. A send that never arrived, a worker that died
     * mid-write: the row is still `planned` at the next boundary and gets offered again, right up
     * until its slot is close enough that the director hands it over unwritten and skips it.
     *
     * ## An off-air station writes nothing
     *
     * Because the pass that calls this only runs while the director is driving. That is the right
     * answer rather than an accident: a station nobody is listening to should not be paying a model
     * to write breaks nobody will hear.
     *
     * ## It repairs before it asks
     *
     * A break already written can still go wrong before its slot: the order moves under it and what
     * it promised stops being what plays next. The window this walks is exactly where that is worth
     * doing something about — there is still time for a rewrite — so {@link rewriteStale} runs first
     * and whatever it returns to `planned` is offered in the same pass. See `break.claims.ts` for
     * the question, which the director asks again at hand-over for the breaks this did not reach in
     * time.
     */
    async ripen(lineup: StationLineup): Promise<RipenResult> {
        const items = lineup.all();
        const from = lineup.committedThrough();
        const window = items.slice(Math.max(0, from), Math.max(0, from) + WRITE_AHEAD);

        const ids = [...new Set(window.flatMap(item => (item.kind === 'segment' ? [item.segmentId] : [])))];
        if (ids.length === 0) return NOTHING_RIPENED;

        const segments = await this.segments.findByIds(ids);
        // Before the claims, deliberately: a stranded render handed back becomes `written`, and if
        // what it says has ALSO stopped being true it should be re-written rather than re-spoken.
        // The other order would leave it queued to say the wrong thing correctly.
        const unstuck = await this.releaseStranded(ids);
        const stale = this.staleClaims(lineup, window, segments);
        const rewritten = await this.rewriteStale([...stale]);
        const rerendered = await this.retryRenders(ids, stale, unstuck.rendering);

        // `planned`, and what this pass has just returned to `planned`. A break already being
        // written belongs to whoever claimed it, one already written needs no words, and a failed
        // one with nothing on it is not retried by asking again — the reason it failed is that there
        // was nothing true to say, and that does not change.
        const revived = new Set([...unstuck.writing, ...rewritten]);
        const unwritten = ids.filter(id => segments.get(id)?.state === 'planned' || revived.has(id));
        const released = [...unstuck.writing, ...unstuck.rendering];
        if (unwritten.length === 0) return { offered: 0, rewritten, released, rerendered };

        for (const segmentId of unwritten) await this.jobs.send('director.write_break', { segmentId });

        this.logger.info('director: asked for the words of breaks coming up', { count: unwritten.length });
        return { offered: unwritten.length, rewritten, released, rerendered };
    }

    /**
     * Hand back any break in this window whose job died holding it.
     *
     * The failure this exists for is silent and permanent. A worker killed between claiming a break
     * and finishing it leaves the row in `writing` or `rendering`; the job's retry re-claims nothing
     * because the claim it needs has already been taken, and `ripen` does not offer it because it is
     * not `planned`. The break is then skipped at its slot and at every slot it is ever given. There
     * are rows in this station's own database that have been stuck like that since August.
     *
     * How long is too long is a fact about the JOB rather than about the row, which is why the bound
     * is decided here and not in the repository: see the two constants and the policies they sit
     * above.
     *
     * Swallowed for {@link rewriteStale}'s reason. A sweep that could not run leaves the rows exactly
     * as stuck as they already were, which is not worth the words of every other break in the window.
     */
    private async releaseStranded(ids: readonly string[]): Promise<StrandedRelease> {
        const now = Date.now();

        try {
            const released = await this.segments.releaseStranded(ids, {
                writing: now - WRITING_STRANDED_MS,
                rendering: now - RENDERING_STRANDED_MS,
            });

            if (released.writing.length > 0 || released.rendering.length > 0) {
                this.logger.info('director: took back a break whose job never finished', {
                    writing: released.writing,
                    rendering: released.rendering,
                });
            }
            return released;
        } catch (error) {
            this.logger.warn(`director: could not take back a break whose job never finished (${errorText(error)})`);
            return { writing: [], rendering: [] };
        }
    }

    /**
     * Un-write the breaks in this window whose words have stopped being true.
     *
     * The counterpart of `SegmentRepository.reopenClaims`, which catches the case a RECORD announces
     * for itself by leaving the order. This catches the rest, which the database cannot see: an
     * operator's move leaves every row exactly as it was and changes only what sits beside what, and
     * a break that named a time is overtaken by nothing but the clock. Both used to end at a dropped
     * break and a boundary of silence. (A shuffle is not one of these any more: it drops its breaks
     * and has them planted again, so there is no row left holding words about the old sequence.)
     *
     * Which breaks those are is {@link staleClaims}'s answer, because the render retry needs the
     * same verdict and two readings of one claim that could disagree would be two bugs waiting.
     *
     * Failures are swallowed here rather than left to the caller's catch, because they are not the
     * same failure: a repair that could not run costs one break its rewrite, and the words of every
     * OTHER break in this window are still worth asking for.
     */
    private async rewriteStale(stale: readonly string[]): Promise<string[]> {
        if (stale.length === 0) return [];

        try {
            // Nothing is filtered by state first: `reopenSegments` will not touch a row a job has
            // claimed, and keeping that rule in one place is what stops the two from drifting.
            const reopened = await this.segments.reopenSegments(stale);
            if (reopened.length > 0) {
                this.logger.info('director: a break in the window no longer says anything true, so it will be written again', {
                    segments: reopened,
                });
            }
            return reopened;
        } catch (error) {
            this.logger.warn(`director: could not re-open a break whose words had gone stale (${errorText(error)})`);
            return [];
        }
    }

    /**
     * Which breaks in this window no longer say anything true.
     *
     * The verdict is `brokenClaim`, the same expression the hand-over check reads, so nothing here
     * can throw away a break that would have aired perfectly well.
     *
     * A segment sitting at more than one position counts as broken only when its promise is broken
     * at EVERY one of them: idents come from a shared library and the same row is legitimately at
     * three slots in an hour, so judging it at the first position would condemn a break that is
     * correct at the other two.
     *
     * The one verdict this does NOT act on is a time claim that has not arrived yet, which is the
     * ordinary state of every break written ahead of its own window and the one fault a rewrite
     * cannot repair — it would re-derive the same phrasing from the same `airsAt`. Read the note in
     * `break.claims.ts` before removing this: acting on it looped, and the loop spent the news.
     */
    private staleClaims(lineup: StationLineup, window: readonly StationLineupItem[], segments: Map<string, Segment>): Set<string> {
        const now = Date.now();
        // Segment id to whether every position it holds is broken. Seeded true by the first
        // position and narrowed by the rest, so one position that still holds spares the row.
        const verdicts = new Map<string, boolean>();

        for (const item of window) {
            if (item.kind !== 'segment') continue;

            const segment = segments.get(item.segmentId);
            // A break that claimed nothing cannot be wrong, which is most of them, and skipping
            // them here keeps the ordinary pass free of any question at all.
            if (segment === undefined || (segment.claimsItemId === undefined && segment.claimsTime === undefined)) continue;

            const stale = worthRewriting(brokenClaim(segment, lineup.nextTrackAfter(item.id)?.id, now));
            verdicts.set(item.segmentId, (verdicts.get(item.segmentId) ?? true) && stale);
        }

        return new Set([...verdicts].flatMap(([segmentId, broken]) => (broken ? [segmentId] : [])));
    }

    /**
     * Ask again for the audio of a break whose words survived a render that did not.
     *
     * Every failed segment on this station is the same thing: a speech server that was not running,
     * with a perfectly good script sitting beside the error. `claimForRender` has always accepted
     * `failed` and re-spoken the words on the row — that is what the operator's own retry does — and
     * nothing ever asked on the station's behalf, so a break lost to a restart stayed lost.
     *
     * Three bounds, and each one closes a way this could churn.
     *
     * **No speaker, no asking.** A station with no speech plugin installed cannot render anything,
     * and four of the six failures in this station's history are exactly that. Checked first because
     * it costs nothing and removes the loudest case entirely.
     *
     * **Three failures and it stops.** A break that has failed three times is more likely to be one
     * nothing can speak than a run of bad luck, and without a cap a dead engine would have every
     * failed break in the window re-sent on every boundary, for as long as it stays dead.
     *
     * **Nothing whose claim has broken.** Those words are wrong as well as unspoken, so paying for
     * the audio would buy a break the hand-over check drops anyway. They are left `failed`, which is
     * what they already were: `reopenSegments` deliberately does not reach a failed row, and
     * widening it to would be a different argument than this one.
     *
     * A send is idempotent, because `claimForRender` is a conditional update — so a duplicate is
     * free, exactly as it is for the write job.
     */
    /**
     * Ask again for the audio of ONE break that is not in the running order.
     *
     * The same question {@link retryRenders} answers for the window, for the one case that walk
     * cannot reach: an `interrupt` or `next` request is rendered BEFORE it is injected, so its
     * segment has no position and `ripen` never sees it. Without this, a render that lost the race
     * with plugin startup — or any other failure — stranded the request until it expired, and a
     * welcome was lost outright because an operator saved a plugin setting at the wrong second.
     * `docs/todo/render-plugin-readiness.md` piece 2.
     *
     * It shares {@link MAX_RENDER_ATTEMPTS} and the no-speaker rule with `retryRenders` rather than
     * restating them, because a bound that means one thing in the order and another outside it is
     * the kind of divergence nobody finds. A `written` row is free to ask for — it has never been
     * tried — so only the `failed` case is counted against the bound.
     *
     * @returns whether it asked, so the caller can leave the request pending rather than failing it.
     */
    async retryRenderOf(segment: Segment): Promise<boolean> {
        if (segment.state !== 'written' && segment.state !== 'failed') return false;
        if (this.speech.speaker() === undefined) return false;

        try {
            if (segment.state === 'failed') {
                const [row] = await this.segments.failedWithScript([segment.id]);
                if (row === undefined || row.failures >= MAX_RENDER_ATTEMPTS) return false;
            }

            await this.jobs.send('render.segment', { segmentId: segment.id });
            this.logger.info('director: asking again for the audio of a break the station is waiting on', {
                segment: segment.id,
                state: segment.state,
            });
            return true;
        } catch (error) {
            this.logger.warn(`director: could not ask again for the audio of a waiting break (${errorText(error)})`);
            return false;
        }
    }

    private async retryRenders(ids: readonly string[], stale: ReadonlySet<string>, alsoRender: readonly string[]): Promise<string[]> {
        if (this.speech.speaker() === undefined) return [];

        try {
            const failed = await this.segments.failedWithScript(ids);
            const retry = [
                ...failed.filter(row => row.failures < MAX_RENDER_ATTEMPTS && !stale.has(row.id)).map(row => row.id),
                // A render handed back by the sweep above: it is `written` with its words intact and
                // nothing else would ever ask for its audio.
                ...alsoRender.filter(id => !stale.has(id)),
            ];
            if (retry.length === 0) return [];

            for (const segmentId of retry) await this.jobs.send('render.segment', { segmentId });

            this.logger.info('director: asking again for the audio of a break that never got any', { segments: retry });
            return retry;
        } catch (error) {
            this.logger.warn(`director: could not ask again for the audio of a failed break (${errorText(error)})`);
            return [];
        }
    }

    /**
     * One break per slot, alternating what sort each one is.
     *
     * A written break at one slot and a recorded ident at the next, which is what keeps the
     * station's own name in rotation instead of letting the DJ become the only voice on the
     * station. The alternation runs from the kind of the last segment ALREADY in the order rather
     * than restarting per pass, or a pass that plants one break at a time would plant the same kind
     * every time and never alternate at all.
     *
     * Availability wins over the alternation, in both directions: a station with no idents recorded
     * gets talk breaks at every slot, and one with no speaker gets idents at every slot. Neither
     * needs a branch anywhere else, and neither is worth skipping a break over.
     */
    private async fill(wanted: readonly Slot[], idents: readonly Segment[], canWrite: boolean, lastKind: string | undefined): Promise<Placement[]> {
        const placements: Placement[] = [];
        let previousKind = lastKind;
        // Chosen per slot rather than once per pass, so two idents planted together are two
        // different recordings where the library has them.
        let previousIdent: string | undefined;
        // Read at most once per kind, and only for a kind a band actually asked for, so a station
        // with no schedule pays nothing for this.
        const shelved = new Map<string, readonly Segment[]>();

        for (const { atIndex, band, topic, airsAt } of wanted) {
            // A slot the operator's clock placed is filled with EXACTLY the kind they named, and
            // never handed to the alternation below. That looks like it should have an exception
            // for `talkbreak`, which the station's own rule also plants, and it must not have one:
            // running it showed why. A band saying `:00 talkbreak` fell through to the alternation,
            // came out as an ordinary break with no time on it, and half the time came out as an
            // ident instead — so the top-of-the-hour break, which is the whole reason somebody
            // writes a clock, never once said what time it was. What makes a break a band's is that
            // a time was asked for, not which kind was named.
            if (band !== undefined) {
                const planted = await this.fillBand(band, atIndex, shelved, airsAt, topic);
                if (planted !== undefined) placements.push(planted);
                // The alternation is deliberately NOT advanced. What the operator scheduled is not
                // the station taking its turn at anything.
                continue;
            }

            const write = canWrite && (previousKind !== TALK_BREAK_KIND || idents.length === 0);

            if (write) {
                // A placeholder label. The writer replaces it with one naming the records it sits
                // between, at the same moment and by the same hand as the script.
                //
                // `airsAt` rides the row for `fillBand`'s reason exactly, and it is the ordinary
                // break rather than the scheduled one that had been going without: the words are
                // asked for on a later pass and nothing recomputes the projection in between.
                const segment = await this.segments.plan({
                    kind: TALK_BREAK_KIND,
                    label: 'Talk break',
                    ...(airsAt === undefined ? {} : { airsAt }),
                });
                placements.push({ segmentId: segment.id, atIndex, kind: TALK_BREAK_KIND, written: true });
                previousKind = TALK_BREAK_KIND;
                continue;
            }

            const segment = choose(idents, previousIdent);
            previousIdent = segment.id;
            placements.push({ segmentId: segment.id, atIndex, kind: IDENT_KIND, written: false });
            previousKind = IDENT_KIND;
        }

        return placements;
    }

    /**
     * One slot an operator's band asked for, filled with a break of the kind it named.
     *
     * Two ways to fill it and they are tried in the order that costs least: something that can
     * WRITE this kind gets a `planned` row exactly as a talk break does, and otherwise a recording
     * of that kind off the shelf. Answering `undefined` — nothing can write it and the library
     * holds none — is an ordinary outcome and says so once, because a station whose schedule names
     * `news` before anything can produce news is a station mid-setup rather than a broken one.
     *
     * Nothing here validates the kind against a list. `segments.kind` is free text on purpose, so a
     * station that wants sponsor spots writes `:20 sponsor`, drops the recordings in the inbox, and
     * needs no migration and no code.
     */
    private async fillBand(
        kind: string,
        atIndex: number,
        shelved: Map<string, readonly Segment[]>,
        airsAt: number | undefined,
        topic: ClockBandSubject | undefined,
    ): Promise<Placement | undefined> {
        if (this.writers.canWrite(kind) && this.speech.speaker() !== undefined) {
            // `airsAt` travels on the row rather than in the write job's payload, because the words
            // are asked for on a LATER pass than this one and nothing recomputes the schedule in
            // between: `ripen` re-offers whatever is still planned and knows nothing about bands.
            const segment = await this.segments.plan({
                kind,
                // The subject's own label where it named one, so a console reading the running order
                // says "Technology news" rather than leaving an operator to work out why one
                // bulletin differs from the next.
                label: topic === undefined ? labelFor(kind) : `${topic.label} ${labelFor(kind).toLowerCase()}`,
                ...(airsAt === undefined ? {} : { airsAt }),
                // What this break is about, on the ROW: the words are asked for several passes later
                // and nothing recomputes the clock in between. The KEY rather than the id, because
                // that is what the writer for the kind reads and what a log line names.
                ...(topic === undefined ? {} : { context: { topic: topic.key } }),
            });
            return { segmentId: segment.id, atIndex, kind, written: true };
        }

        if (!shelved.has(kind)) shelved.set(kind, await this.segments.listReady(kind));
        const available = shelved.get(kind) ?? [];

        if (available.length === 0) {
            this.logger.info('director: the station clock asks for a break nothing can produce', { kind });
            return undefined;
        }

        return { segmentId: choose(available, undefined).id, atIndex, kind, written: false };
    }

    /**
     * What sort of break the station last put in this order, before the first slot being filled.
     *
     * Costs one query, and only on a pass that is actually planting something — which is the rare
     * one. The lineup item names a segment by id and nothing else (`deadair.segments` is the single
     * truth for the rest), so the kind has to be read rather than remembered. A segment that has
     * since been deleted reads as no answer at all, which starts the alternation fresh.
     */
    private async lastKindBefore(lineup: StationLineup, before: number): Promise<string | undefined> {
        const items = lineup.all();
        for (let index = Math.min(before, items.length) - 1; index >= 0; index--) {
            const item = items[index]!;
            if (item.kind !== 'segment') continue;

            const found = await this.segments.findByIds([item.segmentId]);
            return found.get(item.segmentId)?.kind;
        }
        return undefined;
    }

    /**
     * Rows planned for an order that then refused them.
     *
     * Failed rather than deleted, and rather than left `planned`. Left planned they would be picked
     * up by nothing and sit in the console's library looking like breaks that are still coming;
     * failed, they carry the reason and are inert. Rare by construction: it takes a commit or an
     * operator edit landing between the walk and the write.
     */
    private async abandon(placements: readonly Placement[]): Promise<void> {
        for (const placement of placements) {
            if (!placement.written) continue;
            await this.segments.markFailed(placement.segmentId, 'the running order moved before this break could be placed', 'planned');
        }
    }
}

/**
 * Where the station is against the wall clock, as the caller sees it.
 *
 * Handed in rather than read here, because the transport is the thing that knows when the item on
 * air started and the module edge runs playout <- director. `anchorAt` is when the item at `from`
 * began; everything after it is projected.
 *
 * Note what is deliberately absent: the decoder's `remainingMs`. `rundown.ts` says nothing
 * schedules against it and this is not the exception — a jumpy reading would move every boundary
 * behind it, and `startedAt` plus the order's own durations is a steadier answer to the same
 * question.
 */
export interface AirClock {
    /** Now, as epoch millis. What a band's next occurrence is measured from. */
    now: number;
    /** When the item at {@link from} started, or now when nothing is airing. */
    anchorAt: number;
    /** The index {@link anchorAt} describes. */
    from: number;
}

/** A boundary a rule claimed, and which rule claimed it. `band` absent is the station's own. */
interface Slot {
    atIndex: number;
    band?: string;
    /**
     * What the band that claimed this slot is ABOUT, when it named something.
     *
     * Carried through as the band's own `topic` rather than looked up again: the walk already has
     * the band in hand, and a second read on the commit path to answer a question already answered
     * would be work for nothing.
     */
    topic?: ClockBandSubject;
    /**
     * When this slot is expected to reach the air, for an anchored rule.
     *
     * The boundary's PROJECTED time rather than the time the operator asked for. The two differ by
     * up to {@link BAND_LATENESS_MS}, because the order is made of whole records and a band rarely
     * falls on a gap — and the difference is what the break would say out loud. Words written about
     * a target the station then reached three minutes late describe a moment that has already
     * passed.
     */
    airsAt?: number;
}

/** One break, and where it goes. `written` distinguishes a row to write from an ident off the shelf. */
interface Placement {
    segmentId: string;
    atIndex: number;
    /** What sort of break it is, carried onto the order so the spacing walk can count it. */
    kind: string;
    written: boolean;
    /**
     * How far into the record behind it this speaks, for a talk-over.
     *
     * Absent for every break the station plants for itself: those sit in the gap between two records,
     * which is what a break normally is. Present only for an interrupting request, which rides the
     * record rather than waiting for its end.
     */
    over?: { atMs: number };
}

/**
 * Whether a segment is one of the station's own breaks, for the purposes of spacing.
 *
 * An ident and a talk break are one rule rather than two: they alternate, they do the same job —
 * telling a listener what they are listening to — and a station that counted them separately would
 * say its own name twice as often as asked. Everything else is somebody else's rule.
 *
 * **A welcome counts as one of them**, on exactly that argument: it names the station to somebody who
 * has just arrived, which is the ident's whole job. Left out, the spacing walk would read straight
 * past it and plant an ordinary break a boundary later, so the first thing a new listener heard would
 * be the station introducing itself twice.
 *
 * **A segment with no kind counts here**, because an order written before the running order carried
 * one holds nothing but the station's own breaks. Guessing the other way would have the station
 * talk over the top of breaks it had already planted, once, on the first pass after an upgrade.
 */
const isStationKind = (kind: string): boolean => kind === IDENT_KIND || kind === TALK_BREAK_KIND || kind === WELCOME_KIND;

const isStationBreak = (item: StationLineupSegmentItem): boolean => item.segmentKind === undefined || isStationKind(item.segmentKind);

/** The slots this pass claimed for a kind, so a later rule for the same kind can see them. */
const sameKind = (slots: readonly Slot[], kind: string): Set<number> => new Set(slots.filter(slot => slot.band === kind).map(slot => slot.atIndex));

/**
 * Whether the order already holds a break of `kind` for the occurrence at `target`.
 *
 * The cross-pass half of an anchored band's idempotence, and the half the walk never had. See the
 * call site for the failure; what matters here is the shape of the question. A planted bulletin
 * carries no record of which occurrence it was planted FOR — nothing stores that — so the only thing
 * that can identify it afterwards is where it lands on the clock, and the tolerance for that is the
 * one the walk already uses to decide a boundary is near enough to serve the occurrence at all.
 * Anything the walk would have accepted as this occurrence's slot therefore counts as it, which is
 * exactly the property that stops a second one going in.
 *
 * Three things are deliberate:
 *
 * - **The window is symmetric**, where {@link BAND_LATENESS_MS}'s other use is one-sided. That check
 *   is about a boundary being too LATE to still be this bulletin; this one is about recognising a
 *   bulletin already planted, and a projection that drifted can have moved it either side of the
 *   target since.
 * - **`segmentKind` must EQUAL the band's kind.** It is optional, and absent means the station's own
 *   break (see the field), so an unlabelled segment must never be read as satisfying a band — that
 *   would let one ident silence every bulletin behind it.
 * - **From the cursor forward only.** A bulletin already behind the head belongs to an occurrence
 *   that has been and gone, and the projection there describes the past.
 *
 * The consequence worth stating: two anchored bands of the SAME kind less than
 * {@link BAND_LATENESS_MS} apart now collapse to one break rather than two. That is the intended
 * reading — two bulletins ten minutes apart is the failure this exists to stop, whichever pair of
 * rules asked for them — but it is a behaviour change and an operator who wrote both bands meant
 * something by it.
 */
const servedAlready = (
    items: readonly StationLineupItem[],
    projected: readonly (number | undefined)[],
    cursor: number,
    kind: string,
    target: number,
): boolean =>
    items.some(
        (item, index) =>
            index >= cursor &&
            item.kind === 'segment' &&
            item.segmentKind === kind &&
            projected[index] !== undefined &&
            Math.abs(projected[index]! - target) <= BAND_LATENESS_MS,
    );

/**
 * The boundaries no further slot may take, given the ones already claimed this pass.
 *
 * Each claim blocks itself and both its neighbours, because two breaks with no record between them
 * is the thing every walk here already says it is avoiding — "two breaks back to back is worse than
 * one boundary later" appears twice in this file — and nothing was enforcing it across rules. Each
 * walk checks whether the boundary it CHOSE is free by reading `items`, and a slot claimed a moment
 * earlier by a rule that ran first is not in `items`; it is a promise to insert one. So the station's
 * own floor could take the boundary directly after an anchored bulletin, and the listener got a
 * bulletin and a talk break with nothing in between. On the order this was found in there were
 * three: news, talk break, news.
 *
 * Adjacency only, deliberately. A gap of one record between two breaks is a programming decision an
 * operator can make with two bands, and nothing here should have an opinion about it — what a
 * listener hears as a fault is the pair with no record at all.
 */
const blockedBy = (taken: ReadonlySet<number>): Set<number> => {
    const blocked = new Set<number>();
    for (const at of taken) {
        blocked.add(at - 1);
        blocked.add(at);
        blocked.add(at + 1);
    }
    return blocked;
};

/** What the console calls a break of a kind nothing has named yet. */
const labelFor = (kind: string): string => `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;

/**
 * Where breaks of ONE kind belong in an order that already has some.
 *
 * Walks forward from the cursor accumulating airtime, and marks a slot whenever it reaches the
 * spacing. A break this rule owns resets the accumulator rather than adding to it, which is what
 * makes this idempotent: run it twice and the second walk sees what the first one planted. A break
 * belonging to some OTHER rule is neither — it adds its own length (nothing, since no segment has
 * ever been measured) and leaves the count alone, so a bulletin cannot push the next ident back.
 *
 * The count starts from the last break of this kind at or before the cursor rather than from zero.
 * Starting at zero would put a break a full interval after whatever the station happens to be
 * playing, so an app restarted mid-rotation would talk again immediately after having just talked.
 *
 * Returns indices into the order as it stands, which is what
 * {@link StationLineup.insertSegments} expects.
 */
function placementsFor(
    items: readonly StationLineupItem[],
    cursor: number,
    everyMs: number,
    counts: (item: StationLineupSegmentItem) => boolean,
    // Boundaries where a break of this kind has already been claimed THIS PASS by a rule that ran
    // earlier — an anchored bulletin, say, against an interval rule for the same kind. They are not
    // in the order yet, so the walk would otherwise plant a second one a moment later and the two
    // would air back to back.
    pending: ReadonlySet<number> = new Set(),
    // Boundaries this slot may not take at all, because one has been claimed there or beside it this
    // pass by ANY rule. See {@link blockedBy} for why adjacency counts and why this is separate from
    // `pending`: that one is about whether a break resets this rule's clock, which is a different
    // question with a different answer. Skipped exactly as a boundary already holding a break is —
    // the walk carries on WITHOUT resetting its count, so the break lands at the next boundary it
    // can rather than being lost for the whole interval.
    blocked: ReadonlySet<number> = new Set(),
): number[] {
    let since = elapsedSinceLastOfKind(items, cursor, counts);
    const placements: number[] = [];

    for (let index = cursor; index < items.length; index++) {
        // A claimed slot sits BEFORE the item at this index, so it counts before the item does.
        if (pending.has(index)) since = 0;

        const item = items[index]!;
        if (item.kind === 'segment' && counts(item)) {
            since = 0;
            continue;
        }

        since += spacingLengthOf(item);
        if (since < everyMs) continue;

        // After this record, not before it: the slot is the boundary the listener reaches once they
        // have heard `everyMs` of programme.
        const at = index + 1;

        // Never at the very end of the order, where a break would air after the last record rather
        // than between two of them. Nothing later in this walk can qualify either.
        if (at >= items.length) break;

        // Already a break here. Leave it alone and let the loop's own segment branch reset the
        // count when it reaches it: planting anyway is how a second pass over an order this has
        // already planted into doubles every one of them.
        if (items[at]!.kind === 'segment') continue;

        // And never directly AFTER one. A break inserted at `at` sits between `items[at - 1]` and
        // `items[at]`, so the check above covers one of its two neighbours and this covers the
        // other — which is the one that was missing, and it is missing across PASSES rather than
        // within one. A bulletin planted by an earlier pass is a segment this walk reaches, falls
        // through (it belongs to another rule, so it neither counts nor resets), and then offers
        // the boundary immediately after it as the next slot. Measured on the live station: news
        // at index 24, a talk break at 25 planted four minutes later, and a second bulletin at 26
        // half an hour after that. Three breaks, no records between them.
        //
        // Skipped without resetting the count, exactly as the two checks around it are: the break
        // is overdue, so it takes the next boundary it legally can rather than waiting out another
        // interval.
        if (items[at - 1]?.kind === 'segment') continue;

        // A boundary claimed this pass, or the one either side of it. The two checks above read
        // `items`, which holds what earlier PASSES planted; a slot another rule claimed a moment
        // ago in THIS pass is not in there yet, it is a promise to insert one.
        if (blocked.has(at)) continue;

        // Too close to the cursor to be programmed: that part of the order is about to be handed
        // over. Deliberately WITHOUT resetting the count, so the break lands at the first position
        // it legally can rather than a full interval later — it is already overdue, and pushing it
        // back again is how a station that was restarted goes quiet for twice as long as it should.
        if (at < cursor + PLANT_AHEAD) continue;

        placements.push(at);
        since = 0;
    }

    return placements;
}

/**
 * How much airtime has passed since the station last aired a break of this kind.
 *
 * Walks back over what has already been heard, so nothing here is projected: these items aired and
 * their lengths are whatever the catalog said they were. A break of another kind is walked straight
 * past, which is the backwards half of the same rule the forward walk applies.
 */
function elapsedSinceLastOfKind(items: readonly StationLineupItem[], cursor: number, counts: (item: StationLineupSegmentItem) => boolean): number {
    let elapsed = 0;
    for (let index = Math.min(cursor, items.length) - 1; index >= 0; index--) {
        const item = items[index]!;
        if (item.kind === 'segment' && counts(item)) return elapsed;
        elapsed += spacingLengthOf(item);
    }
    return elapsed;
}

/**
 * How much of the clock an item spends, for spacing.
 *
 * Deliberately NOT `air.clock.ts`'s answer. See {@link NOMINAL_TRACK_MS}: a record nobody measured
 * counts as an average one here and as nothing there, because a spacing rule would rather be
 * roughly right than certainly late and an anchored one would rather be late than early.
 *
 * A segment counts as nothing, which is the one thing both agree on: nothing has ever measured one,
 * and an ident is a few seconds against an interval of a quarter of an hour.
 */
function spacingLengthOf(item: StationLineupItem): number {
    if (!isTrackItem(item)) return 0;

    const { durationMs, cueInMs, cueOutMs } = item.track;
    if (cueOutMs !== undefined) return Math.max(0, cueOutMs - (cueInMs ?? 0));

    return durationMs === undefined ? NOMINAL_TRACK_MS : Math.max(0, durationMs - (cueInMs ?? 0));
}

/**
 * One segment for a slot, avoiding the one just used.
 *
 * Random rather than round-robin because the order the library happens to be in
 * is not a running order, and a station that always plays its three idents in the
 * same sequence sounds like a tape loop within an hour. Avoiding the previous one
 * is the only structure worth imposing: hearing the same ident twice running is
 * the one arrangement a listener actually notices.
 */
function choose(available: readonly Segment[], previous: string | undefined): Segment {
    const others = available.filter(segment => segment.id !== previous);
    const pool = others.length > 0 ? others : available;
    return pool[Math.floor(Math.random() * pool.length)]!;
}
