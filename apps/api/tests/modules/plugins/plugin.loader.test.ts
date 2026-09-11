import { mkdir, mkdtemp, cp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { PluginLoader, PluginLoaderOptions } from '../../../src/modules/plugins/plugin.loader.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';

const FIXTURES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/plugins');

const tempDirs: string[] = [];

/**
 * Builds a scratch `pluginsDir` containing copies of the named fixtures, in
 * the given order. Copying into index-prefixed subdirectory names pins the
 * load order regardless of the fixtures' own alphabetical names — this is
 * what lets a duplicate-id test control which copy "wins".
 */
async function pluginsDirWith(...fixtureNames: string[]): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'deadair-plugins-test-'));
    tempDirs.push(root);

    for (const [index, name] of fixtureNames.entries()) {
        await cp(join(FIXTURES_ROOT, name), join(root, `${index}-${name}`), { recursive: true });
    }

    return root;
}

/**
 * Copies one fixture into a scratch directory of its own and returns the copy's
 * path, ready to be handed to `PluginLoaderOptions` as a bundled directory.
 * Unlike `pluginsDirWith`, the returned path IS the plugin directory rather
 * than a parent to be scanned.
 */
async function bundledDirWith(fixtureName: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'deadair-bundled-test-'));
    tempDirs.push(root);

    const dir = join(root, fixtureName);
    await cp(join(FIXTURES_ROOT, fixtureName), dir, { recursive: true });

    return dir;
}

/**
 * Writes a plugin directory whose package.json points `deadair.plugin` at a
 * built entry that was never produced — the shape of an unbuilt checkout — and
 * returns the `pluginsDir` containing it.
 */
async function pluginsDirWithUnbuiltPlugin(entry = './dist/index.js'): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'deadair-plugins-test-'));
    tempDirs.push(root);

    const dir = join(root, 'unbuilt-plugin');
    await mkdir(dir, { recursive: true });
    await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'unbuilt-plugin', type: 'module', deadair: { plugin: entry } }, null, 4),
        'utf8',
    );

    return root;
}

async function discoverWith(...fixtureNames: string[]): Promise<PluginRecord[]> {
    const pluginsDir = await pluginsDirWith(...fixtureNames);
    const loader = new PluginLoader(new PluginLoaderOptions(pluginsDir));
    return loader.discover();
}

