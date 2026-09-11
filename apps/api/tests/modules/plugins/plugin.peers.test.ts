import { execFile } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { PluginLoaderOptions } from '../../../src/modules/plugins/plugin.loader.js';
import { PLUGIN_SDK_PACKAGE, PluginPeerLinker, linkPluginPeers, resolvePluginPeers } from '../../../src/modules/plugins/plugin.peers.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const run = promisify(execFile);
const FIXTURES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/plugins');

const tempDirs: string[] = [];

async function scratch(prefix = 'deadair-peers-test-'): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

const linkAt = (pluginsDir: string, name: string): string => join(pluginsDir, 'node_modules', ...name.split('/'));

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('resolvePluginPeers', () => {
    it('answers the SDK and its required peers, and leaves the optional test runner out', async () => {
        const peers = await resolvePluginPeers();

        expect(peers.map(peer => peer.name)).toEqual([PLUGIN_SDK_PACKAGE, 'zod']);
        for (const peer of peers) {
            expect(isAbsolute(peer.dir)).toBe(true);
            expect(await realpath(peer.dir)).toBe(peer.dir);
            const manifest = JSON.parse(await readFile(join(peer.dir, 'package.json'), 'utf8')) as { name: string };
            expect(manifest.name).toBe(peer.name);
        }
    });
});

describe('linkPluginPeers', () => {
    it('links each peer into node_modules, and a second pass finds nothing to do', async () => {
        const pluginsDir = await scratch();
        const peers = await resolvePluginPeers();

        const first = await linkPluginPeers(pluginsDir, peers);

        expect(first.skipped).toBeUndefined();
        expect(first.results.map(result => result.outcome)).toEqual(['linked', 'linked']);
        for (const peer of peers) {
            expect((await lstat(linkAt(pluginsDir, peer.name))).isSymbolicLink()).toBe(true);
            expect(await realpath(linkAt(pluginsDir, peer.name))).toBe(peer.dir);
        }

        const second = await linkPluginPeers(pluginsDir, peers);
        expect(second.results.map(result => result.outcome)).toEqual(['unchanged', 'unchanged']);
    });

    it('relinks a link left pointing somewhere else, which is what an image upgrade leaves behind', async () => {
        const pluginsDir = await scratch();
        const [sdk] = await resolvePluginPeers();
        const elsewhere = await scratch('deadair-peers-elsewhere-');
        await mkdir(dirname(linkAt(pluginsDir, sdk!.name)), { recursive: true });
        await symlink(elsewhere, linkAt(pluginsDir, sdk!.name), 'dir');

        const report = await linkPluginPeers(pluginsDir, [sdk!]);

        expect(report.results[0]?.outcome).toBe('relinked');
        expect(await readlink(linkAt(pluginsDir, sdk!.name))).toBe(sdk!.dir);
    });

    it('relinks a dangling link', async () => {
        const pluginsDir = await scratch();
        const [sdk] = await resolvePluginPeers();
        await mkdir(dirname(linkAt(pluginsDir, sdk!.name)), { recursive: true });
        await symlink(join(pluginsDir, 'gone'), linkAt(pluginsDir, sdk!.name), 'dir');

        const report = await linkPluginPeers(pluginsDir, [sdk!]);

        expect(report.results[0]?.outcome).toBe('relinked');
    });

    it('keeps a real directory in the way rather than deleting what somebody put there', async () => {
        const pluginsDir = await scratch();
        const [sdk] = await resolvePluginPeers();
        await mkdir(linkAt(pluginsDir, sdk!.name), { recursive: true });
        await writeFile(join(linkAt(pluginsDir, sdk!.name), 'package.json'), '{"name":"someone-elses"}');

        const report = await linkPluginPeers(pluginsDir, [sdk!]);

        expect(report.results[0]).toMatchObject({ outcome: 'kept' });
        expect(report.results[0]?.reason).toContain('left alone');
        expect(await readFile(join(linkAt(pluginsDir, sdk!.name), 'package.json'), 'utf8')).toContain('someone-elses');
    });

    it('skips a plugins directory that does not exist, and does not create one', async () => {
        const missing = join(await scratch(), 'plugins');

        const report = await linkPluginPeers(missing);

        expect(report.skipped).toMatch(/does not exist/);
        expect(report.results).toEqual([]);
        await expect(stat(missing)).rejects.toThrow();
    });

    it('resolves rather than rejects when the plugins directory cannot hold links', async () => {
        // A file where the directory should be: the reachable stand-in for a read-only mount, which
        // a test cannot make, and which has to take the same never-fail path.
        const file = join(await scratch(), 'plugins');
        await writeFile(file, '');

        await expect(linkPluginPeers(file)).resolves.toMatchObject({ skipped: expect.stringMatching(/not a directory/) });
    });

    it('reports a link it could not write as skipped, with the reason, rather than throwing', async () => {
        const pluginsDir = await scratch();
        // `node_modules` as a FILE makes every link beneath it unwritable.
        await writeFile(join(pluginsDir, 'node_modules'), '');

        const report = await linkPluginPeers(pluginsDir);

        expect(report.results.map(result => result.outcome)).toEqual(['skipped', 'skipped']);
        expect(report.results[0]?.reason).toBeTruthy();
    });
});

