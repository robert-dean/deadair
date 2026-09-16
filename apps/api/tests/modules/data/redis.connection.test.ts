import { describe, expect, it } from 'vitest';
import { AppConfig } from '@maroonedsoftware/appconfig';

import { describeRedisConnection, resolveRedisConnection } from '../../../src/modules/data/redis.connection.js';

/**
 * Every value a real `AppConfig` layer holds is a STRING, whatever the registry calls it, so every
 * fixture here is written as one. A test that hands over a real number or a real boolean proves
 * nothing about this file: it passes either way, which is exactly how `config.get('REDIS_PORT',
 * 6379)` sat here handing ioredis a string nobody noticed.
 */
const configOf = (values: Record<string, string>): AppConfig => new AppConfig(values);

describe('resolveRedisConnection, from the discrete variables', () => {
    it('reads the host and the port off the config', () => {
        expect(resolveRedisConnection(configOf({ REDIS_HOST: 'cache', REDIS_PORT: '6380' }))).toEqual({ host: 'cache', port: 6380 });
    });

    it('answers a real number for a port that was configured as a string', () => {
        // The bug this file was written over: `config.get('REDIS_PORT', 6379)` typed as `number`
        // and returned `'6380'`, and ioredis coerced it on the way into `net.connect`.
        expect(resolveRedisConnection(configOf({ REDIS_PORT: '6380' })).port).toBe(6380);
    });

    it('falls back to localhost on the usual port when nothing is configured', () => {
        expect(resolveRedisConnection(configOf({}))).toEqual({ host: 'localhost', port: 6379 });
    });

    it('refuses a port that is set and unreadable rather than guessing', () => {
        expect(() => resolveRedisConnection(configOf({ REDIS_PORT: '63 79' }))).toThrow(/REDIS_PORT/);
    });

    it('carries a username and a password through', () => {
        const config = configOf({ REDIS_HOST: 'cache', REDIS_USERNAME: 'station', REDIS_PASSWORD: 'hunter2' });

        expect(resolveRedisConnection(config)).toEqual({ host: 'cache', port: 6379, username: 'station', password: 'hunter2' });
    });

    it('carries a password with no username, which is what requirepass alone asks for', () => {
        // A Redis older than 6, or one with only `requirepass` set, authenticates on the password
        // alone. Sending an empty username with it would be an ACL lookup that fails.
        const connection = resolveRedisConnection(configOf({ REDIS_PASSWORD: 'hunter2' }));

        expect(connection.password).toBe('hunter2');
        expect(connection.username).toBeUndefined();
    });

    it('leaves the credentials unset when nobody configured them', () => {
        // `undefined` rather than an empty string, because ioredis sends `AUTH` for a password that
        // is present at all: an empty one would be a failed handshake against a Redis wanting none.
        const connection = resolveRedisConnection(configOf({ REDIS_HOST: 'cache', REDIS_USERNAME: '', REDIS_PASSWORD: '' }));

        expect(connection.username).toBeUndefined();
        expect(connection.password).toBeUndefined();
    });

    it('does not trim a password, whatever it was typed as', () => {
        // Trimming silently changes the credential, and the failure that produces names
        // authentication rather than the whitespace behind it.
        expect(resolveRedisConnection(configOf({ REDIS_PASSWORD: ' spaced ' })).password).toBe(' spaced ');
    });

    it('turns TLS on for the words that mean yes', () => {
        for (const yes of ['true', '1', 'yes', 'on']) {
            expect(resolveRedisConnection(configOf({ REDIS_TLS: yes })).tls).toEqual({});
        }
    });

    it('leaves TLS off for the string "false"', () => {
        // The whole of `setting.flags.ts` in one assertion: `'false'` is truthy, so a switch read as
        // a boolean here would be a station that cannot reach a cache that wants no TLS.
        expect(resolveRedisConnection(configOf({ REDIS_TLS: 'false' })).tls).toBeUndefined();
    });

    it('leaves TLS off for a value that means neither yes nor no', () => {
        expect(resolveRedisConnection(configOf({ REDIS_TLS: 'maybe' })).tls).toBeUndefined();
    });
});

