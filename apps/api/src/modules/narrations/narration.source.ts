import { Injectable } from 'injectkit';
import type { ClockBandSubject } from '#modules/director/clock.bands.js';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { TopicRepository } from '#modules/topics/topic.repository.js';
import type { NarrationPieceRecord } from './narration.piece.js';
import { NarrationPieceRepository } from './narration.piece.repository.js';
import { NARRATION_KIND } from './narration.kind.js';

/** What a `narration` band is filled with: a segment the station holds, and how long it runs. */
export type NarrationAnswer = { segmentId: string; durationMs?: number } | { declined: string };

/**
 * How many words a minute the station reads at, for projecting a piece it has not spoken yet.
 *
 * An observation rather than a specification: measured off Kokoro reading a long piece, ~181 wpm on a
 * pilot chapter and ~183 across a whole book. It is only ever a fallback, since once the mixer has
 * joined the takes the station has the real length, and it exists because planting a chapter with no
 * length at all projects it as zero airtime and lands every band behind it on top of it.
 */
export const WORDS_PER_MINUTE = 180;

/**
 * What a `narration` band on the format clock reads, decided in one place.
 *
 * `SyndicatedSource`'s shape and its rules: the band names a subject (here, a series), the subject is
 * resolved against the operator's own topics per call so an edit applies at the next boundary, and
 * the planner that fills the band and the scheduler that renders ahead of it ask the SAME question
 * through {@link pieceFor}, so the chapter spoken for ten o'clock is the chapter aired at ten.
 *
 * ## It declines rather than guessing
 *
 * A band whose topic names no series, a series with nothing left to read, a piece not spoken yet,
 * and a station with no mixer to join the takes: every one of them DECLINES the slot, and the
 * station goes on with ordinary programming. Reading a different book under a slot the operator gave
 * to this one is `BulletinSource`'s refusal exactly.
 *
 * ## A missing series is not every series
 *
 * Unlike a `syndicated` band, a subject is REQUIRED. "The next piece of any series" would read
 * chapter four of one book and then chapter one of another, which is not a thing anybody wants; the
 * topic kind makes the field required and this declines when it is somehow absent anyway.
 */
@Injectable()
export class NarrationSource {
    constructor(
        private readonly topics: TopicRepository,
        private readonly pieces: NarrationPieceRepository,
        private readonly segments: SegmentRepository,
    ) {}

    /**
     * The piece a band about this subject means, whether or not the station has spoken it yet.
     *
     * Which piece that is depends on how the series is carried, and the repository owns that: the
     * next unread chapter of a book, or the newest issue of a column.
     */
    async pieceFor(subject: ClockBandSubject | undefined): Promise<{ piece: NarrationPieceRecord } | { declined: string }> {
        if (subject === undefined) return { declined: 'the band names no series to read from' };

        const topic = (await this.topics.list(NARRATION_KIND)).find(candidate => candidate.id === subject.id);
        const named = typeof topic?.config.series === 'string' ? topic.config.series.trim() : '';
        if (named.length === 0) return { declined: `"${subject.label}" names no series` };

        const piece = await this.pieces.nextFor(named);
        if (piece === undefined) return { declined: `"${subject.label}" has nothing left to read` };

        return { piece };
    }

    /**
     * What to put in a `narration` band's slot now: the piece this subject means, if the station has
     * spoken it and has not already put it in the order.
     *
     * The length is the joined audio's OWN, measured by the mixer that made it, and an estimate from
     * the word count only when there is none. Never nothing, which is the whole of what `durationMs`
     * is for here: a twenty-minute chapter that projects as zero puts the news at the top of the hour
     * twenty minutes into the reading. One extra read per fill, which is worth it against a claim:
     * this is the one carried programme whose length the station measured itself.
     *
     * `onOrder` is every segment the running order already names, so a band that comes round again
     * before the last occurrence's piece has aired does not plant the same reading twice.
     */
    async segmentFor(subject: ClockBandSubject | undefined, onOrder: ReadonlySet<string>): Promise<NarrationAnswer> {
        const found = await this.pieceFor(subject);
        if ('declined' in found) return found;

        const { piece } = found;
        if (piece.segmentId === undefined) {
            return {
                declined:
                    piece.renderError === undefined
                        ? `"${piece.title}" has not been spoken yet`
                        : `"${piece.title}" could not be spoken (${piece.renderError})`,
            };
        }
        if (onOrder.has(piece.segmentId)) return { declined: `"${piece.title}" is already in the running order` };

        const measured = (await this.segments.findById(piece.segmentId))?.durationMs;
        const durationMs = measured ?? estimatedMs(piece);
        return { segmentId: piece.segmentId, ...(durationMs === undefined ? {} : { durationMs }) };
    }
}

/**
 * How long this piece runs, from its word count, for a row whose audio reports no duration of its own.
 *
 * A station whose mixer answered without one, which is the only way to get here. An estimate is
 * roughly right and nothing at all is exactly wrong, so the arithmetic is worth having.
 */
function estimatedMs(piece: NarrationPieceRecord): number | undefined {
    if (piece.wordCount === undefined || piece.wordCount <= 0) return undefined;
    return Math.max(1_000, Math.round((piece.wordCount / WORDS_PER_MINUTE) * 60_000));
}
