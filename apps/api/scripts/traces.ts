/**
 * Read the station's traces back: what a decision did, and what it cost.
 *
 * The spans are JSONL on purpose and every question below is a `node`-shaped one rather than a
 * query, so this is a reader and not a service. It exists because a format nobody has a reader for
 * is a format nobody reads, and the whole argument for spans was that the last measurement of this
 * data lost eight of its ten cases for want of one.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/traces.ts             # the costliest decisions
 *   node --import @swc-node/register/esm-register ./scripts/traces.ts <trace-id>  # one decision, in order
 *   node --import @swc-node/register/esm-register ./scripts/traces.ts --ops       # where the time goes, by op
 *   node --import @swc-node/register/esm-register ./scripts/traces.ts --failed    # only what went wrong
 */

/** The logs root, read by hand: this wants a directory, not the app's whole config. */
function env(key: string, fallback: string): string {
    if (process.env[key] !== undefined) return process.env[key];
    const line = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
    return line?.[1]?.trim() ?? fallback;
}

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface Span {
    at: string;
    trace: string;
    kind: string;
    op: string;
    target?: string;
    ms: number;
    outcome: 'ok' | 'failed';
    error?: string;
    detail?: Record<string, unknown>;
}

const dir = resolve(new URL('..', import.meta.url).pathname, env('LOGS_DIR', './logs'), 'traces');
const say = (line: string) => process.stdout.write(`${line}\n`);

function load(): Span[] {
    const files = readdirSync(dir)
        .filter(name => name.endsWith('.jsonl'))
        .sort();
    const spans: Span[] = [];
    for (const name of files) {
        for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
            // A partial last line is possible on a file being appended to right now, and one bad
            // line must not cost the reader the rest of the day.
            if (line.length === 0) continue;
            try {
                spans.push(JSON.parse(line) as Span);
            } catch {
                continue;
            }
        }
    }
    return spans;
}

const ms = (n: number) => `${String(Math.round(n)).padStart(7)}ms`;

/** One decision, in the order it happened. What "correlating a decision's calls" actually buys. */
function one(spans: Span[], id: string): void {
    const mine = spans.filter(s => s.trace.startsWith(id));
    if (mine.length === 0) {
        say(`no spans for ${id}`);
        return;
    }

    const total = mine.reduce((t, s) => t + s.ms, 0);
    say(`${mine[0]!.kind}  ${mine[0]!.trace}`);
    say(`${mine.length} calls, ${Math.round(total / 100) / 10}s of them, ${mine.filter(s => s.outcome === 'failed').length} failed\n`);
    for (const s of mine) {
        const detail = s.detail === undefined ? '' : `  ${JSON.stringify(s.detail)}`;
        say(
            `  ${s.at.slice(11, 23)}  ${ms(s.ms)}  ${s.outcome === 'failed' ? 'FAIL' : '  ok'}  ${s.op} ${s.target ?? ''}${s.error ? `  ${s.error}` : ''}${detail}`,
        );
    }
}

/** The decisions worth looking at, which is the ones that spent the most. */
function decisions(spans: Span[]): void {
    const by = new Map<string, { kind: string; ms: number; calls: number; failed: number }>();
    for (const s of spans) {
        const row = by.get(s.trace) ?? { kind: s.kind, ms: 0, calls: 0, failed: 0 };
        row.ms += s.ms;
        row.calls += 1;
        if (s.outcome === 'failed') row.failed += 1;
        by.set(s.trace, row);
    }

    say(`${by.size} decisions over ${spans.length} calls. The twenty that spent the most:\n`);
    for (const [trace, row] of [...by].sort((a, z) => z[1].ms - a[1].ms).slice(0, 20)) {
        say(`  ${ms(row.ms)}  ${String(row.calls).padStart(4)} calls  ${String(row.failed).padStart(3)} failed  ${row.kind.padEnd(28)} ${trace}`);
    }
}

/** Where the station's time actually goes, which is the question a budget would be argued from. */
function ops(spans: Span[]): void {
    const by = new Map<string, { ms: number; n: number; failed: number; tokens: number }>();
    for (const s of spans) {
        const key = `${s.op} ${s.target ?? ''}`.trim();
        const row = by.get(key) ?? { ms: 0, n: 0, failed: 0, tokens: 0 };
        row.ms += s.ms;
        row.n += 1;
        if (s.outcome === 'failed') row.failed += 1;
        // Only the model reports these, and only when it answered. A call that spent the model and
        // came back with nothing contributes its MILLISECONDS and no tokens, which is the gap this
        // whole file exists to make visible rather than to hide.
        const total = s.detail?.totalTokens;
        if (typeof total === 'number') row.tokens += total;
        by.set(key, row);
    }

    for (const [key, row] of [...by].sort((a, z) => z[1].ms - a[1].ms)) {
        const tokens = row.tokens > 0 ? `  ${row.tokens} tokens` : '';
        say(`  ${ms(row.ms)}  ${String(row.n).padStart(5)} calls  ${String(row.failed).padStart(3)} failed  ${key}${tokens}`);
    }
}

/** Only what went wrong, newest last, with the decision each one belongs to. */
function failed(spans: Span[]): void {
    const bad = spans.filter(s => s.outcome === 'failed');
    say(`${bad.length} failed calls of ${spans.length}\n`);
    for (const s of bad) {
        say(`  ${s.at}  ${ms(s.ms)}  ${s.op} ${s.target ?? ''}  ${s.error ?? ''}`);
        say(`      ${s.kind}  ${s.trace}`);
    }
}

const spans = load();
const [arg] = process.argv.slice(2);

if (spans.length === 0) say(`no spans in ${dir}`);
else if (arg === undefined) decisions(spans);
else if (arg === '--ops') ops(spans);
else if (arg === '--failed') failed(spans);
else one(spans, arg);
