import type { ConfigFieldOption } from './plugin.config.fields.js';
import type { PluginHost } from './plugin.host.js';

/** Result of a "does this configuration actually work?" probe. */
export interface PluginConnectionResult {
    ok: boolean;
    /** Short operator-facing explanation, shown in the settings UI either way. */
    message?: string;
}

/**
 * The part of a plugin every plugin implements, whatever its kind.
 *
 * The host calls `init` exactly once per instance, before any capability
 * method. `dispose` is called on unload, config change, or shutdown.
 */
export interface PluginLifecycle {
    init(host: PluginHost): Promise<void>;

    /**
     * Called from the settings UI's "Test connection" button.
     *
     * It is also how a quarantined plugin gets back on the station. The host
     * runs it even while your plugin's breaker is open, and `ok: true` closes
     * the breaker, so reach the provider with the saved credentials rather than
     * checking that a setting is present. Report a failure as `ok: false` with a
     * message: what the host counts as healthy is `ok`, not the call resolving.
     *
     * The host also calls it on its own while your plugin is quarantined by a
     * failure retrying could end: after a minute, then on a backoff to one call
     * every half hour. So keep it to one cheap request, and never to anything
     * that changes state on the provider.
     */
    testConnection?(): Promise<PluginConnectionResult>;

    /**
     * Live choices for your config fields, keyed by field key.
     *
     * The settings form asks once when it opens, and again when the operator hits
     * refresh. A field that comes back with options is rendered as a picker: a
     * `string` or `url` becomes free text WITH suggestions, so a value you could
     * not enumerate is still typeable, and a `select` or `multiselect` has its
     * declared options replaced by these.
     *
     * ## Why this exists
     *
     * `ConfigField.options` is fixed when the manifest is written, which is fine
     * for a closed set and useless for anything the operator's own server decides.
     * Without it the only way to learn what a server offers is to read it out of a
     * "Test connection" message and type it back in, which is a setup loop with no
     * way in: the address cannot be tested before it is saved, so a field that
     * requires one of those values cannot be filled before the address is.
     *
     * ## Notes
     *
     * Implementing this IS the opt-in; there is nothing to declare on the field.
     * Return a map rather than answering per field so the form costs one call
     * however many fields you have, and omit a key you have nothing to say about
     * rather than returning an empty array for it.
     *
     * It runs against your SAVED config, like `testConnection` does, because that
     * is the config your instance was loaded with. So the shape of a first-time
     * setup is: save what you can, refresh, choose from what comes back.
     *
     * Answer with what you have rather than throwing when an upstream is
     * unreachable: a field with no suggestions is still a field somebody can type
     * into, and a throw costs them the whole form.
     */
    suggestConfigOptions?(): Promise<Record<string, ConfigFieldOption[]>>;

    dispose?(): Promise<void>;
}
