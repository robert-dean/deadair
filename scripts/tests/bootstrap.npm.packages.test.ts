import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The bootstrap script is run by hand with a real npm login, so these never let it reach npm: the
// functions are called by sourcing it, and main runs against an `npm` stub first on PATH that answers
// from environment variables and logs what it was asked to change. Only paths where every package is
// already on npm are run, so nothing here builds, publishes or adds a worktree.

const root = resolve(import.meta.dirname, '../..');
const script = join(root, 'scripts/bootstrap.npm.packages.sh');

const ours = { id: 'abc', type: 'github', file: 'release.yml', repository: 'robert-dean/deadair', permissions: ['createPackage'] };

function trustState(raw: string): string {
    const run = spawnSync('bash', ['-c', 'source "$1"; trust_state "$2"', 'test', script, raw], { cwd: root, encoding: 'utf8' });
    expect(run.stderr).toBe('');
    return run.stdout.trim();
}

function atLeast(required: string, current: string): boolean {
    return spawnSync('bash', ['-c', 'source "$1"; version_at_least "$2" "$3"', 'test', script, required, current], { cwd: root }).status === 0;
}

const stub = `#!/usr/bin/env bash
case "$1" in
    whoami) echo someone ;;
    -v) echo "$STUB_NPM_VERSION" ;;
    view)
        if [ -n "\${STUB_VIEW_ERROR:-}" ]; then echo "$STUB_VIEW_ERROR" >&2; exit 1; fi
        echo 0.105.1 ;;
    trust)
        case "$2" in
            list) printf '%s' "$STUB_TRUST_LIST" ;;
            revoke) echo "revoke $3 $4" >> "$STUB_LOG"; exit "\${STUB_REVOKE_EXIT:-0}" ;;
            github) echo "github $3" >> "$STUB_LOG"; exit "\${STUB_GITHUB_EXIT:-0}" ;;
        esac ;;
    *) echo "unexpected npm $*" >&2; exit 99 ;;
esac
`;

function runMain(env: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'npm-stub-'));
    writeFileSync(join(dir, 'npm'), stub);
    chmodSync(join(dir, 'npm'), 0o755);
    const log = join(dir, 'log');
    writeFileSync(log, '');
    const run = spawnSync('bash', [script], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, STUB_NPM_VERSION: '11.19.0', STUB_TRUST_LIST: '', STUB_LOG: log, ...env },
    });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr, changed: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
}

describe('trust_state', () => {
    it('accepts exactly this repository’s release.yml, allowed to publish, in no environment', () => {
        expect(trustState(JSON.stringify(ours))).toBe('OK');
        expect(trustState(JSON.stringify({ ...ours, permissions: ['createStagedPackage', 'createPackage'] }))).toBe('OK');
    });

    it('reads nothing configured as NONE', () => {
        expect(trustState('')).toBe('NONE');
        expect(trustState('{}')).toBe('NONE');
        expect(trustState('[]')).toBe('NONE');
    });

    it.each([
        ['another workflow whose name ends in release.yml', { file: 'android-release.yml' }],
        ['the desktop workflow', { file: 'desktop-release.yml' }],
        ['a repository whose name starts with this one’s', { repository: 'robert-dean/deadair-something' }],
        ['a config pinned to an environment', { environment: 'npm' }],
        ['a config that may only stage', { permissions: ['createStagedPackage'] }],
        ['a config with no permissions', { permissions: [] }],
        ['another provider', { type: 'gitlab' }],
    ])('treats %s as stale, by its id', (_, change) => {
        expect(trustState(JSON.stringify({ ...ours, ...change }))).toBe('MISMATCH:abc');
    });

    it('refuses to guess about output that is not one config', () => {
        expect(trustState(`${JSON.stringify(ours)}\n${JSON.stringify(ours)}`)).toBe('UNREADABLE');
        expect(trustState(JSON.stringify([ours, ours]))).toBe('UNREADABLE');
        expect(trustState('npm error something')).toBe('UNREADABLE');
        expect(trustState(JSON.stringify({ ...ours, file: 'other.yml', id: undefined }))).toBe('UNREADABLE');
    });
});

describe('version_at_least', () => {
    it('compares npm versions numerically', () => {
        expect(atLeast('11.15.0', '11.15.0')).toBe(true);
        expect(atLeast('11.15.0', '11.19.0')).toBe(true);
        expect(atLeast('11.15.0', '12.0.0')).toBe(true);
        expect(atLeast('11.15.0', '11.5.1')).toBe(false);
        expect(atLeast('11.15.0', '11.14.9')).toBe(false);
    });
});

describe('main, against a stubbed npm', () => {
    it('refuses an npm older than npm trust', () => {
        const run = runMain({ STUB_NPM_VERSION: '11.5.1' });
        expect(run.status).toBe(1);
        expect(run.stdout).toContain('11.15.0');
        expect(run.changed).toEqual([]);
    });

    it('leaves a correct config alone and says Done', () => {
        const run = runMain({ STUB_TRUST_LIST: JSON.stringify(ours) });
        expect(run.status).toBe(0);
        expect(run.stdout).toContain('Done.');
        expect(run.changed).toEqual([]);
    });

    it('replaces a stale config by revoking its id, then creating', () => {
        const run = runMain({ STUB_TRUST_LIST: JSON.stringify({ ...ours, file: 'android-release.yml' }) });
        expect(run.status).toBe(0);
        expect(run.changed).toEqual([
            'revoke @deadair/plugin-sdk --id=abc',
            'github @deadair/plugin-sdk',
            'revoke @deadair/sdk --id=abc',
            'github @deadair/sdk',
        ]);
    });

    it('exits nonzero, naming the package, when creating fails', () => {
        const run = runMain({ STUB_GITHUB_EXIT: '1' });
        expect(run.status).toBe(1);
        expect(run.stdout).not.toContain('Done.');
        expect(run.stderr).toContain('@deadair/plugin-sdk @deadair/sdk could not be trusted');
    });

    it('does not create over a config it could not revoke', () => {
        const run = runMain({ STUB_TRUST_LIST: JSON.stringify({ ...ours, environment: 'npm' }), STUB_REVOKE_EXIT: '1' });
        expect(run.status).toBe(1);
        expect(run.stderr).toContain('could not revoke trust config abc');
        expect(run.changed.filter(line => line.startsWith('github'))).toEqual([]);
    });

    it('stops on an npm view error that is not E404, before changing anything', () => {
        const run = runMain({ STUB_VIEW_ERROR: 'npm error code ENOTFOUND' });
        expect(run.status).toBe(1);
        expect(run.stderr).toContain('Could not ask npm whether @deadair/plugin-sdk exists');
        expect(run.changed).toEqual([]);
    });
});
