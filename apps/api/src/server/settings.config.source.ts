import { AppConfigSourcePostgres } from '@maroonedsoftware/appconfig/postgres';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import { resolveRuntimeConnection } from '#modules/data/database.connection.js';

/**
 * The Postgres channel `deadair.settings` announces itself on.
 *
 * Installed by migration `0003_settings.sql` as an `after insert or update or
 * delete` trigger. It has existed since settings did and nothing listened on it
 * until this source.
 */
export const SETTINGS_NOTIFY_CHANNEL = 'deadair_settings_changed';

/**
 * `deadair.settings` as a layer of the app's configuration.
 *
 * The station's runtime settings are a key/value table because Icecast and
 * Liquidsoap run in sibling containers that cannot read Postgres, and because an
 * operator changes them from the console rather than by redeploying. This makes
 * that table readable the same way `.env` is: through the injected `AppConfig`,
 * by anything, with or without a DI scope. That last part is the point — a
 * settings row is otherwise reachable only through the scoped
 * `SettingsRepository`, which the playout singletons ticking every couple of
 * seconds do not have.
 *
 * Keys stay flat and dotted (`stream.title`), which survives the merge as a
 * literal property name rather than being read as a path into a nested object.
 * Nothing collides with the SCREAMING_SNAKE keys dotenv contributes.
 *
 * ## Owned connection, with the credentials already resolved
 *
 * Owned rather than pooled because there is no pool yet: this is built in
 * `setup.server.ts` before any container exists, which is also why the source's
 * tolerance of a missing table matters — the first boot of a fresh database runs
 * this before dbmate has created one, and it answers with an empty layer instead
 * of refusing to start.
 *
 * The connection details are passed as **resolved literals** rather than
 * `${env:…}` templates on purpose. `scrubProcessEnv()` deletes
 * `DATABASE_PASSWORD` and `DATABASE_APP_PASSWORD` from `process.env` moments
 * after the config is built, so a source that re-resolved its own credentials on
 * each reload would connect once at boot and fail on every reload afterwards —
 * and a failed reload is silent by design, because the store keeps serving its
 * last-good config.
 *
 * Connects as the runtime role for least privilege: this only ever reads, and
 * every write still goes through the repository on the pooled connection.
 */
export function settingsConfigSource(config: AppConfig, logger: Logger): AppConfigSourcePostgres {
    return new AppConfigSourcePostgres(
        logger,
        { connection: resolveRuntimeConnection(config) },
        { schema: 'deadair', table: 'settings', notifyChannel: SETTINGS_NOTIFY_CHANNEL },
    );
}
