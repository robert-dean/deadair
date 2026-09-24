import { Injectable } from 'injectkit';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak } from './break.writer.js';
import { spoken } from './talk.break.writer.js';

/**
 * The words in front of a record a listener asked for and dedicated: who it is from, who it is for.
 *
 * The floor under the dedication, with `ModelDedicationWriter` in front of it. What makes this kind
 * different from every other is where its substance comes from: a LISTENER, through the requests
 * module, as the planted segment's context. Everything in that context is untrusted.
 *
 * **The floor never reads the message.** Only the two names, which are the point of a dedication and
 * are said as the listener gave them (the requests module has already stripped control characters and
 * held them to a length). The message is the model writer's to paraphrase, with an instruction to drop
 * anything unfit to broadcast; a template has no way to make that judgement, so it does not try.
 *
 * It names the record that follows, and says so (`claimsNext`), because the requests module plants it
 * directly in front of that record and the claim is what drops it if anything comes between them.
 */

/** The kind of segment this writes. The same string as `segments.kind`. */
export const DEDICATION_KIND = 'dedication';

/** The label a dedication's segment is planted with. */
export const DEDICATION_LABEL = 'Dedication';

/** What `segments.writer` records for anything written here. */
export const DEDICATION_WRITER = 'deterministic';

/** The keys of a dedication segment's context, as the requests module writes them. */
export const DEDICATION_CONTEXT = {
    from: 'dedicatedBy',
    to: 'dedicateTo',
    message: 'message',
} as const;

/** A dedication as a writer reads it off the request. Every part is the listener's. */
export interface DedicationParts {
    from: string;
    to?: string;
    message?: string;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/** The dedication a write request carries, or nothing when it carries none. */
export function dedicationOf(request: BreakWriteRequest): DedicationParts | undefined {
    const context = request.context;
    if (context === undefined) return undefined;
    const from = text(context[DEDICATION_CONTEXT.from]);
    if (from === undefined) return undefined;
    const to = text(context[DEDICATION_CONTEXT.to]);
    const message = text(context[DEDICATION_CONTEXT.message]);
    return { from, ...(to === undefined ? {} : { to }), ...(message === undefined ? {} : { message }) };
}

/** A sentence's first letter upper-cased, for "a listener asked for this one". */
const opening = (sentence: string): string => sentence.charAt(0).toUpperCase() + sentence.slice(1);

/** Every way the floor can say it, for a dedication with and without a record to name. Exported for the tests. */
export function dedicationLines(parts: DedicationParts, next: { title: string; artist: string } | undefined): string[] {
    const record = next === undefined ? undefined : { title: spoken(next.title), artist: next.artist };
    const { from, to } = parts;

    if (to !== undefined) {
        return record === undefined
            ? [`This next one goes out to ${to}, from ${from}.`, `${opening(from)} asked for this next one, for ${to}.`]
            : [
                  `This one goes out to ${to}, from ${from}. Here's ${record.artist} with ${record.title}.`,
                  `${opening(from)} asked for this one, for ${to}. It's ${record.title}, by ${record.artist}.`,
              ];
    }
    return record === undefined
        ? [`${opening(from)} asked for this next one.`, `Here's one ${from} asked for.`]
        : [
              `${opening(from)} asked for this one. Here's ${record.artist} with ${record.title}.`,
              `Here's one ${from} asked for: ${record.title}, by ${record.artist}.`,
          ];
}

@Injectable()
export class DedicationWriter extends BreakWriter {
    readonly kind = DEDICATION_KIND;
    readonly name = DEDICATION_WRITER;

    detailOfLastWrite(): WriteDetail | undefined {
        return undefined;
    }

    async write(request: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        const parts = dedicationOf(request);
        if (parts === undefined) return undefined;

        const lines = dedicationLines(parts, request.next);
        // The first that was not said lately, since a busy night can carry several: judged on the
        // opening words, which is the part a listener hears repeating.
        const recent = (request.recent ?? []).map(script => script.slice(0, 24));
        const script = lines.find(line => !recent.includes(line.slice(0, 24))) ?? lines[0]!;

        return {
            script,
            label: DEDICATION_LABEL,
            // Never a name the listener typed: this reaches the stream's metadata and a phone's lock
            // screen, which is showing it rather than saying it once.
            listenerLabel: DEDICATION_LABEL,
            claimsNext: request.next !== undefined,
        };
    }
}
