import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { httpError } from '@maroonedsoftware/errors';
import { errorText } from '#modules/shared/error.text.js';
import { TRACES_DIR } from '#modules/shared/trace.spans.js';
import type { TraceDecision, TraceDetail, TraceSpan, TracesPage, TracesQuery } from './types/traces.types.js';

/** How many decisions a page answers with when the caller does not say. */
const DEFAULT_LIMIT = 50;

/** The span a job base records around its own body, which is the decision rather than a call in it. */
const JOB_SPAN = 'job.run';

/** A span as the file holds it: every field is JSON, and `at` is the ISO string it was written as. */
interface StoredSpan {
    at: string;
    trace: string;
    kind: string;
    parent?: string;
    op: string;
    target?: string;
    ms: number;
    outcome: 'ok' | 'failed';
    error?: string;
    detail?: Record<string, unknown>;
}

/** A decision mid-fold, with `at` still the string the file holds so it can be compared cheaply. */
interface Folded {
    id: string;
    kind: string;
    parent?: string;
    at: string;
    ms: number;
    calls: number;
    failed: number;
}

/**
 * The console's reader over the span files.
 *
 * ## Why this reads a file rather than a table
 *
 * `trace.spans.ts` argues it and the argument carries here: a span is a description of work already
 * done, kept only until somebody has looked, and a table for it would be a schema carrying a
 * debugging session plus a write on the runtime pool inside every call it is supposed to be cheaper
 * than. What that costs is exactly this class — the read is a scan rather than a query — and a scan
 * over a bounded number of days is affordable in a way an unbounded one would not be.
 *
 * ## It is a diagnostic surface, not a feed
 *
 * `/activity` is polled and pages with a keyset, because rows arrive at its head continuously. This
 * is opened when somebody is looking into something, so it reads the window and slices it, and
 * reports how many spans that cost in `TracesPage.spans` rather than hiding it. If that number ever
 * becomes uncomfortable the answer is a shorter window, not a cursor over a file.
 *
 * ## Nothing here fails the page
 *
 * A missing directory is the ordinary state on a station that has not written a span yet, and an
 * unreadable file is a disk problem this cannot fix. Both answer with what could be read, on the
 * same rule the recorder follows from the other side: these rows decide nothing, so they must never
 * cost a reader the answer they were meant to supply.
 */
@Injectable()
export class TracesService {
    constructor(
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** Recent decisions, newest first, folded to one row each. */
    async readTraces(query: TracesQuery): Promise<TracesPage> {
        const spans = await this.load();
        const matching = [...fold(spans).values()]
            .filter(decision => query.kind === undefined || decision.kind === query.kind)
            .filter(decision => query.failedOnly !== true || decision.failed > 0)
            .sort((left, right) => right.at.localeCompare(left.at));

        return {
            decisions: matching.slice(0, query.limit ?? DEFAULT_LIMIT).map(asDecision),
            total: matching.length,
            spans: spans.length,
        };
    }

    /**
     * One decision, its calls in order, and the decisions on either side of it.
     *
     * A PREFIX matches, which is the whole reason an operator can copy the first eight characters of
     * an id out of a log line and paste them in. Ambiguity resolves to the first match rather than to
     * an error, because somebody who pasted a short prefix wants to be shown something.
     */
    async readTrace(id: string): Promise<TraceDetail> {
        const spans = await this.load();
        const decisions = fold(spans);

        const found = [...decisions.values()].find(decision => decision.id === id || decision.id.startsWith(id));
        if (found === undefined) throw httpError(404).withDetails({ message: `no decision "${id}" is still within the kept window` });

        // A parent that has rotated away is a real state and not an error: the edge was recorded and
        // the other end is gone. Answering nothing is how the console draws "caused by something no
        // longer kept" rather than inventing a row with an id and no cost.
        const parent = found.parent === undefined ? undefined : decisions.get(found.parent);

        return {
            decision: asDecision(found),
            spans: spans.filter(span => span.trace === found.id).map(asSpan),
            ...(parent === undefined ? {} : { parent: asDecision(parent) }),
            caused: [...decisions.values()]
                .filter(decision => decision.parent === found.id)
                .sort((left, right) => left.at.localeCompare(right.at))
                .map(asDecision),
        };
    }

    /** Every span currently kept, oldest first, and whatever could not be read is simply not here. */
    private async load(): Promise<StoredSpan[]> {
        const dir = join(String(this.config.get('LOGS_DIR', './logs')), TRACES_DIR);

        let files: string[];
        try {
            files = (await readdir(dir)).filter(name => name.endsWith('.jsonl')).sort();
        } catch {
            // No directory yet, which is every station that has not run a job since this shipped.
            return [];
        }

        const spans: StoredSpan[] = [];
        for (const name of files) {
            try {
                for (const line of (await readFile(join(dir, name), 'utf8')).split('\n')) {
                    // A partial last line is possible on a file being appended to as this reads, and
                    // one unparseable line must not cost the reader the rest of the day.
                    if (line.length === 0) continue;
                    try {
                        spans.push(JSON.parse(line) as StoredSpan);
                    } catch {
                        continue;
                    }
                }
            } catch (error) {
                this.logger.warn(`station: could not read a span file (${errorText(error)})`, { file: name });
            }
        }

        return spans;
    }
}

/**
 * Spans to decisions.
 *
 * `job.run` is the decision itself and every other span happened inside it, so counting both would
 * report a job's cost twice. It supplies the wall clock and the rest are the breakdown — which is
 * also why a decision recorded before that span existed reads `0ms` rather than a sum that would
 * look like a wall clock and not be one.
 */
function fold(spans: readonly StoredSpan[]): Map<string, Folded> {
    const by = new Map<string, Folded>();

    for (const span of spans) {
        const row = by.get(span.trace) ?? {
            id: span.trace,
            kind: span.kind,
            at: span.at,
            ms: 0,
            calls: 0,
            failed: 0,
            ...(span.parent === undefined ? {} : { parent: span.parent }),
        };

        if (span.op === JOB_SPAN) row.ms = Math.max(row.ms, span.ms);
        else row.calls += 1;
        if (span.outcome === 'failed') row.failed += 1;
        // The NEWEST span wins, so a decision sorts by when it last did something rather than by
        // when it started. That is what keeps a long-running job at the top of the list while it is
        // still going, which is where somebody looking into it wants to find it.
        if (span.at > row.at) row.at = span.at;

        by.set(span.trace, row);
    }

    return by;
}

const asDecision = (folded: Folded): TraceDecision => ({
    id: folded.id,
    kind: folded.kind,
    ...(folded.parent === undefined ? {} : { parent: folded.parent }),
    at: DateTime.fromISO(folded.at),
    ms: folded.ms,
    calls: folded.calls,
    failed: folded.failed,
});

const asSpan = (span: StoredSpan): TraceSpan => ({
    at: DateTime.fromISO(span.at),
    op: span.op,
    ...(span.target === undefined ? {} : { target: span.target }),
    ms: span.ms,
    outcome: span.outcome,
    ...(span.error === undefined ? {} : { error: span.error }),
    ...(span.detail === undefined ? {} : { detail: span.detail }),
});
