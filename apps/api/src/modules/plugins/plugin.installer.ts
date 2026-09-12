import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import type { MultipartBody } from '@maroonedsoftware/multipart';
import { Parser, extract, type ReadEntry } from 'tar';
import { PluginLoader, PluginLoaderOptions, hasImportedPluginEntry } from './plugin.loader.js';
import { PluginLog } from './plugin.log.js';
import { PluginPeerLinker } from './plugin.peers.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * The most an imported plugin's tarball may weigh, as it arrives.
 *
 * Deliberately above `@maroonedsoftware/multipart`'s own 20 MB default, for the reason `MAX_PAD_BYTES`
 * is: the example plugin packs to a few kilobytes, but a plugin that bundles a tokenizer or a model
 * runtime into its `dist/` is tens of megabytes, and refusing that would refuse a legitimate plugin.
 * And deliberately not a `deadair.settings` row, because a ceiling an operator can raise from the
 * console is a ceiling that stops meaning anything. The parser answers 413 on it by itself.
 */
export const MAX_PLUGIN_ARCHIVE_BYTES = 64 * 1024 * 1024;

/**
 * The most a tarball may inflate to, counted as the decompressed stream goes by.
 *
 * gzip expands by up to about a thousand to one, so the archive ceiling alone would let 64 MB of
 * upload write tens of gigabytes into the data volume. Four times the archive ceiling admits any
 * honest plugin (compiled JavaScript compresses three to five times) and refuses a bomb while it is
 * still being READ, before extraction writes a byte of it. This is counted by the station rather than
 * left to tar's own decompression-ratio guard, because a ratio bounds nothing absolutely.
 */
export const MAX_PLUGIN_UNPACKED_BYTES = 4 * MAX_PLUGIN_ARCHIVE_BYTES;

/** The most entries a plugin's tarball may hold. A built plugin is a handful of files. */
export const MAX_PLUGIN_ENTRIES = 10_000;

/**
 * Where an import is put while it is checked, inside the plugins directory.
 *
 * INSIDE it rather than under the system temp directory for two reasons. Moving the checked plugin
 * into place is then a `rename` on one filesystem rather than a copy across two. And the station's own
 * loader can validate it there: Node's walk up from `<PLUGINS_DIR>/.staging/<id>/plugin/dist` reaches
 * `<PLUGINS_DIR>/node_modules`, where `PluginPeerLinker` keeps the SDK and zod, so the staged plugin
 * resolves them exactly as it will once installed. The loader skips every dot-prefixed entry, which
 * is what keeps a rescan landing mid-import from seeing half a plugin.
 */
export const PLUGIN_STAGING_DIR = '.staging';

/** The prefix `npm pack` writes every entry under. */
const PACKAGE_PREFIX = 'package';

/** Entry types a plugin tarball may carry. Every link and every device node is refused. */
const PLAIN_ENTRY_TYPES = new Set(['File', 'OldFile', 'Directory']);

/**
 * A plugin unpacked and checked by the station's own loader, not yet moved into place.
 *
 * `discard()` takes the staging directory away and is safe to call more than once, which is what
 * lets a caller put it in a `catch` without knowing whether `place` got that far.
 */
export interface StagedPlugin {
    /** The manifest's id, which is the plugin's identity: its settings are kept under it. */
    id: string;
    /** The manifest's human name. */
    name: string;
    /** `package.json`'s `name`, which is what an older copy of the same package is found by. */
    packageName: string;
    /** `package.json`'s `version`. */
    version: string;
    /** Where it will live: `<PLUGINS_DIR>/<name>-<version>`. */
    targetDir: string;
    /**
     * Whether the code at `targetDir` has already been imported into this process, so that placing
     * this one there changes nothing until the station restarts. True only when the same name and
     * version were imported before and loaded.
     */
    restartRequired: boolean;
    /** The unpacked plugin, under the staging directory. */
    stagedDir: string;
    discard(): Promise<void>;
}

/** What a tar entry check found wrong, with the status it is answered with. */
class ArchiveRefusal extends Error {
    constructor(
        readonly status: 400 | 413,
        message: string,
    ) {
        super(message);
    }
}

/** The running totals one pass over a tarball keeps. */
interface ArchiveTally {
    entries: number;
    bytes: number;
    sawPackageJson: boolean;
}

