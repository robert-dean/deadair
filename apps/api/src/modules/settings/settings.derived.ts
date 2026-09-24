import type { AppConfig } from '@maroonedsoftware/appconfig';
import { oidcRedirectUri, SIGNIN_KEYS } from '#modules/authentication/signin.settings.js';
import { CLOCK_KEYS, hostZone } from '#modules/director/clock.words.js';
import { advertisedHostname, deployedOrigin, resolvePublicUrl, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { SETTING_DESCRIPTORS } from './settings.registry.js';

/**
 * What an empty setting works out to, for the three whose empty is a DERIVATION from the config rather
 * than an absence, and what the one `note` that shows a value shows. The model settings derive too, from
 * the model plugin rather than the config, and are {@link derivedModels}.
 *
 * Each of them says "leave empty to …" in its own help text, and until this existed the console could
 * only repeat the sentence: the value itself is worked out server-side, from the environment or from
 * another setting, and nothing on the wire carried it. That is the shape the public URL's bug took on
 * the live station — the environment set, the setting empty, and no way to see what Icecast was being
 * told short of reading the rendered `icecast.xml`.
 *
 * Every entry is what the station WOULD use with the box left empty, which is deliberately not what
 * is in force: each derivation is computed with the stored value skipped, so a field somebody has
 * filled in still reports what clearing it would fall back to. That is why the three resolvers behind
 * this are split the way they are ({@link deployedOrigin}, {@link hostZone}) rather than being asked
 * through the resolver the rest of the app reads, which would hand back the operator's own value and
 * call it a derivation.
 *
 * A key is left OUT where its derivation lands on nothing, because an empty string is not something
 * to show anybody: absent means "nothing to say", which is how the console reads it.
 *
 * Values only. Where each one comes from is a sentence, and the sentence is in the field's help text,
 * which has said so since before this map existed.
 */
export function derivedSettings(config: AppConfig): Record<string, string> {
    const derived: Record<string, string> = {
        [STREAM_KEYS.publicUrl]: deployedOrigin(config),
        // From the public URL IN FORCE rather than from the deployed origin: this is the one that
        // derives from another setting, and the operator's own public URL is what Icecast will see.
        // Never empty, since the hostname derivation ends at `localhost`.
        [STREAM_KEYS.hostname]: advertisedHostname(resolvePublicUrl(config), ''),
        [CLOCK_KEYS.timezone]: hostZone(),
        // Not a fallback for anything, because a note holds no value: this is the whole of what the
        // note shows, and it is here because a derived setting is the one channel that already
        // carries a value only the server can work out to the form that draws it.
        [SIGNIN_KEYS.redirectAddress]: redirectAddress(config),
    };

    return Object.fromEntries(Object.entries(derived).filter(([, value]) => value !== ''));
}

/** The sign-in redirect address, or nothing for a station that does not know its own origin. */
function redirectAddress(config: AppConfig): string {
    try {
        return oidcRedirectUri(config).href;
    } catch {
        // `APP_BASE_URL` empty leaves a path with no origin, which `URL` refuses. Nothing to show,
        // and a guessed address would be the one thing worse than none.
        return '';
    }
}

/**
 * Every setting that names the model for one kind of call, and so reaches the plugin's own default
 * while it is empty.
 *
 * Read off the registry rather than listed, by the one property they all share and nothing else
 * has: each offers the model plugin's list as its suggestions. A seventh added the same way is
 * covered without anybody remembering this file.
 */
export const MODEL_SETTING_KEYS: readonly string[] = SETTING_DESCRIPTORS.filter(
    descriptor => 'optionsFrom' in descriptor && descriptor.optionsFrom === 'llm.models',
).map(descriptor => descriptor.key);

/**
 * What an empty model setting works out to: the one model the plugin in use marks as its default,
 * under every one of them.
 *
 * Separate from {@link derivedSettings} because the answer is the model PLUGIN's rather than the
 * config's, and is asked for asynchronously. Nothing at all where the plugin does not say, on the
 * same rule as the map above: an empty string is not something to show anybody.
 */
export function derivedModels(defaultModel: string | undefined): Record<string, string> {
    if (defaultModel === undefined || defaultModel === '') return {};
    return Object.fromEntries(MODEL_SETTING_KEYS.map(key => [key, defaultModel]));
}
