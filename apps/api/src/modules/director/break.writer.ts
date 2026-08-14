/**
 * Deciding what the station SAYS, as one DI seam.
 *
 * The sibling of {@link SetGenerator}, which decides what the station plays, and shaped on the same
 * principle: a writer answers with plain words, so a language model becomes a second binding rather
 * than a reshape of everything downstream. What comes back here is a script and a label, both
 * strings, and nothing in the render path can tell which writer produced them.
 *
 * ## Keyed by KIND, not one writer
 *
 * There is no single `BreakWriter` token, and that is deliberate. The previous station did not have
 * one generator, it had five: a talk break, a sign-on, a news bulletin, a DJ set and a two-voice
 * dialogue. Every one of them read the same substrate and produced a script, and a seam shaped as
 * "the previous track and the next track" fits exactly the first of them. So the seam is a registry
 * over `segments.kind`, and a fifth kind is a fifth writer rather than a fourth parameter. See
 * `docs/todo/dj-voice.md`.
 *
 * ## Answering with nothing is an answer
 *
 * `write` may return `undefined`, and it is an ordinary outcome: a back-announce with no record
 * behind it and no record in front of it has nothing true to say, and saying something anyway is how
 * a station ends up announcing a song it did not play. The caller records that as a segment nobody
 * will hear rather than as a fault, and the director skips it like any other segment that is not
 * ready.
 *
 * Declared as an abstract class so injectkit can use it as a token, and kept free of any
 * implementation's imports, exactly like {@link SetGenerator}.
 */

import type { Persona } from '#modules/personas/persona.js';
import type { RoughTime } from './clock.words.js';

/** A record, as a writer sees one. */
export interface BreakTrack {
    title: string;
    /** The credit as it should be READ, which is why it is one string and not the artists array. */
    artist: string;
    /**
     * The catalog track this is, when the catalog holds it.
     *
     * Everything a writer might want to be interesting ABOUT — the enrichment tables, the album,
     * the artist, what the analyzer measured — hangs off this one id. {@link facts} is the first
     * of that to arrive; the rest still has somewhere to arrive at. Absent for a record the catalog
     * does not hold.
     */
    trackId?: string;
    /**
     * Short true things about this record, already chosen for this break.
     *
     * Fetched by the CALLER and never by a writer reaching into a repository, which is what keeps a
     * writer a pure function of what it was told: that is what makes it testable, and what lets
     * every binding see the same substrate rather than each one deciding for itself what it is
     * allowed to know.
     *
     * Already whole sentences, already capped in number and length, already rotated so a record
     * played twice in an evening does not produce the same line — all of that is
     * `EnrichmentReadService.factsForTracks`, because it is one decision and no writer should be
     * making it again. Absent, or empty, is the ordinary case: on a station that has enriched
     * nothing, every break is this.
     */
    facts?: readonly string[];
}

/** What a writer is told before it writes. */
export interface BreakWriteRequest {
    /** Which sort of break this is. The same string as `segments.kind`. */
    kind: string;
    /**
     * The record this break follows, when it follows one.
     *
     * Absent at the top of a running order, which is the sign-on case rather than a missing value.
     */
    previous?: BreakTrack;
    /** The record this break leads into, when it leads into one. Absent at the end of an order. */
    next?: BreakTrack;
    /** What the station calls itself, from `stream.title`. Absent when the operator has not said. */
    station?: string;
    /**
     * Who the station is right now.
     *
     * Read by the caller and handed over whole, like {@link BreakTrack.facts} and for the same
     * reason: a writer stays a pure function of what it was told, and every binding sees the same
     * character rather than each deciding for itself what it may know. Absent for a station that has
     * chosen no persona, which is an ordinary state and not a fault.
     *
     * Every binding uses a different half of it — a model reads the sheet, the templates reader
     * reads its phrasings and its on-air name — which is why the whole record travels rather than a
     * per-writer projection of it.
     */
    persona?: Persona;
    /**
     * The last few things the station said, newest first.
     *
     * Not history for its own sake: a writer with a pool of phrasings needs to know which ones are
     * still ringing in a listener's ears, and a station that says the same sentence every fourth
     * record stops sounding like a person within an hour. A model binding later reads the same field
     * to avoid repeating a signature line, which is why it is scripts and not template names.
     */
    recent?: readonly string[];
    /**
     * What time this break was placed for, as words and as the window they stay true in.
     *
     * Present only for a break a rule on the station clock put down. A writer is free to ignore it
     * — most breaks have nothing to do with the hour — but one that USES it must say so through
     * {@link WrittenBreak.claimsTime}, or the words will outlive their own truth.
     */
    clock?: RoughTime;
}

