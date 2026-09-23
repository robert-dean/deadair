import type { Container } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { AfterCommit } from '#modules/data/after.commit.js';
import { SettingsRepository } from '#modules/settings/settings.repository.js';
import { SettingsService } from '#modules/settings/settings.service.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { errorText } from '#modules/shared/error.text.js';
import { SIGNIN_KEYS } from './signin.settings.js';

/**
 * Marks that the Google variables have been copied into the console once, so a station whose
 * operator later removes the Google row does not find it back after the next restart. Undeclared,
 * so the console never draws it and `PUT /settings` refuses to write it.
 */
export const SIGNIN_SEEDED_KEY = 'signin.seededFromEnvironment';

/** Where Google's discovery document lives, when `GOOGLE_OIDC_ISSUER` names nowhere else. */
const GOOGLE_ISSUER = 'https://accounts.google.com';

/**
 * Copy the Google sign-in the station used to take from its environment into the console's list,
 * once, so a station upgraded past the variables keeps signing people in through Google.
 *
 * Runs only when both `GOOGLE_OIDC_CLIENT_ID` and `GOOGLE_OIDC_CLIENT_SECRET` are set, the provider
 * list has never been stored, and the copy has not happened before. Written through
 * `SettingsService` so the secret is encrypted and held per row exactly as one typed into the
 * console would be. After it, the variables are no longer read, and the log says so.
 *
 * Never fatal: a station that cannot copy the row still boots, signs in by password and emailed
 * link, and says why in the log.
 */
export async function seedSigninProvidersFromEnv(container: Container): Promise<'seeded' | 'skipped'> {
    const config = container.get(AppConfig);
    const logger = container.get(Logger);

    const clientId = String(config.get('GOOGLE_OIDC_CLIENT_ID', '')).trim();
    const clientSecret = String(config.get('GOOGLE_OIDC_CLIENT_SECRET', '')).trim();
    if (clientId === '' || clientSecret === '') return 'skipped';
    if (config.has(SIGNIN_KEYS.providers) || config.has(SIGNIN_SEEDED_KEY)) return 'skipped';

    const issuer = String(config.get('GOOGLE_OIDC_ISSUER', '')).trim() || GOOGLE_ISSUER;

    try {
        await inScope(container, async scope => {
            await scope.get(SettingsService).write({
                [SIGNIN_KEYS.providers]: JSON.stringify([{ name: 'google', label: 'Google', issuer, clientId, clientSecret }]),
            });
            await scope.get(SettingsRepository).set(SIGNIN_SEEDED_KEY, new Date().toISOString());
            // Outside a request nothing runs the deferred config reload, and these writes are
            // already committed, so run it here rather than wait for the settings NOTIFY.
            await scope.get(AfterCommit).run();
        });
    } catch (error) {
        logger.error('sign-in: could not copy the Google sign-in from the environment into Settings', { error: errorText(error) });
        return 'skipped';
    }

    logger.warn(
        'sign-in: copied GOOGLE_OIDC_CLIENT_ID and GOOGLE_OIDC_CLIENT_SECRET into Settings, Sign-in and connections. ' +
            'They are no longer read and can be removed from the environment.',
    );
    return 'seeded';
}
