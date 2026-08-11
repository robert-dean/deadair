import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { BreakWriteRequest, BreakWriter, WriteDetail, WrittenBreak } from './break.writer.js';

/**
 * Which writers write which kind of break, in the order they are asked.
 *
 * An explicit list handed in at registration, following {@link ToolRegistry}: what the station can
 * say is one readable line in `director.module.ts` rather than the sum of whatever registered
 * itself. Several writers may claim one kind, and **registration order IS preference order** — a
 * model binding goes at the front and the station's own words stay at the back, so ranking them is
 * one line of a module rather than a search.
 *
 * ## Nothing here throws, and the last writer is the floor
 *
 * A writer that answered with nothing, one that answered with whitespace, and one that threw are all
 * the same outcome to this class: that writer had nothing usable, ask the next. Only when every
 * writer for a kind has been asked is there no break, and that is still not an exception — a segment
 * that is not `ready` is skipped rather than waited for, so absorbing all of it costs the station a
 * break and never silence. Turning any of it into a throw would put the rotation clock at the mercy
 * of the least reliable writer installed.
 *
 * Falling through lives HERE rather than inside a model writer, so a fifth kind of break gets it
 * without reimplementing it, and so does a writer with no model in it at all.
 *
 * ## It answers with everything it tried
 *
 * Not only the winner. A model that declined and a floor that covered for it are two facts, and the
 * second on its own reads as a station that never had a model configured. Both reach the reason on
 * the row, and — once there is somewhere to keep them — the record of what the station wrote.
 */

/**
 * How one writer's turn ended.
 *
 * `declined` and `failed` are told apart deliberately, even though they are the same silence to a
 * listener and the same fall-through to this class. "The model had nothing to say about these two
 * records" is the station working; "the model threw" is something to go and fix, and a single
 * outcome covering both would make the second invisible in the record.
 */
export type WriteOutcome = 'written' | 'declined' | 'failed';

/** One writer's turn: what it produced, or why it produced nothing, and what that cost. */
export interface WriteAttempt {
    /** The binding that was asked. {@link BreakWriter.name}. */
    writer: string;
    outcome: WriteOutcome;
    /** What it produced, when it produced anything usable. */
    written?: WrittenBreak;
    /** Why it did not, when it did not. A sentence, because its destination is a person. */
    reason?: string;
    /**
     * How long it took.
     *
     * Kept for every writer rather than only a slow one: "the model got slower" is a question that
     * can only be asked of numbers gathered before anybody suspected it.
     */
    durationMs: number;
    /** Whatever the writer wanted kept about how it got here. Absent for most writers. */
    detail?: WriteDetail;
}

/** What the registry answers: the words if there are any, and everything it tried either way. */
export interface BreakWriteResult {
    /** The words, when one of the writers had some. */
    written?: WrittenBreak;
    /** Which writer produced them. Present exactly when {@link written} is. */
    writer?: string;
    /** Every writer asked, in the order they were asked. Empty when nothing writes the kind at all. */
    attempts: WriteAttempt[];
    /** Why there are no words, when there are none. Covers every attempt, because each may differ. */
    reason?: string;
}

@Injectable()
export class BreakWriterRegistry {
    private readonly byKind: Map<string, BreakWriter[]>;

    constructor(
        writers: readonly BreakWriter[],
        private readonly logger: Logger,
    ) {
        this.byKind = new Map();
        for (const writer of writers) {
            const existing = this.byKind.get(writer.kind);
            if (existing === undefined) {
                this.byKind.set(writer.kind, [writer]);
                continue;
            }

            if (existing.some(other => other.name === writer.name)) {
                // Two writers for one kind is ordinary now. Two writers with the same NAME is still a
                // registration mistake, because `segments.writer` could no longer tell them apart and
                // an operator reading it would be told something untrue. The first one still writes,
                // exactly as the first tool source still runs.
                this.logger.warn(`director: two "${writer.name}" writers both claim "${writer.kind}"; keeping the first`);
                continue;
            }

            existing.push(writer);
        }
    }