/** A path segment as it may appear in a directory name: `@scope/pkg` becomes `scope-pkg`. */
function safeSegment(value: string): string {
    return value
        .replace(/^@/, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^[-.]+/, '')
        .slice(0, 100);
}

/** The folder a package lands in. A version in the name is why an upgrade needs no restart. */
export function pluginDirName(packageName: string, version: string): string | undefined {
    const name = safeSegment(packageName);
    const release = safeSegment(version);
    if (name === '' || release === '') return undefined;
    return `${name}-${release}`;
}

/**
 * Checks one entry against the rules for a plugin tarball and adds it to the tally. Throws an
 * {@link ArchiveRefusal} naming the entry.
 *
 * Refused by KIND rather than allowed by name, because `npm pack` always adds a README and a licence
 * beside whatever `files` names, and a rule that only admitted `package.json` and `dist/` would refuse
 * every real tarball. What is refused is what could hurt: a link (it can point anywhere the station can
 * write), a device node, a path that climbs out of the folder, and a `node_modules`, which would carry
 * a second copy of the SDK that the plugin would then load instead of the station's.
 */
function checkEntry(entry: Pick<ReadEntry, 'path' | 'type' | 'size'>, tally: ArchiveTally): void {
    const path = entry.path;

    if (!PLAIN_ENTRY_TYPES.has(entry.type)) {
        throw new ArchiveRefusal(400, `"${path}" is a ${entry.type} entry; a plugin tarball holds files and directories only`);
    }

    const segments = path.split('/').filter(segment => segment !== '');
    if (path.startsWith('/') || path.includes('\\') || segments[0] !== PACKAGE_PREFIX) {
        throw new ArchiveRefusal(400, `"${path}" is not under package/, where npm pack puts everything`);
    }
    if (segments.some(segment => segment === '..' || segment === '.')) {
        throw new ArchiveRefusal(400, `"${path}" climbs out of the package folder`);
    }
    if (segments.includes('node_modules')) {
        throw new ArchiveRefusal(400, `"${path}" is inside a node_modules; a plugin ships none, because the station lends it the SDK`);
    }

    tally.entries += 1;
    tally.bytes += entry.size;
    if (tally.entries > MAX_PLUGIN_ENTRIES) {
        throw new ArchiveRefusal(413, `the tarball holds more than ${MAX_PLUGIN_ENTRIES} entries`);
    }
    if (tally.bytes > MAX_PLUGIN_UNPACKED_BYTES) {
        throw new ArchiveRefusal(413, `the tarball unpacks to more than ${MAX_PLUGIN_UNPACKED_BYTES / (1024 * 1024)} MB`);
    }

    if (segments.length === 2 && segments[1] === 'package.json' && entry.type !== 'Directory') tally.sawPackageJson = true;
}

/**
 * Reads every entry header in a gzip tarball without writing anything, checking each one.
 *
 * Decompressed by hand and counted rather than handed to `tar.list`, so that a bomb is stopped at
 * {@link MAX_PLUGIN_UNPACKED_BYTES} of inflated stream rather than inflated in full to discover that
 * it was one. Every refusal is thrown from here, before extraction starts.
 */
function inspectArchive(archive: string): Promise<ArchiveTally> {
    const tally: ArchiveTally = { entries: 0, bytes: 0, sawPackageJson: false };

    return new Promise((resolvePromise, rejectPromise) => {
        let settled = false;
        let inflated = 0;
        const source = createReadStream(archive);
        const gunzip = createGunzip();

        const fail = (error: unknown): void => {
            if (settled) return;
            settled = true;
            source.destroy();
            gunzip.destroy();
            rejectPromise(error);
        };

        const parser = new Parser({
            strict: true,
            onReadEntry: entry => {
                try {
                    checkEntry(entry, tally);
                } catch (error) {
                    fail(error);
                }
                entry.resume();
            },
        });
        parser.on('error', (error: unknown) => fail(new ArchiveRefusal(400, `that file could not be read as a tarball: ${errorText(error)}`)));
        parser.on('end', () => {
            if (settled) return;
            settled = true;
            resolvePromise(tally);
        });

        source.on('error', fail);
        gunzip.on('error', error => fail(new ArchiveRefusal(400, `that file could not be decompressed: ${errorText(error)}`)));
        gunzip.on('data', (chunk: Buffer) => {
            if (settled) return;
            inflated += chunk.length;
            if (inflated > MAX_PLUGIN_UNPACKED_BYTES) {
                fail(new ArchiveRefusal(413, `the tarball unpacks to more than ${MAX_PLUGIN_UNPACKED_BYTES / (1024 * 1024)} MB`));
                return;
            }
            if (!parser.write(chunk)) {
                gunzip.pause();
                parser.once('drain', () => gunzip.resume());
            }
        });
        gunzip.on('end', () => {
            if (!settled) parser.end();
        });

        source.pipe(gunzip);
    });
}

