// No setting is read as a boolean or a number straight off the config.
//
// Every layer of `AppConfig` holds strings, and `get`'s overload widens its return from the DEFAULT, so
// `config.get(key, false)` types as boolean and answers the string 'false', which is truthy, and
// `config.get(key, 5432)` types as number and answers text. That was live in six switches and both
// connection ports before `settingIsOn` and the resolvers in setting.numbers.ts existed
// (apps/api/CLAUDE.md, "A setting is a string, and that is the whole of it"). This finds the shape in
// apps/api/src: a `.get` or `.getAs` on a config-like receiver whose default is a boolean or a number.
//
// KNOWN_RAW_SETTING_READS is a ratchet: it only shrinks. Fix a new read with settingIsOn or a resolver;
// never add it here.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SRC = path.join(ROOT, 'apps/api/src');

/** `<file>: <key>`. A boot read of the listen port, which Node coerces; a typo becomes a pipe path. */
const KNOWN_RAW_SETTING_READS = new Set<string>(['apps/api/src/server/setup.server.ts: PORT']);

const RECEIVER = /(config|boot|store|settings)$/i;
const RAW_READ = /([\w.]+)\.get(?:As)?\(\s*(['"`])([^'"`]+)\2\s*,\s*(true|false|-?\d[\d_]*(?:\.\d+)?)\s*\)/g;

function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'generated' ? [] : files(full);
        return entry.name.endsWith('.ts') ? [full] : [];
    });
}

/** Comments out, strings kept: a comment that quotes the bad shape is how the rule is documented. */
function withoutComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function rawReads(): string[] {
    const found: string[] = [];
    for (const file of files(SRC)) {
        const text = withoutComments(readFileSync(file, 'utf8'));
        for (const m of text.matchAll(RAW_READ)) {
            const receiver = m[1] ?? '';
            if (!RECEIVER.test(receiver.split('.').pop() ?? '')) continue;
            found.push(`${path.relative(ROOT, file)}: ${m[3]}`);
        }
    }
    return found.sort();
}

describe('setting reads', () => {
    const reads = rawReads();

    it('finds the shape it is looking for', () => {
        const sample = withoutComments("const on = this.config.get('a.b', false);\n// config.get('c', 1)");
        expect([...sample.matchAll(RAW_READ)].map(m => m[3])).toEqual(['a.b']);
    });

    it('reads no switch or number straight off the config', () => {
        expect(reads.filter(read => !KNOWN_RAW_SETTING_READS.has(read))).toEqual([]);
    });

    it('keeps no known read that has been fixed', () => {
        expect([...KNOWN_RAW_SETTING_READS].filter(read => !reads.includes(read))).toEqual([]);
    });
});
