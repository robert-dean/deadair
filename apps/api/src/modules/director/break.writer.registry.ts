import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { BreakWriteRequest, BreakWriter, WrittenBreak } from './break.writer.js';

/**
 * Which writer writes which kind of break.
 *
 * An explicit list handed in at registration, following {@link ToolRegistry}: what the station can
 * say is one readable line in `director.module.ts` rather than the sum of whatever registered
 * itself. A model binding arrives as a second entry for a kind that already has one, and the choice
 * between them is a setting rather than a search.
 *
 * ## Nothing here throws
 *
 * A kind nothing writes, a writer that answered with nothing, a writer that threw: all three are the
 * same outcome to the caller, which is a break that will not be said. That is a state the station is
 * built to absorb, because a segment that is not `ready` is skipped rather than waited for. Turning
 * any of them into an exception would put the rotation clock at the mercy of the least reliable
 * writer installed.
 */
@Injectable()
export class BreakWriterRegistry {
    private readonly byKind: Map<string, BreakWriter>;

    constructor(
        writers: readonly BreakWriter[],
        private readonly logger: Logger,
    ) {
        this.byKind = new Map();
        for (const writer of writers) {
            if (this.byKind.has(writer.kind)) {
                // Two writers for one kind is a registration mistake rather than a station fault,
                // and it should be fixed. Not by taking the station's ability to talk with it: the
                // first one still writes, exactly as the first tool source still runs.
                this.logger.warn(`director: two break writers both claim "${writer.kind}"; keeping the first`);
                continue;
            }
            this.byKind.set(writer.kind, writer);
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

    /**
     * Write a break, or answer why there is nothing to say.
     *
     * The reason is a sentence rather than a code because its destination is `segment_events.reason`
     * and a console, which is to say a person wondering why the station went quiet for a break.
     */
    async write(request: BreakWriteRequest): Promise<WrittenBreak | { reason: string }> {
        const writer = this.byKind.get(request.kind);
        if (writer === undefined) return { reason: `nothing knows how to write a "${request.kind}"` };

        let written: WrittenBreak | undefined;
        try {
            written = await writer.write(request);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`director: a break writer failed (${request.kind}: ${message})`);
            return { reason: `the ${request.kind} writer failed: ${message}` };
        }

        if (written === undefined) return { reason: `the ${request.kind} writer had nothing to say here` };
        if (written.script.trim().length === 0) return { reason: `the ${request.kind} writer produced an empty script` };

        return written;
    }
}

/** Whether a {@link BreakWriterRegistry.write} answer is words rather than a reason there are none. */
export const isWritten = (result: WrittenBreak | { reason: string }): result is WrittenBreak => 'script' in result;