    /** Whether anything can write this kind of break. What the planner asks before planting one. */
    canWrite(kind: string): boolean {
        return this.byKind.has(kind);
    }

    /** Every kind something can write. */
    kinds(): string[] {
        return [...this.byKind.keys()];
    }

    /** Which bindings write a kind, in the order they will be asked. */
    writersFor(kind: string): string[] {
        return (this.byKind.get(kind) ?? []).map(writer => writer.name);
    }

    /**
     * Write a break, asking each writer for the kind until one has something to say.
     *
     * The reason on a total failure is a sentence rather than a code because its destination is
     * `segment_events.reason` and a console, which is to say a person wondering why the station went
     * quiet for a break.
     */
    async write(request: BreakWriteRequest): Promise<BreakWriteResult> {
        const writers = this.byKind.get(request.kind) ?? [];
        if (writers.length === 0) return { attempts: [], reason: `nothing knows how to write a "${request.kind}"` };

        const attempts: WriteAttempt[] = [];
        for (const writer of writers) {
            const attempt = await this.attempt(writer, request);
            attempts.push(attempt);
            if (attempt.written !== undefined) return { written: attempt.written, writer: attempt.writer, attempts };
        }

        return { attempts, reason: summarise(request.kind, attempts) };
    }

    /** One writer's turn, with every way of failing flattened into a reason. */
    private async attempt(writer: BreakWriter, request: BreakWriteRequest): Promise<WriteAttempt> {
        const started = Date.now();
        const took = (): number => Date.now() - started;

        let written: WrittenBreak | undefined;
        let failure: string | undefined;
        try {
            written = await writer.write(request);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // Warned rather than noted quietly, because a writer THROWING is a bug in that writer
            // even though the station absorbs it. A writer declining is not.
            this.logger.warn(`director: a break writer failed (${request.kind}/${writer.name}: ${message})`);
            failure = `the ${writer.name} writer failed: ${message}`;
        }

        // Asked on every branch, because a model that produced a script and a model that spent forty
        // seconds producing nothing are equally worth the token count and the prompt. Guarded,
        // because a writer whose own bookkeeping throws must not turn a written break into a lost
        // one — this is the record, and the record is never worth the broadcast.
        let detail: WriteDetail | undefined;
        try {
            detail = writer.detailOfLastWrite?.();
        } catch {
            detail = undefined;
        }
        const kept = detail === undefined ? {} : { detail };

        if (failure !== undefined) return { writer: writer.name, outcome: 'failed', reason: failure, durationMs: took(), ...kept };

        if (written === undefined) {
            return {
                writer: writer.name,
                outcome: 'declined',
                reason: `the ${writer.name} writer had nothing to say here`,
                durationMs: took(),
                ...kept,
            };
        }

        if (written.script.trim().length === 0) {
            // Whitespace is the one failure the render job cannot use: it reaches the engine as a
            // request to speak nothing and comes back as audio nobody can hear. A fault in that
            // writer rather than a decision it made, so it counts as `failed`.
            return {
                writer: writer.name,
                outcome: 'failed',
                reason: `the ${writer.name} writer produced an empty script`,
                durationMs: took(),
                ...kept,
            };
        }

        return { writer: writer.name, outcome: 'written', written, durationMs: took(), ...kept };
    }
}

/** Whether a {@link BreakWriterRegistry.write} answer is words rather than a reason there are none. */
export const isWritten = (result: BreakWriteResult): result is BreakWriteResult & { written: WrittenBreak; writer: string } =>
    result.written !== undefined;

/**
 * Why nobody wrote it, naming each writer that was asked.
 *
 * One sentence covering all of them rather than the last one's, because the last one is usually the
 * floor saying something unremarkable ("nothing true to say here") while the interesting failure is
 * a writer or two above it.
 */
function summarise(kind: string, attempts: readonly WriteAttempt[]): string {
    const reasons = attempts.map(attempt => attempt.reason ?? `the ${attempt.writer} writer said nothing`);
    return reasons.length === 1 ? reasons[0]! : `nothing could write this ${kind}: ${reasons.join('; ')}`;
}