/** Whether a file starts with gzip's magic number. */
async function isGzip(path: string): Promise<boolean> {
    const handle = await open(path, 'r');
    try {
        const head = Buffer.alloc(2);
        const { bytesRead } = await handle.read(head, 0, 2, 0);
        return bytesRead === 2 && head[0] === 0x1f && head[1] === 0x8b;
    } finally {
        await handle.close();
    }
}

/** What `package.json` must say for the station to install it, or a 400 naming what is missing. */
async function readPackage(dir: string): Promise<{ name: string; version: string; entry: string }> {
    let parsed: { name?: unknown; version?: unknown; deadair?: { plugin?: unknown } };
    try {
        parsed = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as typeof parsed;
    } catch (error) {
        throw httpError(400).withDetails({ message: `package.json could not be read: ${errorText(error)}` });
    }

    const { name, version } = parsed;
    const entry = parsed.deadair?.plugin;
    if (typeof name !== 'string' || name === '') throw httpError(400).withDetails({ message: 'package.json has no "name"' });
    if (typeof version !== 'string' || version === '') throw httpError(400).withDetails({ message: 'package.json has no "version"' });
    if (typeof entry !== 'string' || entry === '') {
        throw httpError(400).withDetails({
            message: `${name} is not a deadair plugin: its package.json does not name an entry under "deadair.plugin"`,
        });
    }
    return { name, version, entry };
}

async function lstatOrUndefined(path: string) {
    try {
        return await lstat(path);
    } catch {
        return undefined;
    }
}

/**
 * Puts a plugin the operator hands over into the plugins directory, and takes one out again.
 *
 * Disk only. It never imports plugin code except through the station's own loader, which it points
 * at the staged copy so that a plugin the station would quarantine is refused with the loader's own
 * sentence rather than a second opinion that could disagree with it. Registering, disposing and
 * initializing are the lifecycle manager's, and the service that calls this is what sequences them.
 *
 * Nothing here makes a plugin safer to run. A plugin is trusted code (`packages/plugin-sdk/CLAUDE.md`
 * § "Trust and egress"): validating it IMPORTS its entry, exactly as a rescan does, because a manifest
 * holds a live zod schema and cannot be read without running the module that builds it. What these
 * checks answer is a tarball that would write outside its folder, or fill the disk, or shadow the
 * station's SDK: accidents of packaging, not a plugin's intent.
 */
@Injectable()
export class PluginInstaller {
    /** Serializes every change this makes to the plugins directory. */
    private queue: Promise<unknown> = Promise.resolve();

    /** Whether this process has cleared what an earlier one left under the staging directory. */
    private swept = false;

    constructor(
        private readonly options: PluginLoaderOptions,
        private readonly pluginPeerLinker: PluginPeerLinker,
        private readonly pluginLog: PluginLog,
    ) {}

    /** The plugins directory, resolved. */
    get pluginsDir(): string {
        return resolve(this.options.pluginsDir);
    }

    /**
     * Runs `work` with no other import or removal in flight. Two imports of the same plugin racing
     * each other through `place` would each move the other's folder, so every caller that changes the
     * directory goes through here.
     */
    exclusive<T>(work: () => Promise<T>): Promise<T> {
        const next = this.queue.then(work, work);
        this.queue = next.catch(() => undefined);
        return next;
    }

