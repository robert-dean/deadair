import { appendFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { currentTrace } from './trace.context.js';

/**
 * What one call inside a decision cost, appended to a file nobody reads to decide anything.
 *
 * ## Why the log line is not enough
 *
 * `trace.context.ts` put the decision's id on every log line, which makes one decision greppable.
 * What it cannot answer is what the decision SPENT, because a line is written when somebody thought
 * to write one and the expensive calls are exactly the ones that end without saying anything: a
 * plugin disposed with its response body still open logs nothing, and a model that waited out its
 * budget and gave up logs a failure with no cost on it.
 *
 * That is not a hypothetical. `station-intelligence.md` §2 measured 13 of 176 model attempts that
 * provably occupied the model and recorded no usage at all, and named the two shapes: a timeout and
 * a mid-flight disposal. **They are unrecorded precisely because the record was taken from the
 * answer, and neither of them has one.** So a span is opened around the call and closed in a
 * `finally`, which is the only arrangement where the cost of a call that produced nothing is still
 * a number.
 *
 * ## Why a file and not a table
 *
 * `llm.capture.ts` argues this and the argument carries: a break is a row because a break IS a row,
 * with a segment and a writer and a lifetime. A span is a description of work already done, kept
 * only until somebody has looked. A table for it would be a schema carrying a debugging session,
 * plus a migration, plus a write on the runtime pool inside every call this is supposed to be
 * cheaper than.
 *
 * JSONL rather than the app log's own format for the same reason it is a file: these are meant to
 * be counted, and `RotatingLogStore` truncates a value at 512 characters and a line at 8k, which is
 * right for prose and wrong for something a script sums.
 *
 * ## Nothing here may cost the caller its work
 *
 * The rule `ActivityRecorder` already holds, and it matters more here because this sits inside every
 * plugin call the station makes. Every failure is swallowed in silence — not even a log line, which
 * would be one line per call on a broken disk and would bury the log this exists to supplement.
 * Nothing awaits a span either: {@link recordSpan} returns void and the write settles on its own.
 *
 * ## Always on
 *
 * Deliberately not behind a setting. `llm.captureWrites` is off by default because a capture is tens
 * of kilobytes; a span is a couple of hundred bytes, and the failure this exists to explain is one
 * nobody predicted, which is the exact case an opt-in diagnostic is never on for. That is not
 * theoretical either: the same §2 measurement lost eight of its ten cases because the evidence had
 * already rotated away. Bounded by {@link MAX_TRACE_FILES} instead.
 */

/** One day of spans per file, and this many days kept. Small: they are for diagnosing this week. */
export const MAX_TRACE_FILES = 7;

/** Where they go, under the same root the logs use. Sibling of `captures/`. */
const TRACES_DIR = 'traces';

/** How much of a failure is worth keeping. A shape, not a stack. */
const ERROR_CHARS = 200;

/** One call, as the file records it. `trace`, `kind` and `at` are stamped by {@link recordSpan}. */
export interface TraceSpan {
    /** What was called, dotted and stable: `plugin.invoke`, `llm.generate`. */
    op: string;

    /**
     * Which one. A plugin id, a model name, a capability method — whatever makes two spans of the
     * same `op` worth telling apart.
     */
    target?: string;

    /** How long the call held, measured around it rather than reported by it. */
    ms: number;

    /**
     * Whether it produced what it was asked for.
     *
     * Two values on purpose. A span is for counting, and every finer distinction a reader wants —
     * timed out, was preempted, came back empty — is a fact the caller knows and this one does not,
     * so it belongs in {@link detail} where it can be named rather than in an enum this file would
     * have to keep up with.
     */
    outcome: 'ok' | 'failed';

    /** The failure, summarized to a shape. */
    error?: string;

    /** Whatever this `op` is worth reading back: tokens, a finish reason, a byte count. */
    detail?: Record<string, unknown>;
}

let root: string | undefined;

/**
 * Point the recorder at the logs root, once, at boot.
 *
 * Module state on the same argument as `log.store.ts`: this is reached from `PluginInvoker`, which
 * is a singleton with no config and no scope, and from plugin code below it. `undefined` puts it
 * back to never-having-been-set, which is for tests.
 */
export function setTraceRoot(next: string | undefined): void {
    root = next;
}

/**
 * Writes settle in order rather than racing each other onto the same file.
 *
 * `appendFile` opens with `O_APPEND`, so two concurrent writes cannot lose each other's bytes, but
 * nothing promises they cannot interleave — and a half-line is worse than a missing one because a
 * reader parsing JSONL stops at it. Chaining costs a promise per span and makes the file always
 * parseable.
 */
let queue: Promise<void> = Promise.resolve();

/**
 * File one span against the decision currently running.
 *
 * Returns void rather than a promise: no caller may await this, because a caller that awaited it
 * would be holding a plugin's slot open for a disk write.
 *
 * Outside a trace nothing is written at all. A span with no decision to belong to answers no
 * question this file exists for, and startup and timer work would otherwise be most of the volume.
 */
export function recordSpan(span: TraceSpan): void {
    const trace = currentTrace();
    if (trace === undefined || root === undefined) return;

    const line = JSON.stringify({ at: new Date().toISOString(), trace: trace.id, kind: trace.kind, ...span });
    const dir = join(root, TRACES_DIR);

    queue = queue
        .then(async () => {
            await mkdir(dir, { recursive: true });
            // Day-stamped, so the name sorts the way time does and the prune below can order by it.
            await appendFile(join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`), `${line}\n`, 'utf8');
            await prune(dir);
        })
        .catch(() => undefined);
}

/** Everything a caller needs to describe a failure the same way twice. */
export function spanError(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    return text.slice(0, ERROR_CHARS);
}

/** Drop all but the newest {@link MAX_TRACE_FILES} days. Failures are the queue's to swallow. */
async function prune(dir: string): Promise<void> {
    const files = (await readdir(dir)).filter(name => name.endsWith('.jsonl')).sort();
    if (files.length <= MAX_TRACE_FILES) return;

    for (const name of files.slice(0, files.length - MAX_TRACE_FILES)) {
        await rm(join(dir, name), { force: true });
    }
}

/** Settle every queued write. For tests and for shutdown; nothing on the hot path waits. */
export async function flushSpans(): Promise<void> {
    await queue;
}
