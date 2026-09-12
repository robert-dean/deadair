// The installer puts a plugin an operator hands over into the plugins directory. These tests build
// real tarballs, with tar itself for the honest ones and header by header for the ones tar would
// never write, and hand them to the installer through a stand-in for the multipart parser.

import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { IsHttpError } from '@maroonedsoftware/errors';
import type { MultipartBody } from '@maroonedsoftware/multipart';
import { Header, create, type HeaderData } from 'tar';

import { MAX_PLUGIN_UNPACKED_BYTES, PluginInstaller, pluginDirName } from '../../../src/modules/plugins/plugin.installer.js';
import { PluginLoader, PluginLoaderOptions } from '../../../src/modules/plugins/plugin.loader.js';
import type { PluginPeerLinker } from '../../../src/modules/plugins/plugin.peers.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const FIXTURES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/plugins');

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

/** An installer over a fresh plugins directory. The peer links are not what these tests are about. */
async function installerIn(): Promise<{ installer: PluginInstaller; pluginsDir: string }> {
    const pluginsDir = join(await tempDir('deadair-install-test-'), 'plugins');
    const linker = { link: async () => ({ pluginsDir, results: [] }) } as unknown as PluginPeerLinker;
    return { installer: new PluginInstaller(new PluginLoaderOptions(pluginsDir), linker, stubPluginLog().log), pluginsDir };
}

/**
 * A loader fixture as `npm pack` would write it: every file under `package/`, gzipped, with a version
 * in its package.json (the fixtures carry none, since the loader never reads one).
 */