    /**
     * Receives an upload, checks it, unpacks it under the staging directory and has the station's own
     * loader load it there.
     *
     * @throws 400 no file, not a tarball npm pack wrote, an entry that is refused, a package.json that
     *   is not a plugin's. 413 over a ceiling. 415 not gzip. 422 the loader quarantined it, with the
     *   loader's reason.
     */
    async stage(multipart: MultipartBody): Promise<StagedPlugin> {
        const root = this.pluginsDir;

        // The one caller allowed to create the plugins directory. `PluginPeerLinker` deliberately
        // never does, because inventing a directory nobody asked for is wrong at boot; here an operator
        // has just asked for something to be put there. The links are made now rather than left to
        // the next rescan, because the loader below needs them to resolve the staged plugin's SDK.
        await mkdir(root, { recursive: true });
        await this.pluginPeerLinker.link();
        await this.sweepOnce(root);

        const stagingRoot = join(root, PLUGIN_STAGING_DIR, randomUUID());
        const archive = join(stagingRoot, 'archive.tgz');
        const stagedDir = join(stagingRoot, 'plugin');
        await mkdir(stagedDir, { recursive: true });

        let discarded = false;
        const discard = async (): Promise<void> => {
            if (discarded) return;
            discarded = true;
            await rm(stagingRoot, { recursive: true, force: true });
        };

        try {
            await this.receive(multipart, archive);

            if (!(await isGzip(archive))) {
                throw httpError(415).withDetails({
                    message: 'the station imports the gzip tarball npm pack writes (a .tgz), and that file is not one',
                });
            }

            const tally = await this.inspect(archive);
            if (!tally.sawPackageJson)
                throw httpError(400).withDetails({ message: 'the tarball has no package/package.json, so npm pack did not write it' });

            await this.unpack(archive, stagedDir);
            const pkg = await readPackage(stagedDir);

            const dirName = pluginDirName(pkg.name, pkg.version);
            if (dirName === undefined) {
                throw httpError(400).withDetails({ message: `"${pkg.name}" ${pkg.version} leaves nothing to name a folder after` });
            }
            const targetDir = join(root, dirName);

            const records = await new PluginLoader(new PluginLoaderOptions(stagingRoot)).discover();
            const record = records[0];
            if (record === undefined) {
                throw httpError(400).withDetails({ message: `${pkg.name} is not a deadair plugin: the station found no plugin in it` });
            }
            if (record.status === 'failed' || record.manifest === undefined) {
                // The loader's own sentence, with the staging path it had to name taken back out: that
                // folder is gone by the time anybody reads this, and `dist/index.js` is what they fix.
                const reason = (record.error ?? 'the station could not load it').split(stagedDir + sep).join('');
                throw httpError(422).withDetails({ message: `${pkg.name} ${pkg.version} did not load: ${reason}` });
            }

            return {
                id: record.id,
                name: record.manifest.name,
                packageName: pkg.name,
                version: pkg.version,
                targetDir,
                restartRequired: hasImportedPluginEntry(resolve(targetDir, pkg.entry)),
                stagedDir,
                discard,
            };
        } catch (error) {
            await discard();
            throw error;
        }
    }

