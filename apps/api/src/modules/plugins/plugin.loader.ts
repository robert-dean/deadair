import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Injectable } from 'injectkit';
import { satisfies, validRange } from 'semver';
import { PLUGIN_API_VERSION, pluginManifestSchema, type DeadairPlugin, type PluginManifest } from '@deadair/plugin-sdk';
import type { PluginRecord } from './types/plugin.record.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * Where the loader looks for plugins: the directories shipped with the host
 * (`bundledDirs`) and the operator-installed mount point (`pluginsDir`).
 *
 * Both arrive by constructor injection so the module can wire the
 * `PLUGINS_DIR` env and the bundled list without the loader ever touching
 * `AppConfig` or a module-level constant. `bundledDirs` defaults to empty so a
 * caller that constructs a loader directly (a test, a one-off scan) sees
 * exactly the directory it asked for and nothing else.
 */
@Injectable()
export class PluginLoaderOptions {
    constructor(
        readonly pluginsDir: string,
        readonly bundledDirs: string[] = [],
    ) {}
}

/** The `deadair` block a plugin package.json must carry to be a candidate. */
interface PluginPackageJson {
    deadair?: {
        plugin?: unknown;
    };
}

/** Whether `path` resolves to an existing regular file. */
async function fileExists(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isFile();
    } catch {
        return false;
    }
}

/**
 * Discovers plugin candidates on disk and turns each one into a
 * {@link PluginRecord}.
 *
 * Discovery is untrusted-input handling: a plugin directory is arbitrary
 * third-party code that may not parse, may throw at import time, or may lie
 * about its manifest. Every one of those outcomes becomes a quarantined
 * record with error text, never an exception, so a single bad plugin can
 * never take the server's boot down with it.
 *
 * This is the only place in the host that imports plugin code.
 */
@Injectable()
export class PluginLoader {
    constructor(private readonly options: PluginLoaderOptions) {}

    /**
     * Scans the bundled list plus the mounted plugins directory and returns one
     * record per candidate, in that order. Directories that are not plugins at
     * all are skipped silently; broken plugins come back as `failed` records.
     *
     * Never rejects.
     */
    async discover(): Promise<PluginRecord[]> {
        const dirs = [...this.options.bundledDirs.map(dir => resolve(dir)), ...(await this.scanPluginsDir())];

        const records: PluginRecord[] = [];
        const seenDirs = new Set<string>();
        const seenIds = new Set<string>();

        for (const dir of dirs) {
            if (seenDirs.has(dir)) continue;
            seenDirs.add(dir);

            const record = await this.loadCandidate(dir, seenIds);
            if (record) records.push(record);
        }

        return records;
    }

    /**
     * Subdirectories of `pluginsDir`, absolute and sorted for a stable load
     * order. A missing or unreadable plugins directory is normal (nothing has
     * been installed yet), so it yields an empty list rather than an error.
     */
    private async scanPluginsDir(): Promise<string[]> {
        const root = resolve(this.options.pluginsDir);

        let entries;
        try {
            entries = await readdir(root, { withFileTypes: true });
        } catch {
            return [];
        }

        const dirs: string[] = [];
        for (const entry of entries) {
            const full = resolve(root, entry.name);
            if (entry.isDirectory()) {
                dirs.push(full);
                continue;
            }
            // Symlinked plugin directories are the natural way to develop a
            // plugin against a running server, so follow them.
            if (entry.isSymbolicLink()) {
                try {
                    if ((await stat(full)).isDirectory()) dirs.push(full);
                } catch {
                    // Dangling symlink: not a plugin, nothing to report.
                }
            }
        }

        return dirs.sort();
    }

    /**
     * Turns one directory into a record, or `undefined` when the directory is
     * not a plugin at all.
     *
     * `seenIds` is mutated: the first plugin to claim an id keeps it, and every
     * later claimant is quarantined.
     */
    private async loadCandidate(dir: string, seenIds: Set<string>): Promise<PluginRecord | undefined> {
        let entry: string;
        let entryPath: string;
        try {
            const declared = await this.readEntryPath(dir);
            if (declared === undefined) return undefined;
            entry = declared;
            entryPath = resolve(dir, declared);
        } catch (error) {
            return this.quarantine(dir, `unreadable package.json: ${errorText(error)}`);
        }

        // A plugin that declares a built entry it never shipped is the single
        // most common operator mistake (an unbuilt checkout). Naming the entry
        // and the fix beats surfacing a raw ERR_MODULE_NOT_FOUND stack.
        if (!(await fileExists(entryPath))) {
            return this.quarantine(dir, `entry "${entry}" does not exist; the plugin has not been built (run pnpm build)`);
        }

        let module: unknown;
        try {
            module = await import(pathToFileURL(entryPath).href);
        } catch (error) {
            return this.quarantine(dir, `failed to import entry "${entryPath}": ${errorText(error)}`);
        }

        const exported = (module as { default?: unknown }).default;
        if (typeof exported !== 'object' || exported === null) {
            return this.quarantine(dir, 'entry has no default export; a plugin must default-export definePlugin(manifest, factory)');
        }

        const { manifest, factory } = exported as Partial<DeadairPlugin>;
        if (typeof factory !== 'function') {
            return this.quarantine(dir, 'default export has no factory function');
        }

        const parsed = pluginManifestSchema.safeParse(manifest);
        if (!parsed.success) {
            const issues = parsed.error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
            return this.quarantine(dir, `invalid manifest: ${issues}`);
        }
        const validated = parsed.data as PluginManifest;

        if (!validRange(validated.apiVersion)) {
            return this.quarantine(dir, `manifest apiVersion "${validated.apiVersion}" is not a valid semver range`, validated.id);
        }
        if (!satisfies(PLUGIN_API_VERSION, validated.apiVersion)) {
            return this.quarantine(
                dir,
                `plugin requires plugin API "${validated.apiVersion}" but this host implements ${PLUGIN_API_VERSION}`,
                validated.id,
            );
        }

        if (seenIds.has(validated.id)) {
            return this.quarantine(dir, `duplicate plugin id "${validated.id}"; the copy loaded first wins`, validated.id);
        }
        seenIds.add(validated.id);

        return { id: validated.id, manifest: validated, dir, status: 'discovered' };
    }

    /**
     * The plugin entry path declared by a directory's package.json, or
     * `undefined` when this is not a plugin directory. Throws only when the
     * package.json exists but cannot be read or parsed.
     */
    private async readEntryPath(dir: string): Promise<string | undefined> {
        let raw: string;
        try {
            raw = await readFile(resolve(dir, 'package.json'), 'utf8');
        } catch {
            // No package.json at all: an ordinary directory, not a failed plugin.
            return undefined;
        }

        const parsed = JSON.parse(raw) as PluginPackageJson;
        const entry = parsed.deadair?.plugin;
        if (entry === undefined) return undefined;
        if (typeof entry !== 'string' || entry.length === 0) {
            throw new Error('"deadair.plugin" must be a non-empty relative path to the plugin entry');
        }
        return entry;
    }

    /** A `failed` record: error text, no manifest, no instance. */
    private quarantine(dir: string, error: string, id?: string): PluginRecord {
        return { id: id ?? basename(dir), dir, status: 'failed', error };
    }
}
