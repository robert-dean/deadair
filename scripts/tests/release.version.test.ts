import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { USAGE, parseArguments } from '../release.changelog.mjs';

const root = resolve(import.meta.dirname, '../..');

describe('parseArguments', () => {
    it('reads the three commands', () => {
        expect(parseArguments([])).toEqual({ mode: 'version' });
        expect(parseArguments(['--summary', 'body.md'])).toEqual({ mode: 'version', summary: 'body.md' });
        expect(parseArguments(['--check'])).toEqual({ mode: 'check' });
        expect(parseArguments(['--sync'])).toEqual({ mode: 'sync' });
    });

    it.each([
        [['--chek'], '--chek'],
        [['--summary=body.md'], '--summary=body.md'],
        [['check'], 'check'],
        [['--check', '--sync'], '--sync'],
        [['--check', 'extra'], 'extra'],
        [['--sync', '--summary', 'body.md'], '--summary'],
        [['--summary', 'body.md', '--check'], '--check'],
    ])('refuses %j rather than bumping', (args, named) => {
        expect(() => parseArguments(args)).toThrow(`Unexpected argument: ${named}`);
    });

    it.each([[['--summary']], [['--summary', '']], [['--summary', '--check']]])('refuses %j, which names no file', args => {
        expect(() => parseArguments(args)).toThrow('--summary needs the file');
    });
});

// Only arguments that are refused are run for real: those exit before anything is read, so the
// changesets and manifests are never touched. A bump is never run here.
describe('release.version.mjs on the command line', () => {
    it.each([[['--chek']], [['--summary']], [['--summary=body.md']]])('exits 1 with the usage for %j', args => {
        const run = spawnSync(process.execPath, ['scripts/release.version.mjs', ...args], { cwd: root, encoding: 'utf8' });
        expect(run.status).toBe(1);
        expect(run.stderr).toContain(USAGE);
        expect(run.stdout).toBe('');
    });

    it('still checks the mirrored versions', () => {
        const run = spawnSync(process.execPath, ['scripts/release.version.mjs', '--check'], { cwd: root, encoding: 'utf8' });
        expect(run.stderr).toBe('');
        expect(run.status).toBe(0);
    });
});
