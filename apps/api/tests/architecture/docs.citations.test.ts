// Every file a Claude-facing doc cites still exists.
//
// The CLAUDE.md files, docs/internals and .claude are what a session reads before it touches anything,
// and they name files constantly: "copy X", "the rule lives in Y". A rename leaves those names pointing
// at nothing, and nothing failed when it did: the root CLAUDE.md once sent readers to a directory of
// design arguments that had never existed. This reads every backticked path and every relative
// markdown link in those docs and checks that it names something in the tree.
//
// What counts as a citation: a backticked token that starts with a top-level folder (`apps/`,
// `plugins/`, `.claude/` and the rest) or that holds a `/` and ends in a source extension, and the
// target of a relative markdown link. Globs, placeholders (`<name>`, `{area}`), URL paths (`/api/...`)
// and host names are skipped. Docs abbreviate freely (`director/talk.up.ts` for the file under
// apps/api/src/modules), so a citation resolves when it exists from the repo root or from the doc's
// folder or any folder above it, when a tracked path ends with it, or when it is a gitignored build
// output (a bundle the build writes, a page copied in at build time).
//
// A citation that is deliberately not in the tree (a folder named as history, a path inside a built
// app bundle) goes in EXEMPT_CITATIONS with the reason. Fix a broken citation in the doc; an
// exemption is for one that was never meant to resolve.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** `<doc> -> <citation>`, each with why it is not in the tree. */
const EXEMPT_CITATIONS = new Map<string, string>([
    ['CLAUDE.md -> docs/todo/', 'history: where the Ideas discussions lived until 2026-09-11'],
    ['apps/desktop/CLAUDE.md -> plugins/deadair-bluos/', 'a folder inside the built .app bundle, not the repo'],
    ['apps/desktop/CLAUDE.md -> plugins/deadair.bluos', 'the bundle layout that failed the signed-app check, cited as history'],
    ['apps/site/CLAUDE.md -> develop/contributing.md', 'the page docs.sync.mjs copies CONTRIBUTING.md to under apps/site/docs at build time'],
    ['apps/site/CLAUDE.md -> plugin-development/contract.md', 'the page docs.sync.mjs copies the plugin SDK README to at build time'],
    ['apps/streamdeck/CLAUDE.md -> ui/station.js', 'the inspector bundle tsup writes inside the .sdPlugin folder'],
]);

const TOP_LEVEL = /^(apps|packages|plugins|docs|analysis|ytaudio|stream|nginx|deploy|unraid|docker|scripts|\.claude|\.github)\//;
const SOURCE_FILE = /\.(ts|tsx|mjs|js|md|sql|ck|perm|liq|kt|kts|cs|swift|py|json|ya?ml|sh|xml|toml)$/;
const NOT_A_PATH = /[*{}<>$|\s]/;
const HOST_LIKE = /^[a-z0-9-]+\.[a-z]+\//;

const git = (...args: string[]): string => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const docs = git('ls-files', '*CLAUDE.md', 'docs/internals/*.md', '.claude/*.md').trim().split('\n').filter(Boolean);
const tracked = git('ls-files').trim().split('\n');

interface Citation {
    doc: string;
    target: string;
    link: boolean;
}

function citations(doc: string): Citation[] {
    const text = readFileSync(path.join(ROOT, doc), 'utf8');
    const found = new Map<string, Citation>();
    for (const m of text.matchAll(/`([^`\s]+)`/g)) {
        const target = clean(m[1] ?? '');
        if (!target || NOT_A_PATH.test(target) || target.startsWith('/') || HOST_LIKE.test(target)) continue;
        if (!TOP_LEVEL.test(target) && !(target.includes('/') && SOURCE_FILE.test(target))) continue;
        found.set(`c:${target}`, { doc, target, link: false });
    }
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const raw = m[1] ?? '';
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#') || raw.startsWith('/')) continue;
        const target = clean(raw.replace(/#.*$/, ''));
        if (!target || NOT_A_PATH.test(target)) continue;
        found.set(`l:${target}`, { doc, target, link: true });
    }
    return [...found.values()];
}

function clean(token: string): string {
    return token
        .replace(/#.*$/, '')
        .replace(/[:,.;]+$/, '')
        .replace(/:\d+(-\d+)?$/, '');
}

function ancestors(doc: string): string[] {
    const dirs: string[] = [];
    let dir = path.dirname(doc);
    for (;;) {
        dirs.push(dir);
        if (dir === '.' || dir === '') return dirs;
        dir = path.dirname(dir);
    }
}

function resolves({ doc, target }: Citation): boolean {
    if (ancestors(doc).some(dir => existsSync(path.join(ROOT, dir, target)))) return true;
    const tail = target.replace(/^\.\.\.\//, '').replace(/\/$/, '');
    return tracked.some(file => file.endsWith(`/${tail}`) || file.includes(`/${tail}/`));
}

function ignoredOutputs(candidates: Citation[]): Set<Citation> {
    const paths = candidates.flatMap(c => ancestors(c.doc).map(dir => path.join(dir, c.target)));
    if (paths.length === 0) return new Set();
    let out = '';
    try {
        out = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: ROOT, encoding: 'utf8', input: paths.join('\n') });
    } catch (error) {
        // Exit 1 means "none of them is ignored"; anything printed before it still counts.
        out = (error as { stdout?: string }).stdout ?? '';
    }
    const ignored = new Set(out.trim().split('\n').filter(Boolean));
    return new Set(candidates.filter(c => ancestors(c.doc).some(dir => ignored.has(path.join(dir, c.target)))));
}

describe('paths cited in the Claude-facing docs', () => {
    const all = docs.flatMap(citations);

    it('finds the docs and a meaningful number of citations in them', () => {
        expect(docs).toContain('CLAUDE.md');
        expect(all.length).toBeGreaterThan(300);
    });

    it('names files and folders that exist', () => {
        const unresolved = all.filter(c => !resolves(c));
        const outputs = ignoredOutputs(unresolved);
        const broken = unresolved
            .filter(c => !outputs.has(c))
            .map(c => `${c.doc} -> ${c.target}`)
            .filter(key => !EXEMPT_CITATIONS.has(key));
        expect(broken).toEqual([]);
    });

    it('keeps no exemption that has stopped being needed', () => {
        const unresolved = new Set(all.filter(c => !resolves(c)).map(c => `${c.doc} -> ${c.target}`));
        expect([...EXEMPT_CITATIONS.keys()].filter(key => !unresolved.has(key))).toEqual([]);
    });
});
