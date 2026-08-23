/**
 * The dev supervisor, in place of `node --watch`.
 *
 * `--watch` restarts on every individual file event, so a save-all, a codegen run or a
 * branch switch costs one full boot per file — and it starts the replacement before the
 * old process has finished tearing down, which for this app means two servers briefly
 * holding the same port, the same inspector and the same Liquidsoap lease. This does the
 * same job with two differences: changes are collected and acted on once the writes stop
 * (`DEV_WATCH_DEBOUNCE_MS`), and the successor is not spawned until the predecessor has
 * exited, so a shutdown hook that flushes the running order gets to finish.
 *
 * Deliberately plain JS: it supervises the swc register hook rather than running under it.
 */
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** How long the writes have to stop for before a restart is worth paying for. */
const DEBOUNCE_MS = Number(process.env.DEV_WATCH_DEBOUNCE_MS ?? 400);
/** How long a graceful SIGTERM gets before the process is taken out of its misery. */
const KILL_AFTER_MS = Number(process.env.DEV_WATCH_KILL_AFTER_MS ?? 8000);

const NODE_ARGS = [
    '--inspect',
    '--no-warnings',
    '--no-deprecation',
    // The `#` aliases resolve two ways: package.json#imports maps them to `dist/` by default so a
    // production `node dist/index.js` works, and to `src/` under the `development` condition. Dev
    // must ask for that condition or a stale dist would be preferred over the file just edited.
    '--conditions=development',
    '--import',
    '@swc-node/register/esm-register',
    '--enable-source-maps',
    './src/index.ts',
];

/** What counts as a source change. Everything else under `src/` is noise for this purpose. */
const WATCHED = /\.(ts|mts|cts|js|mjs|cjs|json)$/;

/** @type {import('node:child_process').ChildProcess | undefined} */
let child;
/** @type {NodeJS.Timeout | undefined} */
let timer;
let restarting = false;
let shuttingDown = false;

function log(message) {
    process.stdout.write(`[dev] ${message}\n`);
}

function start() {
    child = spawn(process.execPath, NODE_ARGS, {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' },
    });

    const started = child;
    child.on('exit', (code, signal) => {
        if (started !== child) return;
        child = undefined;
        if (shuttingDown || restarting) return;
        // A crash or a deliberate exit: stay up and wait for the edit that fixes it, which
        // is what `--watch` does too. Restarting a process that just failed to boot only
        // buys the same stack trace on a loop.
        log(`exited (${signal ?? code}); waiting for a change`);
    });
}

/** SIGTERM, then wait — with SIGKILL as the backstop for a hook that will not return. */
function stop() {
    const dying = child;
    if (!dying) return Promise.resolve();
    child = undefined;
    return new Promise(done => {
        const hammer = setTimeout(() => dying.kill('SIGKILL'), KILL_AFTER_MS);
        dying.on('exit', () => {
            clearTimeout(hammer);
            done();
        });
        dying.kill('SIGTERM');
    });
}

async function restart(reason) {
    if (restarting) return;
    restarting = true;
    log(`restarting (${reason})`);
    await stop();
    restarting = false;
    if (!shuttingDown) start();
}

/** @type {Set<string>} */
const pending = new Set();

function onChange(file) {
    pending.add(file);
    clearTimeout(timer);
    timer = setTimeout(() => {
        const count = pending.size;
        const first = [...pending][0];
        pending.clear();
        void restart(count === 1 ? first : `${count} files`);
    }, DEBOUNCE_MS);
}

for (const target of ['src', '.env']) {
    const path = join(root, target);
    try {
        const watcher = watch(path, { recursive: target === 'src' }, (_event, filename) => {
            const name = filename ? String(filename) : target;
            if (target === 'src' && !WATCHED.test(name)) return;
            onChange(name);
        });
        // A watcher that dies must not take the server down with it: without this, the
        // 'error' event is unhandled and the supervisor throws, leaving an orphaned child
        // still holding the port. Losing the watch costs a manual restart and nothing else.
        watcher.on('error', error => log(`watch on ${target} failed (${error.code ?? error.message}); restart by hand`));
    } catch (error) {
        // A missing `.env` is an ordinary local setup, not a fault.
        if (error.code !== 'ENOENT') throw error;
    }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
        shuttingDown = true;
        clearTimeout(timer);
        await stop();
        process.exit(0);
    });
}

log(`watching src/ (debounce ${DEBOUNCE_MS}ms)`);
start();