function recordFor(records: PluginRecord[], id: string): PluginRecord | undefined {
    return records.find(record => record.id === id);
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('PluginLoader.discover', () => {
    it('loads a well-formed plugin as a discovered record with its manifest populated', async () => {
        const records = await discoverWith('valid-plugin');

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ id: 'test.valid', status: 'discovered' });
        expect(records[0]?.manifest?.id).toBe('test.valid');
        expect(records[0]?.error).toBeUndefined();
    });

    it('quarantines a plugin whose manifest fails validation, leaving the valid plugin unharmed', async () => {
        const records = await discoverWith('valid-plugin', 'bad-manifest');

        expect(records).toHaveLength(2);
        expect(recordFor(records, 'test.valid')).toMatchObject({ status: 'discovered' });

        const bad = records.find(record => record.status === 'failed');
        expect(bad).toBeDefined();
        expect(bad?.manifest).toBeUndefined();
        expect(bad?.error).toBeTruthy();
    });

    it('quarantines a plugin whose apiVersion range the host cannot satisfy, leaving the valid plugin unharmed', async () => {
        const records = await discoverWith('valid-plugin', 'wrong-api-version');

        expect(recordFor(records, 'test.valid')).toMatchObject({ status: 'discovered' });

        const incompatible = recordFor(records, 'test.wrong-api-version');
        expect(incompatible).toMatchObject({ status: 'failed' });
        expect(incompatible?.error).toMatch(/apiVersion|plugin API/i);
        expect(incompatible?.manifest).toBeUndefined();
    });

    it('quarantines the second claimant of a duplicate id, leaving the first-loaded plugin unharmed', async () => {
        // valid-plugin is copied first (index 0), so it claims "test.valid";
        // duplicate-id (index 1) is the later claimant and must be quarantined.
        const records = await discoverWith('valid-plugin', 'duplicate-id');

        expect(records).toHaveLength(2);

        const active = records.find(record => record.status === 'discovered');
        const failed = records.find(record => record.status === 'failed');

        expect(active?.manifest?.id).toBe('test.valid');
        expect(failed?.error).toMatch(/duplicate/i);
        expect(failed?.manifest).toBeUndefined();
    });

    it('quarantines a module that throws at import time, leaving the valid plugin unharmed', async () => {
        const records = await discoverWith('valid-plugin', 'throwing-module');

        expect(recordFor(records, 'test.valid')).toMatchObject({ status: 'discovered' });

        const thrown = records.find(record => record.status === 'failed');
        expect(thrown).toBeDefined();
        expect(thrown?.error).toBeTruthy();
        expect(thrown?.manifest).toBeUndefined();
    });

    it('quarantines a plugin whose declared entry was never built, naming the entry and the fix', async () => {
        const pluginsDir = await pluginsDirWithUnbuiltPlugin();
        const loader = new PluginLoader(new PluginLoaderOptions(pluginsDir));

        const records = await loader.discover();

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ status: 'failed' });
        expect(records[0]?.error).toContain('has not been built');
        expect(records[0]?.error).toContain('./dist/index.js');
        expect(records[0]?.manifest).toBeUndefined();
    });

    it('skips a directory with no "deadair.plugin" field entirely', async () => {
        const records = await discoverWith('valid-plugin', 'not-a-plugin');

        expect(records).toHaveLength(1);
        expect(records[0]?.id).toBe('test.valid');
    });

    it('never rejects: every quarantine case in the same sweep resolves alongside the valid plugin', async () => {
        const records = await discoverWith('valid-plugin', 'bad-manifest', 'wrong-api-version', 'duplicate-id', 'throwing-module', 'not-a-plugin');

        // not-a-plugin contributes no record; the other five all do.
        expect(records).toHaveLength(5);
        expect(recordFor(records, 'test.valid')).toMatchObject({ status: 'discovered' });
        expect(records.filter(record => record.status === 'failed')).toHaveLength(4);
    });

    it('discovers bundled directories supplied through options, ahead of the pluginsDir entries', async () => {
        // The bundled copy and the pluginsDir copy claim the same id, so load
        // order is observable: whichever comes first keeps "test.valid" and the
        // other is quarantined as the duplicate.
        const bundledDir = await bundledDirWith('valid-plugin');
        const pluginsDir = await pluginsDirWith('duplicate-id');
        const loader = new PluginLoader(new PluginLoaderOptions(pluginsDir, [bundledDir]));

        const records = await loader.discover();

        expect(records).toHaveLength(2);
        expect(records[0]).toMatchObject({ id: 'test.valid', dir: bundledDir, origin: 'bundled', status: 'discovered' });
        expect(records[1]).toMatchObject({ status: 'failed' });
        expect(records[1]?.error).toMatch(/duplicate/i);
    });

    it('marks what it found under pluginsDir as installed, quarantined candidates included', async () => {
        const records = await discoverWith('valid-plugin', 'bad-manifest');

        expect(recordFor(records, 'test.valid')).toMatchObject({ origin: 'installed', status: 'discovered' });
        expect(records.find(record => record.status === 'failed')).toMatchObject({ origin: 'installed' });
    });

    it('never treats the node_modules the station keeps in pluginsDir as a plugin', async () => {
        const pluginsDir = await pluginsDirWith('valid-plugin');
        // A package.json carrying the plugin field, so only the name keeps it out.
        await cp(join(FIXTURES_ROOT, 'valid-plugin'), join(pluginsDir, 'node_modules'), { recursive: true });

        const records = await new PluginLoader(new PluginLoaderOptions(pluginsDir)).discover();

        expect(records.map(record => record.dir)).toEqual([join(pluginsDir, '0-valid-plugin')]);
    });

    it('resolves with only the bundled results when pluginsDir does not exist', async () => {
        const missingDir = join(await pluginsDirWith(), 'does-not-exist');
        const loader = new PluginLoader(new PluginLoaderOptions(missingDir));

        await expect(loader.discover()).resolves.toEqual([]);
    });
});
