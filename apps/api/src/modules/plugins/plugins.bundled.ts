import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walks up from this module until it finds the workspace root (the directory
 * holding `pnpm-workspace.yaml`). Resolving relative to `import.meta.url` with
 * a fixed number of `..` segments breaks between `src/` (dev, via swc-node)
 * and `dist/` (build), which sit at different depths; the marker file does not
 * move. Falls back to the process working directory if the marker is missing.
 */
function findRepoRoot(): string {
    let current = dirname(fileURLToPath(import.meta.url));
    for (;;) {
        if (existsSync(resolve(current, 'pnpm-workspace.yaml'))) return current;
        const parent = dirname(current);
        if (parent === current) return process.cwd();
        current = parent;
    }
}

const repoRoot = findRepoRoot();

/** Absolute path of a first-party plugin directory, given its repo-relative path. */
export function resolveBundledPluginDir(repoRelativePath: string): string {
    return resolve(repoRoot, repoRelativePath);
}

/**
 * First-party plugins that ship inside the repo. These are loaded alongside
 * whatever the operator has dropped into the mounted plugins directory, and
 * follow exactly the same rules: a `package.json` carrying
 * `"deadair": { "plugin": "<entry>" }`, a valid manifest, a compatible
 * `apiVersion` range. Being bundled buys no leniency.
 */
export const bundledPluginDirs: string[] = [
    resolveBundledPluginDir('plugins/spotify'),
    resolveBundledPluginDir('plugins/musicbrainz'),
    resolveBundledPluginDir('plugins/kokoro'),
    resolveBundledPluginDir('plugins/llm'),
    resolveBundledPluginDir('plugins/analyzer'),
];
