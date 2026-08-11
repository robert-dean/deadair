import type { ConfigField } from '@deadair/plugin-sdk';
import { AIR_MODES, AIR_MODE_KEY, DEFAULT_AIR_MODE } from '#modules/playout/air.mode.js';
import { DEFAULT_TARGET_LUFS, TARGET_LUFS_KEY } from '#modules/playout/gain.js';
import { DEFAULT_RULES, ROTATION_KEYS } from '#modules/director/rotation.rules.js';
import { LLM_PLUGIN_KEY } from '#modules/llm/llm.settings.js';
import { ANALYSIS_CONCURRENCY_KEY, ANALYSIS_PLUGIN_KEY, DEFAULT_ANALYSIS_CONCURRENCY } from '#modules/analysis/analysis.settings.js';
import { SPEECH_PLUGIN_KEY } from '#modules/render/speech.settings.js';
import { SCRIPT_HISTORY_DEFAULTS, SCRIPT_HISTORY_KEYS } from '#modules/render/script.history.settings.js';
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
export const SETTING_GROUPS = ['station', 'rotation', 'playout', 'render', 'llm', 'analysis'] as const;

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
        key: STREAM_KEYS.location,
        label: 'Location',
        type: 'string',
        default: STREAM_DEFAULTS.location,
        help: 'Where the station broadcasts from, as Icecast advertises it. Leave empty to advertise none.',
    },
    {
        group: 'station',
        key: STREAM_KEYS.language,
        label: 'Language',
        type: 'string',
        default: STREAM_DEFAULTS.language,
        help: 'The language of what is broadcast, as a BCP 47 tag such as `en` or `en-GB`. Sent to Icecast with the stream.',
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

    // ── rotation ───────────────────────────────────────────────────────────────
    // How the station programmes itself when nothing more specific is asked for.
    // A lineup may override any of these for itself, and a setlist or a feature
    // ignores all of them by definition: see `resolveRules`.
    {
        group: 'rotation',
        key: ROTATION_KEYS.repeatWindowDays,
        label: 'Do not repeat a song for (days)',
        type: 'number',
        default: DEFAULT_RULES.repeatWindowDays,
        help: 'Long enough that an afternoon holds no repeats, short enough that a modest library does not run dry. 0 turns it off.',
    },
    {
        group: 'rotation',
        key: ROTATION_KEYS.artistCooldownMinutes,
        label: 'Do not repeat an artist for (minutes)',
        type: 'number',
        default: DEFAULT_RULES.artistCooldownMinutes,
        help: 'Roughly one listening session, which is the span over which hearing the same act twice is noticeable. 0 turns it off.',
    },
    {
        group: 'rotation',
        key: ROTATION_KEYS.maxPerArtist,
        label: 'Most tracks by one artist per batch',
        type: 'number',
        default: DEFAULT_RULES.maxPerArtist,
        help: '0 turns the cap off.',
    },
    {
        group: 'rotation',
        key: ROTATION_KEYS.autoExtend,
        label: 'Keep the running order topped up',
        type: 'boolean',
        default: DEFAULT_RULES.autoExtend,
        help: 'Generate more when a rotation runs short. Turning this off means the station plays what is planned and then stops.',
    },
    {
        group: 'rotation',
        key: ROTATION_KEYS.breaks,
        label: 'Let the station interrupt itself',
        type: 'boolean',
        default: DEFAULT_RULES.breaks,
        help: 'Whether the station plants its own idents and talk breaks into a rotation.',
    },
    {
        group: 'rotation',
        key: ROTATION_KEYS.breakEveryItems,
        label: 'Records between breaks',
        type: 'number',
        default: DEFAULT_RULES.breakEveryItems,
        dependsOn: ROTATION_KEYS.breaks,
        help: 'Four is about a quarter of an hour, which is around as long as a station can go without saying its own name before it sounds like a playlist. Records are counted, not items, so a second kind of break does not push the next ident back.',
    },
    {
        group: 'rotation',
        key: ROTATION_KEYS.crossfade,
        label: 'Blend one record into the next',
        type: 'boolean',
        default: DEFAULT_RULES.crossfade,
        help: "How long each blend lasts is measured from both records rather than set here, so a record that ends cold is barely ridden and one that fades is ridden as far as the next record can absorb it. An album or a sequenced setlist ignores this and stays cold by default, because its gaps are somebody else's decision.",
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
    {
        group: 'playout',
        key: TARGET_LUFS_KEY,
        label: 'Target loudness (LUFS)',
        type: 'number',
        default: DEFAULT_TARGET_LUFS,
        help: 'Where measured records are set before they air, so a quiet master and a loud one arrive at the same level. A record the station has not measured is left to the live leveller instead. Changing this needs the same number set in the stream config, which the player levels everything else against.',
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
    {
        group: 'render',
        key: SCRIPT_HISTORY_KEYS.retentionDays,
        label: 'Keep what the station wrote for (days)',
        type: 'number',
        default: SCRIPT_HISTORY_DEFAULTS.retentionDays,
        help: 'Every break the station wrote, including the attempts that came to nothing, kept for this long and then swept nightly. Zero keeps all of it. This is the only record of what was said once a segment has been rewritten or deleted, so it is worth more than it costs.',
    },

    // ── llm ────────────────────────────────────────────────────────────────────
    // Which plugin, and nothing else. The base URL, the model and the credentials
    // are that plugin's own config, the same call the speech engine's knobs got.
    {
        group: 'llm',
        key: LLM_PLUGIN_KEY,
        label: 'Think with',
        type: 'string',
        default: '',
        help: 'The plugin id the station asks for words. Leave empty when only one plugin can, and set it when several can. With none available the station still writes its own breaks, deterministically.',
    },
    {
        group: 'llm',
        key: SCRIPT_HISTORY_KEYS.capture,
        label: 'Keep the prompt and the raw answer',
        type: 'boolean',
        default: SCRIPT_HISTORY_DEFAULTS.capture,
        help: 'Stores what was sent to the model and what came back before the station tidied it, alongside every break it writes. Turn it on for an evening of tuning a prompt and off again afterwards: it is most of what the history costs, and the words themselves are kept either way.',
    },

    // ── analysis ───────────────────────────────────────────────────────────────
    // Which plugin, and how wide the walk runs. The analyzer's own address is
    // that plugin's config, the same call the speech engine's knobs got.
    {
        group: 'analysis',
        key: ANALYSIS_PLUGIN_KEY,
        label: 'Measure with',
        type: 'string',
        default: '',
        help: 'The plugin id that measures records, so the station can trim dead air and time what it says over an intro. Leave empty when only one plugin can. With none available every track still plays, unmeasured.',
    },
    {
        group: 'analysis',
        key: ANALYSIS_CONCURRENCY_KEY,
        label: 'Tracks measured at once',
        type: 'number',
        default: DEFAULT_ANALYSIS_CONCURRENCY,
        help: "Raise this only alongside the analyzer's own worker count: above it the extra requests just queue there, below it its cores sit idle. Neither side can work the other out, because the analyzer may not be on this machine.",
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
