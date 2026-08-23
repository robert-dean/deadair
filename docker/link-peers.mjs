/**
 * Satisfy the workspace's peer dependencies at its root, for an install with no dev half.
 *
 * Plugins and the SDK declare `zod` and `@deadair/plugin-sdk` as PEERS, and that is deliberate:
 * plugins load into the host's own realm, so they must reach the host's copy of each rather than
 * carry one, or a plugin extending a second copy of the base class is not the class the host
 * checks against. In development the matching devDependency is what actually puts those on disk;
 * `pnpm install --prod` removes it, and every plugin then fails to resolve a package it correctly
 * declared it does not own.
 *
 * The host's copies are linked into the workspace root instead, which is where a shared dependency
 * belongs and where Node looks last when it walks up from a plugin. Two properties make this the
 * right shape rather than a patch: it is DERIVED from the manifests, so a peer added later is
 * covered without anybody remembering this file; and it links rather than installs, so there is
 * still exactly one copy of each on disk and the single-instance rule the peers exist to state
 * stays true.
 *
 * Run from the workspace root. `--dry-run` reports what it would link and writes nothing.
 */
import { readdir, readFile, symlink, mkdir, lstat, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const root = process.cwd();
/** The host: whatever it resolves is the copy every plugin has to end up sharing. */
const host = join(root, 'apps', 'api');
const require = createRequire(join(host, 'package.json'));

/** Every workspace package that could declare a peer. */
const memberDirs = async group => {
    const entries = await readdir(join(root, group), { withFileTypes: true }).catch(() => []);
    return entries.filter(entry => entry.isDirectory()).map(entry => join(root, group, entry.name));
};

const members = [...(await memberDirs('packages')), ...(await memberDirs('plugins'))];

const wanted = new Map();
for (const member of members) {
    const manifest = await readFile(join(member, 'package.json'), 'utf8').catch(() => undefined);
    if (!manifest) continue;
    const { peerDependencies = {}, peerDependenciesMeta = {} } = JSON.parse(manifest);
    for (const name of Object.keys(peerDependencies)) {
        // An optional peer is a capability, not a requirement: the testing helpers want a test
        // runner and a running station does not.
        if (peerDependenciesMeta[name]?.optional) continue;
        wanted.set(name, (wanted.get(name) ?? 0) + 1);
    }
}

for (const [name, count] of [...wanted].sort()) {
    const linkPath = join(root, 'node_modules', name);

    if (await lstat(linkPath).then(() => true, () => false)) {
        console.log(`peers: ${name} is already at the root (wanted by ${count})`);
        continue;
    }

    // Resolved through the host, so what gets linked is the copy the host itself loads.
    let target;
    try {
        target = await realpath(dirname(require.resolve(`${name}/package.json`)));
    } catch {
        // A workspace package has no resolvable entry until it is built, and does not need one:
        // its directory is the thing to link.
        const local = members.find(member => member.endsWith(name.split('/').pop()));
        if (!local) {
            console.error(`peers: cannot find ${name}, wanted by ${count} package(s)`);
            process.exitCode = 1;
            continue;
        }
        target = local;
    }

    console.log(`peers: ${name} -> ${target}${dryRun ? ' (dry run)' : ''}`);
    if (dryRun) continue;

    await mkdir(dirname(linkPath), { recursive: true });
    await symlink(resolve(target), linkPath, 'dir');
}
