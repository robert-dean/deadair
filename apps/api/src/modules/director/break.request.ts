/**
 * Asking the station to say something, as one shape.
 *
 * The station's own breaks need nothing like this. `BreakPlanner` walks the running order, finds a
 * gap the spacing rules want filled, and plants one — idempotent because the ORDER is the memory, so
 * two passes racing produce the same answer and a restart changes nothing.
 *
 * A requested break is the opposite kind of thing. It exists because something HAPPENED outside the
 * running order — a listener tuned in, a bulletin arrived, an operator pressed a button — and none of
 * that is derivable from the order, so no later pass can re-derive it. That is why a request is a
 * ROW (`deadair.break_requests`) rather than a call, and why everything about it is written down
 * before anything is attempted.
 *
 * ## The producer says what and how soon; the director says where
 *
 * Nothing here names a position, and nothing outside the director ever will:
 * `docs/decisions/on-air-ownership.md` is built on every writer posting a command and none of them
 * writing the running order itself. A producer knows that a listener arrived; only the director knows
 * what is committed, what is airing, and where a break can still legally go.
 */

/** What the writers for a kind are handed to write about. See {@link BreakRequest.context}. */
export type BreakContext = Record<string, string | number | boolean>;

/**
 * How soon a request wants to be heard.
 *
 * A scale rather than a set of flags, and the two halves of it behave differently on purpose:
 *
 * - `interrupt` and `next` are **rendered before they are injected**. Nothing goes into the running
 *   order until the audio exists, so the one thing that could lose them — arriving at a slot unready
 *   — cannot happen.
 * - `soon` and `whenever` are planted like an ordinary break and take the same chances. They have
 *   the time, and a routine break that gets skipped costs little.
 *
 * That asymmetry is the whole design. A planted break arriving unready is SKIPPED, which is right
 * for a talk break (another is coming, and silence is worse than a missed one) and exactly wrong for
 * a break that exists because something happened: the moment does not come round again.
 */
export type BreakUrgency = 'interrupt' | 'next' | 'soon' | 'whenever';

/** Somebody asking the station to say something. */
export interface BreakRequest {
    /** Which sort of break to write. The same string as `segments.kind`, and what picks the writers. */
    kind: string;
    urgency: BreakUrgency;
    /**
     * Who asked: `audience`, `operator`, later a plugin id.
     *
     * For the log and the activity feed, never for a decision. A request is judged on its kind and
     * its urgency, so a producer cannot buy priority by naming itself something important.
     */
    source: string;
    /**
     * Why, in the station's own words.
     *
     * It reaches `station_events.detail`, and `ActivityRecorder`'s rule is that everything there is
     * written by app code — so an upstream's body, a provider's message or a plugin's error must be
     * summarized here rather than quoted.
     */
    reason?: string;
    /**
     * What the break is ABOUT, handed to the writer for this kind.
     *
     * Absent is the ordinary case: a welcome needs nothing but the fact that it is a welcome. A news
     * bulletin is what this exists for.
     *
     * **Stored, so the JSON-safe rule covers it**: no `Date`, no class instances, no functions,
     * durations as integer milliseconds, dates as ISO-8601 strings. It is app-side rather than a
     * plugin boundary payload, so it is not in `boundary.json.safe.ts`'s registry, but the discipline
     * is the same one and for the same reason — this ends up in a `jsonb` column.
     *
     * Deliberately shapeless. A writer for a kind knows what its own kind's context looks like, reads
     * what it expects and ignores the rest; nothing generic ever reads it, so a shared schema would
     * be a shape nobody is in a position to define.
     */
    context?: BreakContext;
    /**
     * At most one accepted request under this key within {@link cooldownMs}.
     *
     * What stops a listener whose phone changed networks being greeted twice. Held in the table
     * rather than in memory, deliberately: a map would forget across exactly the restart that makes a
     * double-greeting most likely, since a restart is also when every listener looks like an arrival.
     *
     * Absent for a request that does not care, which may legitimately double up.
     */
    key?: string;
    /** How long {@link key} holds anything else off. Ignored without a key. */
    cooldownMs?: number;
}

/**
 * What the director answers a request with.
 *
 * A decline is an ordinary outcome rather than a failure — a cooldown, a station that is off air, an
 * order with no room, a kind nothing can write — so the reason is a sentence, because its destination
 * is a person reading a log or a console.
 */
export interface BreakRequestResult {
    accepted: boolean;
    /** The row, when one was written. Present whenever `accepted`. */
    requestId?: string;
    /** The break it became. Present whenever `accepted`. */
    segmentId?: string;
    /**
     * Where it went in the running order.
     *
     * Absent for an urgency that is rendered before it is injected, which has no position yet and
     * will not have one until its audio exists.
     */
    atIndex?: number;
    reason?: string;
}

/**
 * How far along a request is. Mirrors `break_requests.state`.
 *
 * `pending → ready → placed` for the two urgent ones, with `expired` and `failed` off the side. A
 * `soon` or `whenever` request is born `placed`, because it is planted at once.
 */
export type BreakRequestState = 'pending' | 'ready' | 'placed' | 'expired' | 'failed';

/** A request as it was written down. */
export interface StoredBreakRequest {
    id: string;
    kind: string;
    urgency: BreakUrgency;
    source: string;
    state: BreakRequestState;
    reason?: string;
    context?: BreakContext;
    key?: string;
    /** When it stops being worth airing, as epoch millis. Absent for one with no deadline. */
    expiresAt?: number;
    /** The break it became. Absent only in the instant between writing the row and planning it. */
    segmentId?: string;
}

/** Whether this urgency waits for its audio before it takes a slot. See {@link BreakUrgency}. */
export const isRenderedFirst = (urgency: BreakUrgency): boolean => urgency === 'interrupt' || urgency === 'next';
