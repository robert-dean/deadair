/**
 * Boot the API, let it settle, then SIGINT it and let the teardown run to completion.
 *
 * A one-off probe for the thing no unit test can assert: that the modules tear down in the order
 * the list intends, that the pools and the log store are still alive while everything above them
 * is closing, and that the process actually exits. Same supervise-a-child shape as
 * `dev.watch.mjs`, minus the watching.
 *
 * Usage: node scripts/shutdown.probe.mjs [settleMs]
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const settleMs = Number(process.argv[2] ?? 30_000);

const child = spawn(
    process.execPath,
    ['--no-warnings', '--no-deprecation', '--import', '@swc-node/register/esm-register', '--enable-source-maps', './src/index.ts'],
    { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' } },
);

const exited = new Promise(resolveExit => {
    child.on('exit', (code, signal) => resolveExit({ code, signal }));
});

setTimeout(() => {
    process.stdout.write(`\n[probe] ${settleMs}ms elapsed, sending SIGINT\n\n`);
    child.kill('SIGINT');
}, settleMs);

// If the teardown hangs, say so rather than sitting here: that is itself the finding.
const hung = setTimeout(() => {
    process.stdout.write('\n[probe] still alive 30s after SIGINT — teardown did not finish\n');
    child.kill('SIGKILL');
}, settleMs + 30_000);

const { code, signal } = await exited;
clearTimeout(hung);
process.stdout.write(`\n[probe] child exited (code=${code}, signal=${signal})\n`);
