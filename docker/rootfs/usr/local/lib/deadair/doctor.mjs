// What `deadair-doctor` checks, one line per check.
//
// It answers "is this container set up right", which is the question an operator has before the
// console is any use to them: the volume, the keys, the database, the cache, the address. Why a
// working station is QUIET is a different question with its own page, the console's Check-up,
// which reads the running station and needs a session to ask. This never reaches for that page's
// answer, because doing it from here would mean a way into the API that skips signing in.
//
// Nothing here prints a secret. A key is reported by where it came from and whether it is the right
// shape, never by its value.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';

const DATA = process.env.DATA_DIR || '/data';
const results = [];

function record(state, name, detail) {
    results.push({ state, name, detail });
}

/** Whether a path is a mount point of its own, read from the kernel's table rather than guessed. */
function isMount(path) {
    try {
        return readFileSync('/proc/self/mountinfo', 'utf8')
            .split('\n')
            .some(line => line.split(' ')[4] === path);
    } catch {
        return undefined;
    }
}

function checkData() {
    if (DATA !== '/data') {
        record(
            'fail',
            'Data directory',
            `DATA_DIR is "${DATA}" inside the container, so the station keeps its data somewhere other than the volume. It is the host side of the volume only: take it out of the container's environment (deploy/docker-compose.yml pins it to /data).`,
        );
        return;
    }
    const mounted = isMount('/data');
    if (mounted === false) {
        record(
            'fail',
            'Data directory',
            '/data is not a mounted volume, so everything the station keeps is lost when the container is recreated. Mount a host directory or a volume there.',
        );
        return;
    }
    // Written for real rather than asked with `test -w`: a bind mount through Docker Desktop reports
    // every file as root's and still lets the station write, so the permission bits answer wrong.
    // As the station's own uid and gid rather than through `s6-setuidgid`, which lives in `/command`
    // and is not on the path a `docker exec` gets.
    const writable = spawnSync('sh', ['-c', 'probe="/data/.doctor.$$" && : > "$probe" && rm -f "$probe"'], { uid: 99, gid: 100 }).status === 0;
    if (!writable) {
        record(
            'fail',
            'Data directory',
            '/data is mounted but the station (uid 99, gid 100) cannot write to it. On the host: chown -R 99:100 <the data directory>.',
        );
        return;
    }
    record('ok', 'Data directory', '/data is a mounted volume the station can write to.');
}

function checkKeys() {
    const keys = [
        { name: 'KMS_LOCAL_ROOT_KEY', label: 'Root key', valid: value => /^[0-9a-fA-F]{64}$/.test(value.trim()), shape: '64 hex characters' },
        {
            name: 'AUTHENTICATION_SESSION_JWT_PRIVATE_KEY',
            label: 'Session key',
            valid: value => value.trim().length > 0,
            shape: 'an RSA private key',
        },
    ];
    for (const key of keys) {
        const value = process.env[key.name] ?? '';
        let file;
        try {
            file = readFileSync(`${DATA}/secrets/${key.name}`, 'utf8');
        } catch {
            file = undefined;
        }
        // `station-secrets` has already exported the file's value when the container's own was
        // empty, so the two are told apart by whether they are the same text. Trailing whitespace
        // aside: the shell's `$(cat …)` drops the newline a PEM ends with.
        const source =
            file !== undefined && file.trimEnd() === value.trimEnd() ? `made by the station, in ${DATA}/secrets` : 'set in the environment';
        if (value.trim().length === 0) {
            record(
                'fail',
                key.label,
                `${key.name} is not set and the station has not made one. It is made on the first boot; restart the container and check again.`,
            );
        } else if (!key.valid(value)) {
            record('fail', key.label, `${key.name} is ${source}, but it is not ${key.shape}.`);
        } else {
            record('ok', key.label, `${source}.`);
        }
    }
}

function checkDatabase() {
    const { DATABASE_HOST, DATABASE_USER, DATABASE_NAME, DATABASE_PASSWORD = '', DATABASE_PORT = '5432', DATABASE_SSLMODE = 'disable' } = process.env;
    if (!DATABASE_HOST || !DATABASE_USER || !DATABASE_NAME) {
        record(
            'fail',
            'Database',
            'DATABASE_HOST, DATABASE_USER and DATABASE_NAME are not all set. This tag expects a database of your own; the `full` tag brings one.',
        );
        return;
    }
    // The same URL `migrate` composes, search path included, so the answer is about the database
    // the station will actually use.
    const url = `postgres://${DATABASE_USER}:${encodeURIComponent(DATABASE_PASSWORD)}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}?sslmode=${DATABASE_SSLMODE}&search_path=public`;
    const status = spawnSync('dbmate', ['-d', '/app/apps/api/data/migrations', '--no-dump-schema', 'status', '--exit-code'], {
        env: { ...process.env, DATABASE_URL: url },
        encoding: 'utf8',
        timeout: 20_000,
    });
    const output = `${status.stdout ?? ''}${status.stderr ?? ''}`;
    const pending = /Pending:\s*(\d+)/.exec(output)?.[1];
    if (pending !== undefined && pending !== '0') {
        record(
            'fail',
            'Database',
            `${DATABASE_HOST} answers, but ${pending} migration(s) have not been applied. They run at boot unless MIGRATE_ON_BOOT is off; the container log says why they did not.`,
        );
    } else if (status.status === 0) {
        record('ok', 'Database', `${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME} answers and its schema is up to date.`);
    } else {
        const reason = output.split('\n').find(line => /error/i.test(line)) ?? output.trim().split('\n').pop() ?? 'no answer';
        record('fail', 'Database', `${DATABASE_HOST}:${DATABASE_PORT} did not answer as ${DATABASE_USER}: ${reason.trim()}`);
    }
}

