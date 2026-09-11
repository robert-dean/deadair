import type { PluginInstance, PluginManifest } from '@deadair/plugin-sdk';

/**
 * Fixed status vocabulary for a plugin the host knows about. The HTTP surface
 * and the settings UI both key off these exact strings.
 *
 * - `discovered`  — a valid plugin the operator has not enabled yet.
 * - `disabled`    — enabled flag is off; the host will not instantiate it.
 * - `misconfigured` — enabled, but its stored config fails the manifest schema.
 * - `active`      — enabled, configured, instantiated and initialized.
 * - `failed`      — quarantined: discovery or initialization threw.
 */
export const PLUGIN_STATUSES = ['discovered', 'disabled', 'misconfigured', 'active', 'failed'] as const;

export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

/**
 * Where the loader found a plugin: `bundled` for a directory on the host's own list, shipped inside
 * the image, and `installed` for one found under `PLUGINS_DIR`, put there by the operator.
 *
 * Says nothing about trust. Both kinds are imported into the same process and held to the same
 * rules; being bundled buys no leniency. It is what the console shows so an operator can tell a
 * plugin they added from one the station came with.
 */
export const PLUGIN_ORIGINS = ['bundled', 'installed'] as const;

export type PluginOrigin = (typeof PLUGIN_ORIGINS)[number];

/**
 * The host's bookkeeping entry for one plugin.
 *
 * A quarantined candidate carries `status: 'failed'` plus `error` text and has
 * neither a `manifest` nor an `instance`: its code either never loaded or
 * never passed validation, so nothing about it can be trusted.
 */
export interface PluginRecord {
    /** `manifest.id` when the manifest validated; otherwise the directory name. */
    id: string;

    /** Absent on a candidate whose manifest failed to load or validate. */
    manifest?: PluginManifest;

    /** Absolute path of the plugin's directory. */
    dir: string;

    /** Which list the directory came from. Set for every record, quarantined ones included. */
    origin: PluginOrigin;

    status: PluginStatus;

    /** Operator-facing explanation, set whenever `status` is `failed` or `misconfigured`. */
    error?: string;

    /** The live object returned by the plugin's factory. Only set once `status` is `active`. */
    instance?: PluginInstance;
}
