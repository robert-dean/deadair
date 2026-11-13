// No test in the repo is skipped, focused or left as a todo.
//
// A skipped test reports as passing in every summary anybody reads, and `.only` silently drops every
// other case in its file. None exists today, so the list of excused ones starts empty. A test that can
// only run somewhere specific (a platform, a binary on the PATH) goes in EXEMPT_SKIPS with that reason.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** `<file>: <marker>`, each with why it may not run everywhere. */
const EXEMPT_SKIPS = new Map<string, string>([]);

const MARKER = /\b(?:it|test|describe|suite|bench)\.(skip|only|todo|skipIf|runIf|fails)\b|\b(xit|xtest|xdescribe)\s*\(/g;

const tests = execFileSync('git', ['ls-files', '*.test.ts', '*.test.tsx', '*.spec.ts'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .trim()
    .split('\n')
    .filter(file => file !== 'apps/api/tests/architecture/skipped.tests.test.ts');

function withoutComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

describe('skipped tests', () => {
    const found = tests.flatMap(file => {
        const text = withoutComments(readFileSync(path.join(ROOT, file), 'utf8'));
        return [...text.matchAll(MARKER)].map(m => `${file}: ${m[1] ?? m[2]}`);
    });

    it('reads every test file in the repo', () => {
        expect(tests.length).toBeGreaterThan(300);
    });

    it('finds the markers it is looking for', () => {
        expect([..."it.skip('a'); describe.only('b'); xit('c'); client.skip()".matchAll(MARKER)].map(m => m[1] ?? m[2])).toEqual([
            'skip',
            'only',
            'xit',
        ]);
    });

    it('skips, focuses and defers nothing', () => {
        expect(found.filter(marker => !EXEMPT_SKIPS.has(marker))).toEqual([]);
    });

    it('keeps no exemption that has stopped being needed', () => {
        expect([...EXEMPT_SKIPS.keys()].filter(key => !found.includes(key))).toEqual([]);
    });
});