/** One RESP command, written by hand: this image has no Redis client outside the API's own tree. */
function resp(...parts) {
    return `*${parts.length}\r\n${parts.map(part => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`;
}

function checkRedis() {
    let host = process.env.REDIS_HOST;
    let port = Number(process.env.REDIS_PORT || 6379);
    let username = process.env.REDIS_USERNAME || undefined;
    let password = process.env.REDIS_PASSWORD || undefined;
    let secure = /^(1|true|yes|on)$/i.test(process.env.REDIS_TLS ?? '');
    if (process.env.REDIS_URL) {
        // REDIS_URL is the whole answer when it is set, as it is for the API.
        try {
            const url = new URL(process.env.REDIS_URL);
            host = url.hostname;
            port = Number(url.port || 6379);
            username = url.username ? decodeURIComponent(url.username) : undefined;
            password = url.password ? decodeURIComponent(url.password) : undefined;
            secure = url.protocol === 'rediss:';
        } catch {
            record('fail', 'Cache', 'REDIS_URL is set but is not a URL.');
            return Promise.resolve();
        }
    }
    if (!host) {
        record('fail', 'Cache', 'Neither REDIS_HOST nor REDIS_URL is set. This tag expects a Redis of your own; the `full` tag brings one.');
        return Promise.resolve();
    }
    return new Promise(resolve => {
        const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
        let answer = '';
        const finish = (state, detail) => {
            socket.destroy();
            record(state, 'Cache', detail);
            resolve();
        };
        socket.setTimeout(5_000, () => finish('fail', `${host}:${port} did not answer within five seconds.`));
        socket.on('error', error => finish('fail', `${host}:${port}: ${error.message}`));
        socket.on(secure ? 'secureConnect' : 'connect', () => {
            if (password) socket.write(username ? resp('AUTH', username, password) : resp('AUTH', password));
            socket.write(resp('PING'));
        });
        socket.on('data', chunk => {
            answer += chunk.toString();
            if (answer.includes('-')) {
                const error = answer.split('\r\n').find(line => line.startsWith('-'));
                if (error) finish('fail', `${host}:${port} refused: ${error.slice(1)}`);
            }
            if (answer.includes('+PONG')) finish('ok', `${host}:${port} answers.`);
        });
    });
}

function checkAddresses() {
    const app = process.env.APP_BASE_URL ?? '';
    const spa = process.env.SPA_BASE_URL ?? '';
    if (!app || !spa) {
        record(
            'fail',
            'Address',
            `${!app ? 'APP_BASE_URL' : 'SPA_BASE_URL'} is empty. The console still loads, but sign-in links and a music provider's authorization will send the browser nowhere. Set both to the address you type to reach the station.`,
        );
        return;
    }
    let parsed;
    try {
        parsed = new URL(app);
    } catch {
        record('fail', 'Address', `APP_BASE_URL "${app}" is not a URL. It needs the scheme too: http://192.168.1.10:8080.`);
        return;
    }
    if (parsed.pathname !== '/' || parsed.search) {
        record(
            'warn',
            'Address',
            `APP_BASE_URL "${app}" has a path after the host. The station is served from the root of its address, so this is usually a mistake.`,
        );
    } else if (app.replace(/\/$/, '') !== spa.replace(/\/$/, '')) {
        record(
            'warn',
            'Address',
            `APP_BASE_URL and SPA_BASE_URL differ ("${app}" and "${spa}"). One port serves both, so they are normally the same address.`,
        );
    } else {
        record('ok', 'Address', `${app}`);
    }
}

function checkVoice() {
    if (!process.env.TTS_PORT || !statSafe('/opt/tts')) return;
    const weights = `${process.env.DEADAIR_MEDIA || `${DATA}/media`}/tts-models`;
    let held = false;
    try {
        held = readdirSync(weights, { recursive: true }).some(entry => /\.(pth|onnx|bin|safetensors)$/.test(String(entry)));
    } catch {
        held = false;
    }
    if (held) {
        record('ok', 'Voice', `the speech model's weights are in ${weights}.`);
    } else {
        record(
            'warn',
            'Voice',
            `the speech model's weights are not downloaded yet. The first thing the station says fetches them, so it needs internet access then.`,
        );
    }
}

function statSafe(path) {
    try {
        return statSync(path);
    } catch {
        return undefined;
    }
}

async function checkHealth() {
    try {
        const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/health`, { signal: AbortSignal.timeout(5_000) });
        if (response.ok) {
            record('ok', 'Station', 'the API is up and answering.');
        } else {
            record('fail', 'Station', `the API answered /health with ${response.status}. The container log says why.`);
        }
    } catch {
        record(
            'fail',
            'Station',
            'the API is not answering yet. On a first boot wait for "Boot complete" in the container log; otherwise the log says why it stopped.',
        );
    }
}

checkData();
checkKeys();
checkDatabase();
await checkRedis();
checkAddresses();
checkVoice();
await checkHealth();

const marks = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };
const width = Math.max(...results.map(result => result.name.length));
for (const result of results) {
    console.log(`${marks[result.state]}  ${result.name.padEnd(width)}  ${result.detail}`);
}
const failed = results.filter(result => result.state === 'fail').length;
console.log('');
if (failed > 0) {
    console.log(`${failed} check(s) failed.`);
} else {
    const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
    console.log(
        `The container is set up. If the station is quiet, the console's Check-up page says why: ${base ? `${base}/checkup` : 'Check-up, in the sidebar'}.`,
    );
}
process.exit(failed > 0 ? 1 : 0);
