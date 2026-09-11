import { lstat, mkdir, readFile, realpath, stat, symlink, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { Injectable } from 'injectkit';
import { PluginLoaderOptions } from './plugin.loader.js';
import { PluginLog } from './plugin.log.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * The host's own copies of the SDK and its peers, made resolvable from the plugins directory.
 *
 * A plugin declares `@deadair/plugin-sdk` and `zod` as PEERS because it loads into the host's realm
 * and must reach the host's copy of each rather than carry one: a plugin extending a second copy of
 * `Plugin`, or throwing a second copy of `PluginError`, is not the class the host checks against.
 * For a bundled plugin that is `docker/link-peers.mjs`'s job, and it works because every bundled
 * plugin lives under `/app` and Node's walk up from it reaches `/app/node_modules`.
 *
 * An installed plugin does not live under `/app`. Walking up from `/data/plugins/foo/dist/index.js`
 * visits `/data/plugins/foo/node_modules`, `/data/plugins/node_modules`, `/data/node_modules` and
 * `/node_modules`, and never the station's own tree, so its first `import '@deadair/plugin-sdk'`
 * failed with `ERR_MODULE_NOT_FOUND` and the plugin was quarantined for a package it correctly
 * declared it does not own. So the host puts a symlink to its own copy of each in
 * `<PLUGINS_DIR>/node_modules`, which is the second directory that walk visits, before every
 * discovery and every rescan.
 *
 * Two properties make this the right shape rather than a patch, and they are `link-peers.mjs`'s:
 * the list is DERIVED (the SDK plus the SDK's own non-optional peers), so a peer added later is
 * covered without anybody remembering this file; and it links rather than installs, so there is still
 * one copy of each on disk. Node keys its module cache on the real path, so a plugin reaching the SDK
 * through the link is handed the very instance the host loaded.
 *
 * Nothing here may cost the station its boot. A plugins directory that does not exist is normal (no
 * plugin has been installed) and is left uncreated; one that cannot be written is reported and
 * skipped, and every installed plugin that relied on the link is then quarantined with the import
 * error, which names the package it could not find.
 */

/** The package every plugin is written against. Its non-optional peers are linked beside it. */
export const PLUGIN_SDK_PACKAGE = '@deadair/plugin-sdk';

/** A package the host makes resolvable from the plugins directory. */
export interface PluginPeer {
    name: string;
    /** Real path of the host's copy of the package: the directory holding its `package.json`. */
    dir: string;
}

/**
 * What became of one link.
 *
 * - `linked`: there was nothing there, and now there is a link.
 * - `relinked`: a link pointed somewhere else, which is what an image upgrade looks like, since the
 *   store path of a dependency moves with its version.
 * - `unchanged`: the link already pointed at the host's copy.
 * - `kept`: something that is not a link is in the way. It is somebody's, so it is never deleted.
 * - `skipped`: the link could not be written.
 */
export type PeerLinkOutcome = 'linked' | 'relinked' | 'unchanged' | 'kept' | 'skipped';

export interface PeerLinkResult {
    name: string;
    target: string;
    linkPath: string;
    outcome: PeerLinkOutcome;
    /** Why a link was `kept` or `skipped`. */
    reason?: string;
}

export interface PeerLinkReport {
    pluginsDir: string;
    results: PeerLinkResult[];
    /** Set when nothing was attempted at all: the directory is absent, is not a directory, or the peers could not be resolved. */
    skipped?: string;
}

interface PeerPackageJson {
    name?: string;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

async function readPackageJson(dir: string): Promise<PeerPackageJson | undefined> {
    try {
        return JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as PeerPackageJson;
    } catch {
        return undefined;
    }
}

/**
 * The directory of package `name`, as the module system resolves it from `from`.
 *
 * Resolves the package's ENTRY and walks up to the `package.json` carrying its name, rather than
 * resolving `<name>/package.json`, because a package with an `exports` map only answers the subpaths
 * it lists and the SDK does not list that one. The real path is taken first so a pnpm symlink and the
 * package it points at are one directory, not two.
 */
async function packageDirOf(name: string, from: string): Promise<string> {
    const entry = await realpath(createRequire(from).resolve(name));
    let current = dirname(entry);
    for (;;) {
        if ((await readPackageJson(current))?.name === name) return current;
        const parent = dirname(current);
        if (parent === current) throw new Error(`resolved ${name} to ${entry}, but no package.json above it names ${name}`);
        current = parent;
    }
}

/**
 * The SDK plus its non-optional peers, resolved the way the host resolves them.
 *
 * The SDK is resolved from the host (`resolveFrom`, this module by default), and each of its peers
 * from the SDK's own directory, because that is the copy the SDK's code actually loads: the manifest
 * schema that validates a plugin is the SDK's, built on the SDK's zod. An optional peer is a
 * capability rather than a requirement (the testing helpers want a test runner; a running station
 * does not), so it is left out, which is `link-peers.mjs`'s rule.
 *
 * Throws when the SDK cannot be resolved at all, which is a broken install rather than a state to
 * degrade through. {@link linkPluginPeers} turns that into a skipped report.
 */
export async function resolvePluginPeers(resolveFrom: string = import.meta.url): Promise<PluginPeer[]> {
    const sdkDir = await packageDirOf(PLUGIN_SDK_PACKAGE, resolveFrom);
    const manifest = (await readPackageJson(sdkDir)) ?? {};
    const optional = manifest.peerDependenciesMeta ?? {};
    const fromSdk = join(sdkDir, 'package.json');

    const peers: PluginPeer[] = [{ name: PLUGIN_SDK_PACKAGE, dir: sdkDir }];
    for (const name of Object.keys(manifest.peerDependencies ?? {}).sort()) {
        if (optional[name]?.optional) continue;
        peers.push({ name, dir: await packageDirOf(name, fromSdk) });
    }
    return peers;
}

/** Whether `path` exists at all, without following a link. */
async function lstatOrUndefined(path: string) {
    try {
        return await lstat(path);
    } catch {
        return undefined;
    }
}

async function linkOne(pluginsDir: string, peer: PluginPeer): Promise<PeerLinkResult> {
    const linkPath = join(pluginsDir, 'node_modules', ...peer.name.split('/'));
    const result = (outcome: PeerLinkOutcome, reason?: string): PeerLinkResult => ({
        name: peer.name,
        target: peer.dir,
        linkPath,
        outcome,
        ...(reason === undefined ? {} : { reason }),
    });

    try {
        const existing = await lstatOrUndefined(linkPath);
        if (existing && !existing.isSymbolicLink()) {
            return result('kept', `${linkPath} is not a link the station made, so it was left alone`);
        }

        if (existing) {
            // A dangling link has no real path, and is exactly as stale as one pointing elsewhere.
            const current = await realpath(linkPath).catch(() => undefined);
            if (current === peer.dir) return result('unchanged');
            await unlink(linkPath);
            await symlink(peer.dir, linkPath, 'dir');
            return result('relinked');
        }

        await mkdir(dirname(linkPath), { recursive: true });
        await symlink(peer.dir, linkPath, 'dir');
        return result('linked');
    } catch (error) {
        return result('skipped', errorText(error));
    }
}

/**
 * Ensures `<pluginsDir>/node_modules/<name>` is a link to the host's copy of each peer.
 *
 * Never rejects: every failure is a `skipped` outcome carrying the reason, because the station boots
 * whatever state its plugins directory is in. A missing `pluginsDir` is not created, since the image
 * creates it with the right owner and a dev checkout creates it by hand, and inventing one here would
 * be a directory the operator never asked for; the next rescan links it once it exists.
 */
export async function linkPluginPeers(pluginsDir: string, peers?: PluginPeer[]): Promise<PeerLinkReport> {
    const root = resolve(pluginsDir);

    const info = await stat(root).catch(() => undefined);
    if (!info) return { pluginsDir: root, results: [], skipped: 'the plugins directory does not exist' };
    if (!info.isDirectory()) return { pluginsDir: root, results: [], skipped: 'the plugins directory is not a directory' };

    let resolved: PluginPeer[];
    try {
        resolved = peers ?? (await resolvePluginPeers());
    } catch (error) {
        return { pluginsDir: root, results: [], skipped: `the station could not find its own ${PLUGIN_SDK_PACKAGE}: ${errorText(error)}` };
    }

    const results: PeerLinkResult[] = [];
    for (const peer of resolved) results.push(await linkOne(root, peer));
    return { pluginsDir: root, results };
}

/**
 * {@link linkPluginPeers} for the plugins directory the loader scans, with the outcome logged.
 *
 * Called by `PluginLifecycleManager` ahead of every discovery and rescan, so a directory an operator
 * created after boot, or an image upgrade that moved a store path, is put right by pressing Rescan.
 */
@Injectable()
export class PluginPeerLinker {
    constructor(
        private readonly options: PluginLoaderOptions,
        private readonly pluginLog: PluginLog,
    ) {}

    /** Links, logs, and returns the report. Never rejects. */
    async link(): Promise<PeerLinkReport> {
        const report = await linkPluginPeers(this.options.pluginsDir);

        if (report.skipped !== undefined) {
            // Absent is the ordinary state of a station nobody has installed a plugin on.
            this.pluginLog.debug('plugin peers not linked', { pluginsDir: report.pluginsDir, reason: report.skipped });
            return report;
        }

        for (const result of report.results) {
            const meta = { pluginsDir: report.pluginsDir, peer: result.name, target: result.target };
            if (result.outcome === 'linked' || result.outcome === 'relinked') {
                this.pluginLog.info(`plugin peer ${result.outcome}`, meta);
            } else if (result.outcome === 'unchanged') {
                this.pluginLog.debug('plugin peer unchanged', meta);
            } else {
                this.pluginLog.warn(
                    `installed plugins cannot resolve ${result.name} from ${report.pluginsDir}; make the directory writable by the station, or bundle it into the plugin`,
                    { ...meta, reason: result.reason },
                );
            }
        }
        return report;
    }
}