/** What a writer produces. */
export interface WrittenBreak {
    /** The words to say. */
    script: string;
    /** What the console and the mount call it. Never the script: a listener's player wants a name. */
    label: string;
    /**
     * Whether these words NAME the record coming up.
     *
     * A statement about the future, made minutes before it is spoken, out of audio rendered in
     * between. The caller stamps the line it named onto the row so the director can check at
     * hand-over that the order has not moved under it; see `segments.claims_item_id`.
     *
     * Answered by the writer because only the writer knows what it actually said: a template with
     * an optional intro that got dropped promised nothing, and a break that promised nothing must
     * not be thrown away later for a promise it never made.
     */
    claimsNext?: boolean;
    /**
     * The window these words stay true in, for a writer that said what time it was.
     *
     * The sibling of {@link claimsNext} and answered for the same reason: only the writer knows
     * what it actually said. A phrasing that mentioned no time makes no claim about when it airs,
     * and stamping one anyway would have the director drop a break for a promise it never made.
     *
     * Taken straight from {@link BreakWriteRequest.clock} rather than recomputed, so the words and
     * their expiry cannot drift apart. The director checks it at hand-over; see
     * `segments.claims_time_from`.
     */
    claimsTime?: { from: number; until: number };
}

/**
 * What a writer wants kept about HOW it produced (or failed to produce) some words.
 *
 * For the record only. Nothing here reaches the listener, nothing downstream branches on it, and a
 * writer that has none of it is the ordinary case — the station's own phrasings cost nothing and
 * are their own explanation.
 */
export interface WriteDetail {
    /** Which model said it, for a writer that used one. */
    model?: string;
    /** What the line was rendered FROM, for a writer working from something an operator can edit. */
    source?: string;
    /** The provider's own token counts, when it reported any. */
    usage?: Record<string, number>;
    /** The messages as sent. Only when the operator asked for them to be kept. */
    prompt?: unknown;
    /** The answer before the station tidied it. Only when the operator asked for it to be kept. */
    raw?: string;
}

export abstract class BreakWriter {
    /** Which `segments.kind` this writes. Several writers may claim one kind; see the registry. */
    abstract readonly kind: string;

    /**
     * Which binding this is, for `segments.writer` and for the record of what was tried.
     *
     * On the writer rather than on what it returns, because a writer that DECLINES has to be
     * nameable too: "the model was slow" and "there was nothing true to say" are the same silence
     * to a listener and completely different problems to an operator. It is also the reason the
     * caller does not name it — once a kind has more than one writer, a script arriving from the
     * registry has been through however many declined before it, and "whichever one the caller
     * assumed" is the answer that goes quietly wrong the day a model stops answering.
     */
    abstract readonly name: string;

    /**
     * Write one break, or answer `undefined` when there is nothing worth saying.
     *
     * Must not throw for an ordinary empty request. A writer that cannot work without a model is
     * free to fail, but the deterministic ones underneath it are the floor the station falls back
     * to, and a floor that throws is not one.
     */
    abstract write(request: BreakWriteRequest): Promise<WrittenBreak | undefined>;

    /**
     * Anything worth keeping about the write that just happened.
     *
     * Read by the registry immediately after {@link write}, and by nothing else ever. It exists
     * because the interesting detail is needed on BOTH branches — a model that produced a script and
     * a model that produced forty seconds of nothing are equally worth the token count and the
     * prompt — and `write` answering `undefined` has nowhere to put it.
     *
     * Optional, and most writers have none. A writer that implements it may assume it is called
     * once, immediately, on the same instance: writers are resolved per job, and the registry does
     * not interleave.
     */
    detailOfLastWrite?(): WriteDetail | undefined;
}
