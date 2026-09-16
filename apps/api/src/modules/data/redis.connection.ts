import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { RedisOptions } from 'ioredis';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { requiredNumber } from '#modules/shared/setting.numbers.js';

/**
 * Where Redis is and who to be when connecting to it.
 *
 * The `ioredis` connection identity on its own, with none of the client tuning beside it
 * (`enableOfflineQueue` and the error handlers stay at the call site), for the same reason
 * `DatabaseConnection` carries no pool options: this is the part an operator configures and
 * the rest is the station's own business.
 */
export interface RedisConnection {
    host: string;
    port: number;
    username?: string;
    password?: string;
    db?: number;
    /** An empty object turns TLS on; `undefined` leaves the connection in the clear. */
    tls?: RedisOptions['tls'];
}

/**
 * Reading the cache connection out of the environment.
 *
 * ## Why this exists
 *
 * For most of this station's life the Redis client was built from `REDIS_HOST` and `REDIS_PORT` and
 * nothing else, so a Redis that wants `AUTH` could not be pointed at. The reporter of
 * [#160](https://github.com/robert-dean/deadair/issues/160) ran a second Redis instance rather than
 * share the one they already had, which is a whole daemon's worth of cost for a missing string.
 *
 * ## Two surfaces, and one of them wins whole
 *
 * `REDIS_URL` is here because it is what a hosted Redis hands its customers: `rediss://` with the
 * credentials, the port and the database index already in it, ready to paste. Refusing it would mean
 * every operator taking one apart by hand into four variables.
 *
 * But two spellings of the same facts is how they come to disagree, which is the argument the
 * migration script makes for composing `DATABASE_URL` from parts rather than asking for it. So they
 * are not merged: **when `REDIS_URL` is set it is the entire answer**, and `REDIS_HOST`,
 * `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` and `REDIS_TLS` are not consulted at all. A
 * half-merge would be worse than either, because the failure it produces is a station that connects
 * to the right host as the wrong user.
 *
 * That is not a theoretical tidiness either. The `full` image fills in `REDIS_HOST` and `REDIS_PORT`
 * on loopback for the Redis it brings, so on that variant the two surfaces WOULD sit side by side
 * the moment an operator added a URL. `database-env` now leaves those defaults alone when a URL is
 * set, and this rule is what makes that safe rather than merely tidy.
 *
 * A database index has no discrete variable on purpose: the URL's path carries one and a second way
 * to say it would be a third spelling. An operator who needs to share one Redis between
 * applications by index uses `REDIS_URL`.
 *
 * ## Why an unreadable URL throws
 *
 * On `requiredNumber`'s rule, which is that boot configuration should refuse rather than fall back.
 * A `REDIS_URL` nobody can parse falling through to `localhost:6379` is the worst available outcome:
 * on the `full` variant there IS a Redis on localhost, so the station would start, work, and put its
 * sessions somewhere the operator never chose, with nothing in the log to say so.
 *
 * **The message never quotes the value.** A Redis URL carries the password, and an error text is one
 * of the few things in this process that reaches both stdout and the file `/logs` serves.
 */
export function resolveRedisConnection(config: AppConfig): RedisConnection {
    const url = trimmedText(config, 'REDIS_URL');

    return url ? fromUrl(url) : fromParts(config);
}

/**
 * The connection as a line worth logging: everything an operator needs to see that the station read
 * the variables they meant, and never the password.
 *
 * Its whole job is the support question this change invites, which is "I set `REDIS_PASSWORD` and it
 * was ignored" from somebody who also has a `REDIS_URL`. One line at boot answers it without anybody
 * having to read this file.
 */
export function describeRedisConnection(connection: RedisConnection): string {
    const parts = [`${connection.host}:${connection.port}`];

    if (connection.tls) parts.push('over TLS');
    // The username when there is one, and otherwise the mere FACT of a password: a Redis older than
    // 6 authenticates with a password alone, and "is this connection authenticating at all" is the
    // question being asked here. The value itself is never any part of the answer.
    if (connection.username) parts.push(`as ${connection.username}`);
    else if (connection.password) parts.push('with a password');
    if (connection.db) parts.push(`on database ${connection.db}`);

    return parts.join(', ');
}

