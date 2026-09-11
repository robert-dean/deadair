/**
 * Whether the station would load a plugin you built, answered by the station's own loader.
 *
 * It installs the plugin the way an operator does, into a plugins directory of its own, and runs the
 * same two steps boot runs: link the station's SDK and zod beside it, then discover. So the answer is
 * the loader's answer, including every quarantine message an operator would see on the console, and
 * not a second opinion that could disagree with it.
 *
 * Only `package.json` and `dist/` are copied, which is what an installed plugin is. Linking the
 * directory instead would be quicker and would prove nothing: after `npm install` it holds a
 * `node_modules` with its own copy of the SDK, the plugin would load that one, and the station's
 * link would never be exercised.
 *
 * Run from `apps/api`, after building the plugin:
 *   pnpm plugin:prove ../../examples/plugins/apple-music-charts --expect example.apple-music-charts
 *
 * Exits 0 when exactly one plugin was discovered, from the plugins directory, with the expected id
 * (or with any id, when `--expect` is not given), and 1 otherwise, printing why.
 */

import { cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PluginLoader, PluginLoaderOptions } from '../src/modules/plugins/plugin.loader.js';
import { linkPluginPeers } from '../src/modules/plugins/plugin.peers.js';

const { values: options, positionals } = parseArgs({
    // Without the separator pnpm forwards, which would otherwise turn every option after it into a
    // positional and let a wrong `--expect` pass unchecked.
    args: process.argv.slice(2).filter(arg => arg !== '--'),
    allowPositionals: true,
    options: {
        expect: { type: 'string' },
    },
});

const source = positionals[0];
if (source === undefined) {
    console.error('usage: plugin.prove.ts <plugin directory> [--expect <plugin id>]');
    process.exit(2);
}

const pluginDir = resolve(process.cwd(), source);
if (!(await stat(join(pluginDir, 'dist')).catch(() => undefined))?.isDirectory()) {
    console.error(`${pluginDir} has no dist/. Build the plugin first.`);
    process.exit(1);
}

const pluginsDir = await mkdtemp(join(tmpdir(), 'deadair-prove-'));
let failed = true;

try {
    const installed = join(pluginsDir, basename(pluginDir));
    await cp(join(pluginDir, 'package.json'), join(installed, 'package.json'));
    await cp(join(pluginDir, 'dist'), join(installed, 'dist'), { recursive: true });

    const peers = await linkPluginPeers(pluginsDir);
    for (const result of peers.results)
        console.log(`peer   ${result.name}: ${result.outcome}${result.reason === undefined ? '' : ` (${result.reason})`}`);
    if (peers.skipped !== undefined) console.log(`peers  not linked: ${peers.skipped}`);

    const records = await new PluginLoader(new PluginLoaderOptions(pluginsDir)).discover();
    for (const record of records) {
        const version = record.manifest?.version ?? '?';
        console.log(
            `plugin ${record.id} ${version}: ${record.status} (${record.origin})${record.error === undefined ? '' : `\n       ${record.error}`}`,
        );
    }

    const [only] = records;
    if (records.length !== 1 || only === undefined) {
        console.error(`expected one plugin, found ${records.length}. Is "deadair.plugin" set in package.json?`);
    } else if (only.status !== 'discovered') {
        console.error('the station would quarantine it, for the reason above');
    } else if (options.expect !== undefined && only.id !== options.expect) {
        console.error(`loaded, but as "${only.id}" rather than "${options.expect}"`);
    } else {
        console.log(`the station would load ${only.id}`);
        failed = false;
    }
} finally {
    await rm(pluginsDir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
