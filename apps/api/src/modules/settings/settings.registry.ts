import type { ConfigField } from '@deadair/plugin-sdk';
import { AIR_MODES, AIR_MODE_KEY, DEFAULT_AIR_MODE } from '#modules/playout/air.mode.js';
import { SPEECH_PLUGIN_KEY } from '#modules/render/speech.settings.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';

/**
 * What a station setting is, declared once.
 *
 * Everything an operator can change about a station that is not a plugin's own
 * business lives here: its key, what to call it, what kind of input it is, and
 * what it means when nobody has set it.
 *
 * ## Why this is a plugin's `ConfigField`
 *
 * Because a plugin's settings form and a station's settings form are the same
 * problem, and the console already renders one. `ConfigField` is not a plugin
 * concept that has been borrowed — it is a declarative description of a row in a
 * settings form, it is already JSON-safe by the boundary test, it already knows
 * about `secret` (write-only, never read back) and `select` and `dependsOn`, and
 * the alternative is a second vocabulary that starts identical and drifts.
 *
 * ## What the registry deliberately is not
 *
 * It is not where a setting is READ. Reading one is `AppConfig.get`, wherever
 * you are, because `deadair.settings` is a config layer. Each module keeps its
 * own typed resolver over that (`resolveStreamSettings`, `parseAirMode`), and
 * those resolvers are what the app runs on. This describes the same keys for the
 * benefit of a human at a console, and shares their defaults so the two cannot
 * disagree.
 *
 * It is also not a complete list of what is in the table. A row nobody declared
 * here is left exactly alone: read by whatever reads it, ignored by the console,
 * and never deleted. That matters because settings arrive before their console
 * does.
 */
export interface SettingDescriptor extends ConfigField {
    /** Which section of the settings page this belongs in. */
    group: SettingGroup;
}

/** The sections the console draws, in the order it draws them. */
export const SETTING_GROUPS = ['station', 'playout', 'render'] as const;

export type SettingGroup = (typeof SETTING_GROUPS)[number];

/**
 * Every station setting there is.
 *
 * Ordered as an operator should meet them: what the station IS, then what puts
 * it on air, then how it speaks. Secrets come last within their group, because
 * they are seeded automatically and most operators never touch them.
 */
export const SETTING_DESCRIPTORS: readonly SettingDescriptor[] = [
    // ── station ────────────────────────────────────────────────────────────────
    {
        group: 'station',
        key: STREAM_KEYS.title,
        label: 'Station name',
        type: 'string',
        default: STREAM_DEFAULTS.title,
        help: 'What players and directories show. Icecast advertises it on the mount.',
    },
    {
        group: 'station',
        key: STREAM_KEYS.description,
        label: 'Description',
        type: 'string',
        default: STREAM_DEFAULTS.description,
    },
    {
        group: 'station',
        key: STREAM_KEYS.genre,
        label: 'Genre',
        type: 'string',
        default: STREAM_DEFAULTS.genre,
    },
    {
        group: 'station',
        key: STREAM_KEYS.publicUrl,
        label: 'Public URL',
        type: 'url',
        default: STREAM_DEFAULTS.publicUrl,
        help: 'Where listeners reach the station. Also where the hostname is derived from when one is not set below.',
    },
    {
        group: 'station',
        key: STREAM_KEYS.mount,
        label: 'Mount',
        type: 'string',
        default: STREAM_DEFAULTS.mount,
        help: 'The Icecast mount point, including its leading slash and extension.',
    },
    {
        group: 'station',
        key: STREAM_KEYS.bitrate,
        label: 'Bitrate (kbps)',
        type: 'string',
        default: STREAM_DEFAULTS.bitrate,
    },
    {
        group: 'station',
        key: STREAM_KEYS.hostname,
        label: 'Advertised hostname',
        type: 'string',
        default: STREAM_DEFAULTS.hostname,
        help: 'What Icecast calls itself. Leave empty to derive it from the public URL.',
    },
    {
        group: 'station',
        key: STREAM_KEYS.icecastHost,
        label: 'Icecast host',
        type: 'string',
        default: STREAM_DEFAULTS.icecastHost,
        help: 'Where the app tells Liquidsoap to publish. The compose service name, not a public address.',
    },
    {
        group: 'station',
        key: STREAM_KEYS.icecastPort,
        label: 'Icecast port',
        type: 'string',
        default: STREAM_DEFAULTS.icecastPort,
    },
    {
        group: 'station',
        key: STREAM_KEYS.listenerHooks,
        label: 'Tell the app about each listener',
        type: 'boolean',
        default: STREAM_DEFAULTS.listenerHooks,
        help: 'Keep this on unless Icecast refuses to start: url authentication needs an Icecast built with libcurl. Turning it off costs only the seconds between somebody connecting and the next stats poll.',
    },

    // ── playout ────────────────────────────────────────────────────────────────
    {
        group: 'playout',
        key: AIR_MODE_KEY,
        label: 'What puts the station on air',
        type: 'select',
        default: DEFAULT_AIR_MODE,
        options: [
            { value: 'audience', label: 'Only while somebody is listening' },
            { value: 'always', label: 'Whenever there is a running order' },
        ],
        help: 'Producing audio costs a fetch and a download per track, and an empty mount is the one case where nobody benefits from that. On "audience" a loaded station with no listeners is silent on purpose.',
    },

    // ── render ─────────────────────────────────────────────────────────────────
    {
        group: 'render',
        key: SPEECH_PLUGIN_KEY,
        label: 'Speak with',
        type: 'string',
        default: '',
        help: 'The plugin id the station talks with. Leave empty when only one plugin can speak; set it when several can, because the station declines to guess rather than airing the wrong voice.',
    },

    // ── secrets ────────────────────────────────────────────────────────────────
    // Seeded with strong random values on first boot, so an operator only ever
    // comes here to match a password something else already has. Write-only:
    // the read model reports whether one is stored and never what it is.
    {
        group: 'station',
        key: STREAM_KEYS.sourcePassword,
        label: 'Icecast source password',
        type: 'secret',
        help: 'Changing this needs Icecast restarted to adopt it.',
    },
    {
        group: 'station',
        key: STREAM_KEYS.adminPassword,
        label: 'Icecast admin password',
        type: 'secret',
    },
    {
        group: 'station',
        key: STREAM_KEYS.harborPassword,
        label: 'Harbor push password',
        type: 'secret',
    },
    {
        group: 'station',
        key: STREAM_KEYS.spotifyShimSecret,
        label: 'Track shim secret',
        type: 'secret',
    },
    {
        group: 'playout',
        key: STREAM_KEYS.playoutBridgeSecret,
        label: 'Playout bridge secret',
        type: 'secret',
        help: 'Gates the control endpoints in both directions. Without it the running order never airs.',
    },
];

/** The descriptor for one key, or `undefined` for a key nobody declared. */
export function findDescriptor(key: string): SettingDescriptor | undefined {
    return SETTING_DESCRIPTORS.find(descriptor => descriptor.key === key);
}

/** `note` fields are static help text, so they hold no value and are never submitted. */
export const isValueField = (descriptor: SettingDescriptor): boolean => descriptor.type !== 'note';

export const isSecretField = (descriptor: SettingDescriptor): boolean => descriptor.type === 'secret';

/**
 * The one place that knows the air-mode options are also the air-mode type.
 *
 * Exported so a test can assert it rather than a reader having to trust it:
 * `AIR_MODES` is what `parseAirMode` accepts, and a `select` offering anything
 * else would let the console write a value the station silently ignores.
 */
export const AIR_MODE_OPTION_VALUES: readonly string[] = AIR_MODES;
