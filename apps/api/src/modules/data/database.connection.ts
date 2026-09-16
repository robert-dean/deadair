import type { AppConfig } from '@maroonedsoftware/appconfig';
import { requiredNumber } from '#modules/shared/setting.numbers.js';

/**
 * Where the database is and who to be when connecting to it.
 *
 * The `pg` connection identity on its own, with no pool tuning and no type
 * overrides: it is what both a `Pool` and a bare `Client` need, and the two
 * callers want different amounts of the rest.
 */
export interface DatabaseConnection {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
}

/**
 * The owner role (`DATABASE_USER`), which owns the schema and may change it.
 *
 * For privileged maintenance. dbmate holds its own connection as this role and
 * `JobsModule` calls this for pg-boss, which manages its own schema.
 *
 * It would also bypass RLS, which is why the runtime path deliberately does not
 * use it — though there are no policies to bypass yet. See
 * [row-level-security](https://github.com/robert-dean/deadair/discussions/31).
 */
export function resolveOwnerConnection(config: AppConfig): DatabaseConnection {
    return {
        host: config.get('DATABASE_HOST', ''),
        // `requiredNumber` rather than the bare `config.get('DATABASE_PORT', 55432)` that was here.
        // Every layer of `AppConfig` holds strings, so that call handed `pg` `'5432'` whenever the
        // variable was SET and only worked because the driver coerces it. A typo took the same path:
        // `DATABASE_PORT=54 32` became a `NaN` port rather than an error naming the variable, and
        // `NaN` is falsy, so `pg` reads it as a port nobody set and falls through to `PGPORT` and
        // then to its own 5432 (`connection-parameters.js`). The typo therefore arrives as a
        // connection refused, or worse as authentication against whatever answers on 5432, rather
        // than as the two characters that caused it.
        port: requiredNumber(config, 'DATABASE_PORT', 55432),
        user: config.get('DATABASE_USER', ''),
        password: config.get('DATABASE_PASSWORD', ''),
        database: config.get('DATABASE_NAME', ''),
    };
}

/**
 * The role ordinary application reads and writes go through.
 *
 * `DATABASE_APP_USER` when it is configured, so ordinary traffic runs as a role
 * that holds only DML grants and is created `nobypassrls`, and the owner
 * otherwise. That fallback is what lets a development install run with one set
 * of credentials.
 *
 * The `nobypassrls` half is preparation rather than protection today: no
 * migration declares a policy, so there is nothing for it not to bypass. What it
 * does buy already is that the runtime path cannot alter the schema.
 *
 * Shared rather than repeated because there are now two callers deciding it —
 * the runtime pool in `data.module.ts`, and the settings source in
 * `setup.server.ts` that reads `deadair.settings` before any pool exists — and a
 * disagreement between them would be one of them silently connecting as the
 * owner.
 */
export function resolveRuntimeConnection(config: AppConfig): DatabaseConnection {
    const owner = resolveOwnerConnection(config);
    const appUser = config.get('DATABASE_APP_USER', '');
    if (!appUser) return owner;

    return { ...owner, user: appUser, password: config.get('DATABASE_APP_PASSWORD', '') };
}
