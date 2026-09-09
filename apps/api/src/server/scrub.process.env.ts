/**
 * Deletes secret-bearing keys from `process.env` after `AppConfigBuilder.buildSnapshot()` has
 * resolved a config snapshot. Module setups read their config from the snapshot, not from
 * `process.env`, so once the snapshot is built nothing legitimate still needs these values to
 * live in the process environment.
 *
 * This is hygiene, nothing more: a crash dump, an error serializer, or some transitive dependency
 * that decides to log `process.env` should not get a free copy of a database password. It is NOT a
 * plugin containment measure. `apps/api/.env` is still on disk, `fs` still reads it, and a plugin
 * that wants the database URL can have it the same way it could before this file existed; see
 * `packages/plugin-sdk/CLAUDE.md` § "Trust and egress", which names this file as hygiene against an
 * accident rather than containment.
 */

/**
 * Never deleted, whatever else matches. `NODE_ENV` is the load-bearing one:
 * `refresh.cookie.ts` reads it per request to decide the `secure` cookie flag,
 * so blanking it would quietly downgrade cookies in production.
 */
export const PRESERVED_ENV_KEYS: readonly string[] = ['NODE_ENV', 'PORT', 'PATH', 'HOME', 'TZ', 'PWD', 'SHELL', 'TMPDIR', 'LANG'];

/** Deleted after the config snapshot resolves, when present. */
export const SCRUBBED_ENV_KEYS: readonly string[] = [
    'KMS_LOCAL_ROOT_KEY',
    'AUTHENTICATION_SESSION_JWT_PRIVATE_KEY',
    'DATABASE_PASSWORD',
    'DATABASE_APP_PASSWORD',
    'GOOGLE_OIDC_CLIENT_SECRET',
];

/**
 * Deletes {@link SCRUBBED_ENV_KEYS} from `env`, minus anything in
 * {@link PRESERVED_ENV_KEYS}. Returns the keys actually removed, so the caller
 * can log a count without logging a name.
 */
export function scrubProcessEnv(env: NodeJS.ProcessEnv = process.env): string[] {
    const preserved = new Set(PRESERVED_ENV_KEYS);
    const removed: string[] = [];

    for (const key of SCRUBBED_ENV_KEYS) {
        if (preserved.has(key)) continue;
        if (!(key in env)) continue;
        delete env[key];
        removed.push(key);
    }

    return removed;
}
