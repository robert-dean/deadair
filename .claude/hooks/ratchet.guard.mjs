// The judgement behind ratchet.guard.sh, which starts it only for a file under a tests/ folder.
// Reads the PreToolUse JSON on stdin and prints nothing, or one JSON object that asks.
//
// What asks:
//   * in any test file: one more .skip, .only, .todo, .skipIf, .runIf, .fails, xit, xtest or xdescribe
//     than the file had;
//   * in a guard (a file under apps/api/tests/architecture/):
//       - an entry added to a list named KNOWN_* or BASELINE_* (a ratchet: it only shrinks), or to one
//         named EXEMPT*, NOT_* or NO_* (each entry excuses something);
//       - any change to any other CONSTANT_CASE list, which is part of the detector;
//       - any change to the code outside those lists: the regexes, the scope, the assertions. Comments
//         and whitespace are ignored, so rewording a comment passes;
//       - a ratchet or exemption list that is no longer a plain literal, or is gone.
// What passes: shrinking a ratchet, removing an exemption, editing comments, and writing a new guard.
//
// The edit is judged against the whole file when old_string is in it, and on its own otherwise (a new
// file, or a payload in hooks.test.sh). Advisory: it always exits 0.

import { existsSync, readFileSync } from 'node:fs';

const DECISION = 'ask';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let input;
try {
    input = JSON.parse(raw);
} catch {
    process.exit(0);
}
const tool = input.tool_name ?? '';
const ti = input.tool_input ?? {};
const file = String(ti.file_path ?? '').replaceAll('\\', '/');
if (!/\/tests\//.test(file)) process.exit(0);

const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
let before = current;
let after = current;
if (tool === 'Write') {
    after = String(ti.content ?? '');
} else {
    const edits = Array.isArray(ti.edits) ? ti.edits : [{ old_string: ti.old_string, new_string: ti.new_string, replace_all: ti.replace_all }];
    const whole = edits.every(e => typeof e.old_string === 'string' && after.includes(e.old_string));
    if (whole) {
        for (const e of edits) after = e.replace_all ? after.split(e.old_string).join(e.new_string) : after.replace(e.old_string, () => e.new_string);
    } else {
        before = edits.map(e => String(e.old_string ?? '')).join('\n');
        after = edits.map(e => String(e.new_string ?? '')).join('\n');
    }
}

/** Comments out and whitespace collapsed, strings and regexes kept. */
function code(text) {
    let out = '';
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            out += '\n';
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            i = text.indexOf('*/', i + 2);
            if (i === -1) break;
            i++;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') {
            let j = i + 1;
            while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
            out += text.slice(i, j + 1);
            i = j;
            continue;
        }
        out += c;
    }
    return out.replace(/\s+/g, ' ').trim();
}

const SKIP = /\b(?:it|test|describe|suite|bench)\.(?:skip|only|todo|skipIf|runIf|fails)\b|\b(?:xit|xtest|xdescribe)\s*\(/g;
const skips = text => (code(text).match(SKIP) ?? []).length;

function ask(reason) {
    process.stdout.write(
        JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: DECISION,
                permissionDecisionReason: reason,
                additionalContext: reason,
            },
        }) + '\n',
    );
    process.exit(0);
}

const rel = file.replace(/^.*?\/(apps|packages|plugins)\//, '$1/');
if (skips(after) > skips(before)) {
    ask(
        `This edit skips, focuses or defers a test in ${rel}. A skipped test reports as passing; fix it, or give apps/api/tests/architecture/skipped.tests.test.ts an EXEMPT_SKIPS entry saying why it cannot run everywhere.`,
    );
}

if (!/\/apps\/api\/tests\/architecture\//.test(file)) process.exit(0);
if (tool === 'Write' && current === '') process.exit(0);

// A CONSTANT_CASE list: `const NAME = [...]`, `new Set<...>([...])` or `new Map<...>([...])`.
const LIST = /\bconst ([A-Z][A-Z0-9_]*)(?:\s*:\s*[^=]+)?\s*=\s*(?:new (?:Set|Map)(?:<[^>]*(?:<[^>]*>[^>]*)*>)?\(\s*)?\[/g;

function lists(text) {
    const src = code(text);
    const found = new Map();
    let rest = src;
    for (const m of src.matchAll(LIST)) {
        const start = m.index + m[0].length - 1;
        let depth = 0;
        let end = -1;
        for (let i = start; i < src.length; i++) {
            const ch = src[i];
            if (ch === "'" || ch === '"' || ch === '`') {
                let j = i + 1;
                while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1;
                i = j;
                continue;
            }
            if (ch === '[') depth++;
            if (ch === ']' && --depth === 0) {
                end = i;
                break;
            }
        }
        if (end === -1) continue;
        const body = src.slice(start, end + 1);
        const isMap = /new Map/.test(m[0]);
        const entries = isMap
            ? [...body.matchAll(/\[\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map(e => e[2])
            : [...body.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map(e => e[2]);
        const plain = !/\.\.\.|\(/.test(body.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, ''));
        found.set(m[1], { entries, body, plain });
        rest = rest.replace(body, `[${m[1]}]`);
    }
    return { found, rest };
}

const directional = name => /^(KNOWN_|BASELINE_|EXEMPT|NOT_|NO_)/.test(name);
const b = lists(before);
const a = lists(after);

for (const [name, old] of b.found) {
    const now = a.found.get(name);
    if (!now) {
        if (directional(name))
            ask(
                `This edit removes or rewrites the list ${name} in the guard ${rel}. Its entries only shrink one at a time; say why the list itself should change.`,
            );
        continue;
    }
    if (directional(name)) {
        if (!now.plain) ask(`${name} in ${rel} is no longer a plain literal list, so the guard can no longer be read at a glance.`);
        const added = now.entries.filter(e => !old.entries.includes(e));
        if (added.length > 0) {
            ask(
                `This edit adds ${added.map(e => `'${e}'`).join(', ')} to ${name} in the guard ${rel}. ${/^(KNOWN_|BASELINE_)/.test(name) ? 'That list is a ratchet: it only shrinks. Fix the code instead.' : 'Each entry excuses a case; approve only with a reason the guard cannot express.'}`,
            );
        }
    } else if (old.body !== now.body) {
        ask(`This edit changes ${name}, part of what the guard in ${rel} detects. Say why the detector should change.`);
    }
}
for (const name of a.found.keys()) {
    if (!b.found.has(name) && !directional(name) && b.found.size > 0) ask(`This edit adds the list ${name} to the detector in ${rel}.`);
}

if (b.rest !== a.rest) {
    ask(
        `This edit changes the code of the guard ${rel} (its scope, patterns or assertions), not only its comments or lists. Say what the guard should catch now that it did not, or should stop catching.`,
    );
}
process.exit(0);