/**
 * The four discrete variables, which stay the documented surface: the unraid template and
 * `deploy/.env.example` are fields rather than a text box, and a form is a better place to be told
 * that a password exists than a URL somebody has to assemble.
 */
function fromParts(config: AppConfig): RedisConnection {
    const connection: RedisConnection = {
        host: trimmedText(config, 'REDIS_HOST') || 'localhost',
        // `requiredNumber` rather than the bare `config.get('REDIS_PORT', 6379)` that was here.
        // Every layer of `AppConfig` holds strings, so that call handed ioredis `'6379'` whenever the
        // variable was SET and only worked because the connector coerces it on the way into
        // `net.connect`. A typo took the same path: `REDIS_PORT=63 79` became a `NaN` port rather
        // than an error naming the variable.
        port: requiredNumber(config, 'REDIS_PORT', 6379),
    };

    const username = trimmedText(config, 'REDIS_USERNAME');
    if (username) connection.username = username;

    const password = rawText(config, 'REDIS_PASSWORD');
    if (password) connection.password = password;

    // A string, like every other setting, so it goes through the vocabulary in `setting.flags.ts`
    // rather than being tested for truth. `REDIS_TLS=false` read as a boolean is `true`, which would
    // be a station that cannot reach its cache and an error about a handshake.
    if (settingIsOn(config, 'REDIS_TLS', false)) connection.tls = {};

    return connection;
}

/** The schemes a Redis URL may carry. `rediss://` is the same thing wrapped in TLS. */
const SCHEMES = new Set(['redis:', 'rediss:']);

function fromUrl(value: string): RedisConnection {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error('REDIS_URL is not a URL. It should look like redis://user:password@host:6379/0, or rediss:// for TLS.');
    }

    if (!SCHEMES.has(url.protocol)) {
        // The scheme is safe to quote back; the rest of the URL is not.
        throw new Error(`REDIS_URL must be a redis:// or rediss:// URL, but its scheme is "${url.protocol.replace(':', '')}".`);
    }

    if (!url.hostname) throw new Error('REDIS_URL names no host.');

    const connection: RedisConnection = {
        // `URL` keeps an IPv6 literal in the brackets that made it parseable as an authority, and
        // `net.connect` wants the address without them. `redis://[::1]:6379` otherwise resolves to a
        // host named `[::1]`, which fails at DNS rather than at the socket.
        host: url.hostname.replace(/^\[(.+)\]$/, '$1'),
        port: url.port ? Number(url.port) : 6379,
    };

    // `URL` hands these back percent-encoded, and a Redis password is allowed to contain the
    // characters that would otherwise end the authority. Decoding is what makes a URL able to carry
    // one at all, and it is also the step that can fail on its own: a `%` that begins no escape
    // throws here rather than reaching the server as a password nobody typed.
    const username = decodeField(url.username, 'username');
    if (username) connection.username = username;

    const password = decodeField(url.password, 'password');
    if (password) connection.password = password;

    const db = url.pathname.replace(/^\//, '');
    if (db) {
        const index = Number(db);
        if (!Number.isInteger(index) || index < 0) throw new Error(`REDIS_URL's database index must be a whole number, but it is "${db}".`);
        connection.db = index;
    }

    if (url.protocol === 'rediss:') connection.tls = {};

    return connection;
}

function decodeField(raw: string, field: 'username' | 'password'): string {
    if (!raw) return '';

    try {
        return decodeURIComponent(raw);
    } catch {
        throw new Error(`REDIS_URL's ${field} is not percent-encoded correctly. A literal % has to be written as %25.`);
    }
}

/**
 * A configured string, or the empty string for one nobody set.
 *
 * Read as `unknown` and coerced here for the reason `requiredNumber` does the same: `get`'s overload
 * takes its return type from the DEFAULT, so it declares `string` while a layer that genuinely held
 * a number hands one back.
 */
function trimmedText(config: AppConfig, key: string): string {
    return rawText(config, key).trim();
}

/**
 * The same, untrimmed, which is what a password is read through.
 *
 * Trimming a password silently changes it, and the resulting failure names authentication rather
 * than the whitespace behind it. Nothing else here needs the distinction.
 */
function rawText(config: AppConfig, key: string): string {
    const raw: unknown = config.get(key, '');
    if (raw === undefined || raw === null) return '';

    return String(raw);
}
