import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { nextBoundaryAtOrAfter, projectAirTimes } from './air.clock.js';
import { isAnchored, nextOccurrence, stationBands } from './clock.bands.js';
import { stationZone } from './clock.words.js';
import { SegmentRepository, type Segment } from '#modules/render/segment.repository.js';
import { SpeechService } from '#modules/render/speech.service.js';
import { BreakWriterRegistry } from './break.writer.registry.js';
import { isTrackItem, type StationLineup, type StationLineupItem, type StationLineupSegmentItem } from './station.lineup.js';
import type { ResolvedRules } from './rotation.rules.js';
import { TALK_BREAK_KIND } from './talk.break.writer.js';

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
 * Eight, against a `COMMIT_LEAD` of 3. A break must be `ready` before the pass that hands it over
 * reaches it, so the window leaves roughly five records of airtime — call it a quarter of an hour —
 * for a write and a render to finish, which is generous against a model answering at a couple of
 * tokens a second and still cuts the horizon from about an hour to about fifteen minutes.
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

        const wanted = this.slotsFor(lineup, rules, clock);
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

        const result = lineup.insertSegments(placements.map(({ segmentId, atIndex, kind }) => ({ segmentId, atIndex, segmentKind: kind })));
        if (!result.ok) {
            // The order moved under the walk: the director committed, or an operator edited, between
            // computing these positions and writing them. Nothing is lost — the next pass walks the
            // order as it stands and plants against that.
            this.logger.info('director: a break placement was refused; it will be planned again', { reason: result.reason });
            await this.abandon(placements);
            return 0;
        }

        // Nothing is sent for writing here. A break is written when its slot comes near rather than
        // when it is planted, which is {@link ripen}'s job on the same pass. What that preserves is
        // this method's whole shape: planting stays one cheap write per slot with no model and no
        // speech engine anywhere near it, so an order gets its breaks laid out an hour ahead and
        // pays for the words fifteen minutes ahead.
        this.logger.info('director: planted breaks into the running order', { count: placements.length, written: canWrite });
        return placements.length;
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
     * Every rule is recomputed from the order as it stands, so two passes racing produce the same
     * answer and a restart changes nothing. `taken` lives for the length of this call only, and its
     * job is stopping two rules claiming one boundary in a single pass — across passes that is the
     * order's own business, because by then the break is really in it.
     */
    private slotsFor(lineup: StationLineup, rules: ResolvedRules, clock: AirClock): Slot[] {
        const items = lineup.all();
        const cursor = lineup.committedThrough();
        const { bands, rejected } = stationBands(this.config);

        for (const line of rejected) {
            // Quoted, and at info rather than warn: a half-typed schedule is somebody editing, not
            // a fault. It is said every pass because the alternative is a rule that silently does
            // nothing and an operator with nowhere to look.
            this.logger.info('director: a line of the station clock could not be read and was ignored', { line });
        }

        const zone = stationZone(this.config);
        const projected = projectAirTimes(items, clock.anchorAt, clock.from);
        const taken = new Set<number>();
        const slots: Slot[] = [];

        const claim = (atIndex: number, band?: string, airsAt?: number): void => {
            if (taken.has(atIndex)) return;
            taken.add(atIndex);
            slots.push({ atIndex, ...(band === undefined ? {} : { band }), ...(airsAt === undefined ? {} : { airsAt }) });
        };

        // ── anchored ───────────────────────────────────────────────────────────
        for (const band of bands) {
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

            // The PROJECTED time rather than the target, and the difference is what the break will
            // SAY. A band asked for 14:14 and the boundary that can take it airs at 14:17, so words
            // written about 14:14 describe a moment that has passed by the time anybody hears them.
            // The writer needs to know when this will actually be spoken; that the projection may be
            // a minute out is exactly what the claim window covers.
            claim(at, band.kind, projected[at]!);
        }

        // ── the operator's own intervals ───────────────────────────────────────
        for (const band of bands) {
            if (isAnchored(band)) continue;

            const counts = (item: StationLineupSegmentItem): boolean => item.segmentKind === band.kind;
            for (const at of placementsFor(items, cursor, band.everyMs, counts, sameKind(slots, band.kind))) claim(at, band.kind);
        }

        // ── the station's own, last, because the floor goes last ───────────────
        if (rules.breakEveryMinutes > 0) {
            const pending = new Set(slots.filter(slot => slot.band === undefined || isStationKind(slot.band)).map(slot => slot.atIndex));
            for (const at of placementsFor(items, cursor, rules.breakEveryMinutes * 60_000, isStationBreak, pending)) claim(at);
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
     */
    async ripen(lineup: StationLineup): Promise<number> {
        const items = lineup.all();
        const from = lineup.committedThrough();
        const window = items.slice(Math.max(0, from), Math.max(0, from) + WRITE_AHEAD);

        const ids = window.flatMap(item => (item.kind === 'segment' ? [item.segmentId] : []));
        if (ids.length === 0) return 0;

        const segments = await this.segments.findByIds(ids);
        // `planned` and nothing else. A break already being written belongs to whoever claimed it,
        // one already written needs no words, and a failed one is not retried by asking again — the
        // usual reason it failed is that there was nothing true to say, and that does not change.
        const unwritten = ids.filter(id => segments.get(id)?.state === 'planned');
        if (unwritten.length === 0) return 0;

        for (const segmentId of unwritten) await this.jobs.send('director.write_break', { segmentId });

        this.logger.info('director: asked for the words of breaks coming up', { count: unwritten.length });
        return unwritten.length;
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

        for (const { atIndex, band, airsAt } of wanted) {
            // A slot the operator's clock placed is filled with EXACTLY the kind they named, and
            // never handed to the alternation below. That looks like it should have an exception
            // for `talkbreak`, which the station's own rule also plants, and it must not have one:
            // running it showed why. A band saying `:00 talkbreak` fell through to the alternation,
            // came out as an ordinary break with no time on it, and half the time came out as an
            // ident instead — so the top-of-the-hour break, which is the whole reason somebody
            // writes a clock, never once said what time it was. What makes a break a band's is that
            // a time was asked for, not which kind was named.
            if (band !== undefined) {
                const planted = await this.fillBand(band, atIndex, shelved, airsAt);
                if (planted !== undefined) placements.push(planted);
                // The alternation is deliberately NOT advanced. What the operator scheduled is not
                // the station taking its turn at anything.
                continue;
            }

            const write = canWrite && (previousKind !== TALK_BREAK_KIND || idents.length === 0);

            if (write) {
                // A placeholder label. The writer replaces it with one naming the records it sits
                // between, at the same moment and by the same hand as the script.
                const segment = await this.segments.plan({ kind: TALK_BREAK_KIND, label: 'Talk break' });
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
    ): Promise<Placement | undefined> {
        if (this.writers.canWrite(kind) && this.speech.speaker() !== undefined) {
            // `airsAt` travels on the row rather than in the write job's payload, because the words
            // are asked for on a LATER pass than this one and nothing recomputes the schedule in
            // between: `ripen` re-offers whatever is still planned and knows nothing about bands.
            const segment = await this.segments.plan({ kind, label: labelFor(kind), ...(airsAt === undefined ? {} : { airsAt }) });
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
}

/**
 * Whether a segment is one of the station's own breaks, for the purposes of spacing.
 *
 * An ident and a talk break are one rule rather than two: they alternate, they do the same job —
 * telling a listener what they are listening to — and a station that counted them separately would
 * say its own name twice as often as asked. Everything else is somebody else's rule.
 *
 * **A segment with no kind counts here**, because an order written before the running order carried
 * one holds nothing but the station's own breaks. Guessing the other way would have the station
 * talk over the top of breaks it had already planted, once, on the first pass after an upgrade.
 */
const isStationKind = (kind: string): boolean => kind === IDENT_KIND || kind === TALK_BREAK_KIND;

const isStationBreak = (item: StationLineupSegmentItem): boolean => item.segmentKind === undefined || isStationKind(item.segmentKind);

/** The slots this pass claimed for a kind, so a later rule for the same kind can see them. */
const sameKind = (slots: readonly Slot[], kind: string): Set<number> =>
    new Set(slots.filter(slot => slot.band === kind).map(slot => slot.atIndex));

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
function elapsedSinceLastOfKind(
    items: readonly StationLineupItem[],
    cursor: number,
    counts: (item: StationLineupSegmentItem) => boolean,
): number {
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