describe('resolveRedisConnection, from a URL', () => {
    it('takes the host, port, credentials and database index out of it', () => {
        const config = configOf({ REDIS_URL: 'redis://station:hunter2@cache.example.com:6380/3' });

        expect(resolveRedisConnection(config)).toEqual({
            host: 'cache.example.com',
            port: 6380,
            username: 'station',
            password: 'hunter2',
            db: 3,
        });
    });

    it('reads a password with no username, which is how a redis:// URL usually carries requirepass', () => {
        const connection = resolveRedisConnection(configOf({ REDIS_URL: 'redis://:hunter2@cache:6379' }));

        expect(connection.password).toBe('hunter2');
        expect(connection.username).toBeUndefined();
    });

    it('turns TLS on for rediss:// and leaves it off for redis://', () => {
        expect(resolveRedisConnection(configOf({ REDIS_URL: 'rediss://cache:6380' })).tls).toEqual({});
        expect(resolveRedisConnection(configOf({ REDIS_URL: 'redis://cache:6380' })).tls).toBeUndefined();
    });

    it('defaults the port when the URL names none', () => {
        expect(resolveRedisConnection(configOf({ REDIS_URL: 'redis://cache' })).port).toBe(6379);
    });

    it('leaves the database index unset for a URL with no path', () => {
        // Rather than `0`, on the codebase's own rule that `undefined` means not set. ioredis
        // defaults to database 0 either way.
        expect(resolveRedisConnection(configOf({ REDIS_URL: 'redis://cache/' })).db).toBeUndefined();
    });

    it('percent-decodes a password containing the characters that would end the authority', () => {
        // The reason a URL can carry a password at all: `p@ss/word` written literally would parse
        // cleanly into a different host.
        const connection = resolveRedisConnection(configOf({ REDIS_URL: 'redis://user:p%40ss%2Fword@cache:6379' }));

        expect(connection.password).toBe('p@ss/word');
    });

    it('unwraps an IPv6 literal from the brackets the URL needed to parse it', () => {
        // `net.connect` wants the address; a host named `[::1]` fails at DNS instead of connecting.
        expect(resolveRedisConnection(configOf({ REDIS_URL: 'redis://[::1]:6379' })).host).toBe('::1');
    });

    it('is the whole answer, ignoring every discrete variable beside it', () => {
        // Not a merge, deliberately. The `full` image fills in REDIS_HOST on loopback itself, so
        // this pair is the state an operator on that variant is in the moment they add a URL, and a
        // merged answer would be the station connecting to the right host as the wrong user.
        const config = configOf({
            REDIS_URL: 'redis://url-host:6380',
            REDIS_HOST: '127.0.0.1',
            REDIS_PORT: '6379',
            REDIS_USERNAME: 'ignored',
            REDIS_PASSWORD: 'ignored',
            REDIS_TLS: 'true',
        });

        expect(resolveRedisConnection(config)).toEqual({ host: 'url-host', port: 6380 });
    });

    it('is ignored when it is set to nothing, which is how the example env file ships it', () => {
        expect(resolveRedisConnection(configOf({ REDIS_URL: '', REDIS_HOST: 'cache' }))).toEqual({ host: 'cache', port: 6379 });
    });

    it('refuses a URL it cannot parse rather than falling back to localhost', () => {
        // The fallback would be a station that STARTS, on the `full` variant onto the Redis it
        // brought, putting sessions somewhere the operator never chose.
        expect(() => resolveRedisConnection(configOf({ REDIS_URL: 'not a url' }))).toThrow(/REDIS_URL/);
    });

    it('refuses a URL whose scheme is not a Redis one', () => {
        expect(() => resolveRedisConnection(configOf({ REDIS_URL: 'postgres://cache:6379' }))).toThrow(/rediss?:\/\//);
    });

    it('refuses a URL that names no host', () => {
        expect(() => resolveRedisConnection(configOf({ REDIS_URL: 'redis:///3' }))).toThrow(/REDIS_URL/);
    });

    it('refuses a database index that is not a whole number', () => {
        expect(() => resolveRedisConnection(configOf({ REDIS_URL: 'redis://cache/two' }))).toThrow(/database index/);
    });

    it('refuses a password that is not percent-encoded correctly', () => {
        expect(() => resolveRedisConnection(configOf({ REDIS_URL: 'redis://user:100%pure@cache' }))).toThrow(/percent-encoded/);
    });

    it('never quotes the URL back in any of its refusals', () => {
        // Every one of these messages reaches stdout and the file `/logs` serves, and a Redis URL
        // carries the password in its authority.
        const bad = ['not a url', 'postgres://user:hunter2@cache:6379', 'redis://user:hunter2@cache/two', 'redis://user:100%pure@cache'];

        for (const url of bad) {
            let message = '';
            try {
                resolveRedisConnection(configOf({ REDIS_URL: url }));
            } catch (error) {
                message = (error as Error).message;
            }

            expect(message, `"${url}" was meant to be refused`).not.toBe('');
            expect(message).not.toContain('hunter2');
            expect(message).not.toContain('cache');
        }
    });
});

describe('describeRedisConnection', () => {
    it('is the address alone for a connection with nothing else to say', () => {
        expect(describeRedisConnection({ host: 'localhost', port: 6379 })).toBe('localhost:6379');
    });

    it('names the username, the TLS and the database index', () => {
        const line = describeRedisConnection({ host: 'cache', port: 6380, username: 'station', password: 'hunter2', db: 3, tls: {} });

        expect(line).toBe('cache:6380, over TLS, as station, on database 3');
    });

    it('says that a password exists when there is no username to name', () => {
        expect(describeRedisConnection({ host: 'cache', port: 6379, password: 'hunter2' })).toBe('cache:6379, with a password');
    });

    it('never includes the password', () => {
        // This line is written at every boot, so a password in it is a password in `docker logs`
        // and in the file `/logs` serves.
        const line = describeRedisConnection({ host: 'cache', port: 6380, username: 'station', password: 'hunter2', db: 3, tls: {} });

        expect(line).not.toContain('hunter2');
    });
});
