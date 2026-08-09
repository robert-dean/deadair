import { AppConfig } from '@maroonedsoftware/appconfig';

/** A config whose values can be changed after the thing reading it was built. */
export interface MutableConfig {
    config: AppConfig;
    /** Write a setting, as `SettingsService` and the NOTIFY reload eventually would. */
    set(key: string, value: string | undefined): void;
}

/**
 * An `AppConfig` standing in for `deadair.settings` loaded as a config layer.
 *
 * Built on `AppConfig`'s supplier form, where every read resolves against the object at call time
 * — the same mechanism `AppConfigStore.toLiveConfig()` uses in the running app. That is what makes
 * this a fair stand-in rather than a convenient one: a test can change a setting underneath a
 * singleton that is already running, which is exactly what an operator does, and code that cached
 * the value at construction fails here the same way it would in production.
 *
 * A key set to `undefined` is deleted rather than emptied, so `config.has()` answers the way it
 * does for a row that is not there.
 */
export function settingsConfig(initial: Record<string, string> = {}): MutableConfig {
    const values: Record<string, string> = { ...initial };

    return {
        config: new AppConfig(() => values),
        set(key, value) {
            if (value === undefined) delete values[key];
            else values[key] = value;
        },
    };
}