describe('an installed plugin, loaded by Node rather than by vitest', () => {
    // Vitest resolves a bare specifier from the project root whatever file it appears in, which is
    // how the loader fixtures import `zod` from a copy under the system temp directory and pass. It
    // cannot tell a working link from a missing one, so this spawns a real `node`, and the first case
    // is the control: the same plugin, the same directory, no link, and Node refuses it.
    const IMPORT_BOTH = [
        'const [pluginUrl, sdkUrl] = process.argv.slice(1);',
        'const plugin = await import(pluginUrl);',
        'const sdk = await import(sdkUrl);',
        'console.log(JSON.stringify({ id: plugin.default.manifest.id, sameClass: plugin.PluginError === sdk.PluginError }));',
    ].join('\n');

    async function installed(): Promise<{ pluginsDir: string; entryUrl: string }> {
        const pluginsDir = await scratch();
        await cp(join(FIXTURES_ROOT, 'peer-importing-plugin'), join(pluginsDir, 'peer-importing-plugin'), { recursive: true });
        return { pluginsDir, entryUrl: pathToFileURL(join(pluginsDir, 'peer-importing-plugin', 'entry.js')).href };
    }

    async function sdkEntryUrl(): Promise<string> {
        const [sdk] = await resolvePluginPeers();
        return pathToFileURL(join(sdk!.dir, 'dist', 'index.js')).href;
    }

    it('cannot resolve the SDK from the plugins directory without the link', async () => {
        const { entryUrl } = await installed();

        const failure = await run(process.execPath, ['--input-type=module', '-e', IMPORT_BOTH, entryUrl, await sdkEntryUrl()]).then(
            () => undefined,
            (error: { stderr: string }) => error,
        );

        expect(failure?.stderr).toMatch(/ERR_MODULE_NOT_FOUND/);
        expect(failure?.stderr).toContain(PLUGIN_SDK_PACKAGE);
    });

    it('resolves the host’s own SDK and zod once the peers are linked, as the very same instance', async () => {
        const { pluginsDir, entryUrl } = await installed();
        await linkPluginPeers(pluginsDir);

        const { stdout } = await run(process.execPath, ['--input-type=module', '-e', IMPORT_BOTH, entryUrl, await sdkEntryUrl()]);

        expect(JSON.parse(stdout)).toEqual({ id: 'test.peer-importing', sameClass: true });
    });
});

describe('PluginPeerLinker', () => {
    it('warns, naming the package, when a link cannot be made', async () => {
        const pluginsDir = await scratch();
        await mkdir(linkAt(pluginsDir, 'zod'), { recursive: true });
        const log = stubPluginLog();

        await new PluginPeerLinker(new PluginLoaderOptions(pluginsDir), log.log).link();

        expect(log.log.warn).toHaveBeenCalledWith(expect.stringContaining('cannot resolve zod'), expect.objectContaining({ peer: 'zod' }));
    });

    it('stays quiet about a plugins directory nobody has created', async () => {
        const log = stubPluginLog();

        const report = await new PluginPeerLinker(new PluginLoaderOptions(join(await scratch(), 'plugins')), log.log).link();

        expect(report.skipped).toBeDefined();
        expect(log.log.warn).not.toHaveBeenCalled();
        expect(log.log.debug).toHaveBeenCalled();
    });
});