    /**
     * Every folder in the plugins directory whose package.json names `packageName`, which is how an
     * older version of the same package is found even when it never loaded and so never claimed an id.
     */
    async installedDirsNamed(packageName: string): Promise<string[]> {
        const root = this.pluginsDir;
        let entries;
        try {
            entries = await readdir(root, { withFileTypes: true });
        } catch {
            return [];
        }

        const found: string[] = [];
        for (const entry of entries) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            const dir = join(root, entry.name);
            try {
                const parsed = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name?: unknown };
                if (parsed.name === packageName) found.push(dir);
            } catch {
                // Not a package, or not readable: not a copy of this one.
            }
        }
        return found.sort();
    }

    /**
     * Moves a staged plugin into its folder, after taking every displaced one away.
     *
     * A folder already at the target (the same name and version, imported again) is swapped out
     * rather than merged into, so a file the new build no longer ships does not linger beside it.
     */
    async place(staged: StagedPlugin, displaced: readonly string[]): Promise<void> {
        const stagingRoot = dirname(staged.stagedDir);

        for (const dir of displaced) {
            if (resolve(dir) === resolve(staged.targetDir)) continue;
            await this.remove(dir);
        }

        const existing = await lstatOrUndefined(staged.targetDir);
        if (existing?.isSymbolicLink()) {
            await unlink(staged.targetDir);
        } else if (existing) {
            await rename(staged.targetDir, join(stagingRoot, 'previous'));
        }

        await rename(staged.stagedDir, staged.targetDir);
        await staged.discard();
        this.pluginLog.info('plugin imported', { plugin: staged.id, version: staged.version, dir: staged.targetDir });
    }

    /**
     * Takes a folder out of the plugins directory.
     *
     * The guard is on the folder's PARENT: it must be the plugins directory itself. Checking the
     * folder's own real path instead would refuse exactly the case that needs care, a dev checkout
     * linked in, whose real path is wherever the checkout is. That link is UNLINKED and never followed,
     * so removing it from the console stops the station loading it and deletes nobody's work.
     *
     * A folder that is already gone is not an error: the rescan after this is what the caller wanted.
     *
     * @throws 409 a folder that is not directly inside the plugins directory.
     */
    async remove(dir: string): Promise<void> {
        const root = this.pluginsDir;
        const name = basename(dir);
        const refuse = () =>
            httpError(409).withDetails({ message: `${dir} is not a plugin folder inside ${root}, so the station will not delete it` });

        if (name === '' || name === '.' || name === '..' || name === 'node_modules' || name.startsWith('.')) throw refuse();

        const parent = await realpath(dirname(resolve(dir))).catch(() => undefined);
        const rootReal = await realpath(root).catch(() => undefined);
        if (parent === undefined || rootReal === undefined || parent !== rootReal) throw refuse();

        const info = await lstatOrUndefined(dir);
        if (info === undefined) return;
        if (info.isSymbolicLink()) {
            await unlink(dir);
        } else {
            await rm(dir, { recursive: true, force: true });
        }
        this.pluginLog.info('plugin folder removed', { dir, linked: info.isSymbolicLink() });
    }

    /** Streams the one file in the upload to `archive`. */
    private async receive(multipart: MultipartBody, archive: string): Promise<void> {
        let received = false;
        await multipart.parse(
            async (_field, stream) => {
                received = true;
                await pipeline(stream, createWriteStream(archive));
            },
            { files: 1, fileSize: MAX_PLUGIN_ARCHIVE_BYTES, fields: 4 },
        );

        const size = received ? (await stat(archive).catch(() => undefined))?.size : undefined;
        if (!size) throw httpError(400).withDetails({ message: 'that upload carried no file' });
    }

    /** {@link inspectArchive}, with its refusals as HTTP errors. */
    private async inspect(archive: string): Promise<ArchiveTally> {
        try {
            return await inspectArchive(archive);
        } catch (error) {
            if (error instanceof ArchiveRefusal) throw httpError(error.status).withDetails({ message: error.message });
            throw error;
        }
    }

    /**
     * Extracts under `into`, dropping npm's `package/` prefix.
     *
     * The inspection above has already refused anything this would refuse, so the same check here is
     * belt and braces rather than the gate. `preserveOwner: false` is explicit because it defaults to
     * TRUE for a process running as root, which a dev checkout may be.
     */
    private async unpack(archive: string, into: string): Promise<void> {
        const tally: ArchiveTally = { entries: 0, bytes: 0, sawPackageJson: false };
        let refusal: ArchiveRefusal | undefined;
        await extract({
            file: archive,
            cwd: into,
            strip: 1,
            strict: true,
            preserveOwner: false,
            filter: (_path, entry) => {
                if (refusal !== undefined) return false;
                try {
                    checkEntry(entry as ReadEntry, tally);
                    return true;
                } catch (error) {
                    refusal = error instanceof ArchiveRefusal ? error : new ArchiveRefusal(400, errorText(error));
                    return false;
                }
            },
        });
        if (refusal !== undefined) throw httpError(refusal.status).withDetails({ message: refusal.message });
    }

    /**
     * Clears what an earlier process left under the staging directory, once per process.
     *
     * Once rather than on every import, because an import in THIS process is either in flight or has
     * already cleaned up after itself, and sweeping under an import in flight would delete it.
     */
    private async sweepOnce(root: string): Promise<void> {
        if (this.swept) return;
        this.swept = true;
        await rm(join(root, PLUGIN_STAGING_DIR), { recursive: true, force: true });
    }
}