async function packFixture(name: string, version = '1.0.0', patch: Record<string, unknown> = {}): Promise<Buffer> {
    const source = join(await tempDir('deadair-pack-src-'), name);
    await cp(join(FIXTURES_ROOT, name), source, { recursive: true });
    const pkgPath = join(source, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as Record<string, unknown>;
    await writeFile(pkgPath, JSON.stringify({ ...pkg, version, ...patch }), 'utf8');

    const file = join(await tempDir('deadair-pack-out-'), `${name}.tgz`);
    await create({ gzip: true, cwd: source, prefix: 'package', file, portable: true }, await readdir(source));
    return readFile(file);
}

interface RawEntry extends HeaderData {
    body?: string;
}

/** A tarball written header by header, for the entries tar itself would never produce. */
function rawTarball(entries: RawEntry[]): Buffer {
    const blocks: Buffer[] = [];
    for (const { body, ...data } of entries) {
        const bytes = Buffer.from(body ?? '');
        const block = Buffer.alloc(512);
        new Header({ mode: 0o644, uid: 0, gid: 0, mtime: new Date(0), type: 'File', size: bytes.length, ...data }).encode(block, 0);
        blocks.push(block);
        if (data.size === undefined && bytes.length > 0) blocks.push(bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
    }
    blocks.push(Buffer.alloc(1024));
    return gzipSync(Buffer.concat(blocks));
}

const PACKAGE_JSON: RawEntry = {
    path: 'package/package.json',
    body: JSON.stringify({ name: 'raw-plugin', version: '1.0.0', type: 'module', deadair: { plugin: 'entry.js' } }),
};

/** The multipart parser, reduced to handing over one file. */
function upload(bytes: Buffer): MultipartBody {
    return {
        parse: async (handler: (field: string, stream: Readable, filename: string, encoding: string, mime: string) => Promise<void>) => {
            await handler('file', Readable.from([bytes]), 'plugin.tgz', '7bit', 'application/gzip');
            return new Map();
        },
    } as unknown as MultipartBody;
}

async function refusal(promise: Promise<unknown>): Promise<{ status: number; message: string }> {
    try {
        await promise;
    } catch (error) {
        if (!IsHttpError(error)) throw error;
        const details = (error as { details?: { message?: string } }).details;
        return { status: error.statusCode, message: details?.message ?? '' };
    }
    throw new Error('expected a refusal, and it was accepted');
}

/** What is left under the staging directory, which every path through the installer must leave empty. */
async function staged(pluginsDir: string): Promise<string[]> {
    return readdir(join(pluginsDir, '.staging')).catch(() => []);
}

describe('pluginDirName', () => {
    it('names a folder after the package and its version, scope and all', () => {
        expect(pluginDirName('deadair-plugin-charts', '1.2.0')).toBe('deadair-plugin-charts-1.2.0');
        expect(pluginDirName('@acme/deadair-charts', '2.0.0-beta.1+build.7')).toBe('acme-deadair-charts-2.0.0-beta.1-build.7');
    });

    it('never names one that the loader would skip, or nothing at all', () => {
        expect(pluginDirName('.hidden', '1.0.0')).toBe('hidden-1.0.0');
        expect(pluginDirName('///', '1.0.0')).toBeUndefined();
    });
});

describe('PluginInstaller.stage and place', () => {
    it('unpacks an npm-packed plugin, has the loader load it, and moves it to <name>-<version>', async () => {
        const { installer, pluginsDir } = await installerIn();

        const plugin = await installer.stage(upload(await packFixture('valid-plugin')));

        expect(plugin).toMatchObject({ id: 'test.valid', name: 'Test Valid Plugin', packageName: 'test-fixture-valid-plugin', version: '1.0.0' });
        expect(plugin.targetDir).toBe(join(pluginsDir, 'test-fixture-valid-plugin-1.0.0'));
        expect(plugin.restartRequired).toBe(false);

        await installer.place(plugin, []);

        const [record] = await new PluginLoader(new PluginLoaderOptions(pluginsDir)).discover();
        expect(record).toMatchObject({ id: 'test.valid', status: 'discovered', dir: plugin.targetDir });
        expect(await staged(pluginsDir)).toEqual([]);
    });

    it('refuses what the loader would quarantine, with the loader own reason, and leaves nothing behind', async () => {
        const { installer, pluginsDir } = await installerIn();

        const { status, message } = await refusal(installer.stage(upload(await packFixture('bad-manifest'))));

        expect(status).toBe(422);
        expect(message).toContain('test-fixture-bad-manifest 1.0.0 did not load: invalid manifest');
        expect(message).not.toContain('.staging');
        expect(await staged(pluginsDir)).toEqual([]);
        expect(await readdir(pluginsDir)).toEqual(['.staging']);
    });

    it('refuses a package that is not a plugin at all', async () => {
        const { installer } = await installerIn();
        const bytes = rawTarball([{ path: 'package/package.json', body: JSON.stringify({ name: 'left-pad', version: '1.0.0' }) }]);

        const { status, message } = await refusal(installer.stage(upload(bytes)));

        expect(status).toBe(400);
        expect(message).toContain('left-pad is not a deadair plugin');
    });

    it.each([
        ['an entry that climbs out of the folder', { path: 'package/../escaped.js', body: 'x' }, 'climbs out'],
        ['an entry outside package/', { path: 'elsewhere/entry.js', body: 'x' }, 'not under package/'],
        ['an absolute path', { path: '/etc/cron.d/evil', body: 'x' }, 'not under package/'],
        ['a symbolic link', { path: 'package/entry.js', type: 'SymbolicLink', linkpath: '/etc/passwd' }, 'SymbolicLink'],
        ['a hard link', { path: 'package/entry.js', type: 'Link', linkpath: 'package/package.json' }, 'Link'],
        ['a node_modules', { path: 'package/node_modules/@deadair/plugin-sdk/index.js', body: 'x' }, 'node_modules'],
    ] satisfies [string, RawEntry, string][])('refuses %s before anything is written', async (_label, entry, expected) => {
        const { installer, pluginsDir } = await installerIn();

        const { status, message } = await refusal(installer.stage(upload(rawTarball([PACKAGE_JSON, entry]))));

        expect(status).toBe(400);
        expect(message).toContain(expected);
        expect(await staged(pluginsDir)).toEqual([]);
    });

    it('refuses a tarball that declares more than it may unpack to, from the header alone', async () => {
        const { installer } = await installerIn();
        const bytes = rawTarball([PACKAGE_JSON, { path: 'package/dist/huge.bin', size: MAX_PLUGIN_UNPACKED_BYTES + 1 }]);

        expect((await refusal(installer.stage(upload(bytes)))).status).toBe(413);
    });

    it('refuses a file that is not gzip', async () => {
        const { installer } = await installerIn();

        const { status } = await refusal(installer.stage(upload(Buffer.from('PK a zip, say'))));

        expect(status).toBe(415);
    });

    it('refuses a tarball with no package.json in it', async () => {
        const { installer } = await installerIn();

        const { status, message } = await refusal(installer.stage(upload(rawTarball([{ path: 'package/entry.js', body: 'x' }]))));

        expect(status).toBe(400);
        expect(message).toContain('no package/package.json');
    });

    it('refuses an upload with no file in it', async () => {
        const { installer } = await installerIn();
        const empty = { parse: async () => new Map() } as unknown as MultipartBody;

        expect((await refusal(installer.stage(empty))).status).toBe(400);
    });

    it('places an upgrade in a folder of its own and takes the displaced version away', async () => {
        const { installer, pluginsDir } = await installerIn();
        const first = await installer.stage(upload(await packFixture('valid-plugin', '1.0.0')));
        await installer.place(first, []);

        const second = await installer.stage(upload(await packFixture('valid-plugin', '1.1.0')));
        await installer.place(second, await installer.installedDirsNamed(second.packageName));

        expect((await readdir(pluginsDir)).filter(name => !name.startsWith('.'))).toEqual(['test-fixture-valid-plugin-1.1.0']);
        expect(second.restartRequired).toBe(false);
    });

    it('says the same version needs a restart once its code has been loaded, and not before', async () => {
        const { installer, pluginsDir } = await installerIn();
        const first = await installer.stage(upload(await packFixture('valid-plugin', '3.0.0')));
        await installer.place(first, []);

        const beforeLoading = await installer.stage(upload(await packFixture('valid-plugin', '3.0.0')));
        expect(beforeLoading.restartRequired).toBe(false);
        await beforeLoading.discard();

        await new PluginLoader(new PluginLoaderOptions(pluginsDir)).discover();

        const again = await installer.stage(upload(await packFixture('valid-plugin', '3.0.0', { description: 'rebuilt' })));
        expect(again.restartRequired).toBe(true);
        await installer.place(again, await installer.installedDirsNamed(again.packageName));

        const placed = JSON.parse(await readFile(join(again.targetDir, 'package.json'), 'utf8')) as { description?: string };
        expect(placed.description).toBe('rebuilt');
        expect(await staged(pluginsDir)).toEqual([]);
    });
});

describe('PluginInstaller.remove', () => {
    it('deletes a plugin folder inside the plugins directory', async () => {
        const { installer, pluginsDir } = await installerIn();
        const plugin = await installer.stage(upload(await packFixture('valid-plugin')));
        await installer.place(plugin, []);

        await installer.remove(plugin.targetDir);

        await expect(stat(plugin.targetDir)).rejects.toThrow();
        expect(await readdir(pluginsDir)).toEqual(['.staging']);
    });

    it('unlinks a linked-in checkout and leaves the checkout itself alone', async () => {
        const { installer, pluginsDir } = await installerIn();
        const checkout = join(await tempDir('deadair-checkout-'), 'my-plugin');
        await cp(join(FIXTURES_ROOT, 'valid-plugin'), checkout, { recursive: true });
        await mkdir(pluginsDir, { recursive: true });
        await symlink(checkout, join(pluginsDir, 'my-plugin'), 'dir');

        await installer.remove(join(pluginsDir, 'my-plugin'));

        await expect(lstat(join(pluginsDir, 'my-plugin'))).rejects.toThrow();
        expect(await readdir(checkout)).toEqual(['entry.js', 'package.json']);
    });

    it('refuses a folder that is not directly inside the plugins directory', async () => {
        const { installer, pluginsDir } = await installerIn();
        await mkdir(join(pluginsDir, 'a', 'b'), { recursive: true });
        const outside = await tempDir('deadair-outside-');

        expect((await refusal(installer.remove(outside))).status).toBe(409);
        expect((await refusal(installer.remove(join(pluginsDir, 'a', 'b')))).status).toBe(409);
        expect((await refusal(installer.remove(join(pluginsDir, 'node_modules')))).status).toBe(409);
        expect(await readdir(join(pluginsDir, 'a'))).toEqual(['b']);
    });

    it('treats a folder that is already gone as removed', async () => {
        const { installer, pluginsDir } = await installerIn();
        await mkdir(pluginsDir, { recursive: true });

        await expect(installer.remove(join(pluginsDir, 'never-there'))).resolves.toBeUndefined();
    });
});
