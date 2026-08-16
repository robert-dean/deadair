import type { ConfigField } from '@deadair/plugin-sdk';
import { AIR_MODES, AIR_MODE_KEY, DEFAULT_AIR_MODE } from '#modules/playout/air.mode.js';
import { DEFAULT_TARGET_LUFS, TARGET_LUFS_KEY } from '#modules/playout/gain.js';
import { DEFAULT_TRACK_CACHE_MAX_BYTES, TRACK_CACHE_MAX_BYTES_KEY } from '#modules/playout/audio/track.cache.limit.js';
import { DEFAULT_RULES, ROTATION_KEYS } from '#modules/director/rotation.rules.js';
import { DEFAULT_TEMPLATES, TEMPLATE_KEYS, TEMPLATE_VOCABULARY } from '#modules/director/break.templates.js';
import { WELCOME_KEYS, WELCOME_TEMPLATES } from '#modules/director/welcome.writer.js';
import { NEWS_KEYS, NEWS_TEMPLATES } from '#modules/director/news.break.writer.js';
import { BULLETIN_KEYS, DEFAULT_MAX_AGE_HOURS, DEFAULT_STORY_COUNT } from '#modules/director/bulletin.source.js';
import { CLOCK_BAND_KEYS } from '#modules/director/clock.bands.js';
import { CLOCK_KEYS } from '#modules/director/clock.words.js';
import { MODEL_GENERATOR_KEYS } from '#modules/director/model.set.generator.js';
import { CHART_GENERATOR_KEYS, DEFAULT_CHART_MIX } from '#modules/director/chart.set.generator.js';
import { DEFAULT_SIMILAR_MIX, SIMILAR_GENERATOR_KEYS } from '#modules/director/similar.set.generator.js';
import { DISCOVER_DEFAULT, DISCOVER_KEY } from '#modules/director/pick.resolver.js';
import { MODEL_WRITER_KEYS } from '#modules/director/model.talk.break.writer.js';
import { LLM_PLUGIN_KEY } from '#modules/llm/llm.settings.js';
import { MODEL_FACTS_KEYS } from '#modules/enrichment/fact.extraction.service.js';
import {
    ANALYSIS_CONCURRENCY_KEY,
    ANALYSIS_LOCAL_PACE_KEY,
    ANALYSIS_PLUGIN_KEY,
    ANALYSIS_PROVIDER_PACE_KEY,
    DEFAULT_ANALYSIS_CONCURRENCY,
    DEFAULT_ANALYSIS_LOCAL_PACE_MS,
    DEFAULT_ANALYSIS_PROVIDER_PACE_MS,
} from '#modules/analysis/analysis.settings.js';
import { SPEECH_PLUGIN_KEY } from '#modules/render/speech.settings.js';
import { SCRIPT_HISTORY_DEFAULTS, SCRIPT_HISTORY_KEYS } from '#modules/render/script.history.settings.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { ACTIVITY_DEFAULTS, ACTIVITY_KEYS } from '#modules/activity/activity.settings.js';

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
        key: TEMPLATE_KEYS.djName,
        label: 'Presenter name',
        type: 'string',
        default: '',
        help: 'Who the station says it is when a phrasing asks for a name. Leave empty and the phrasings that use one simply are not used; every other one still is.',
    },
    {
        group: 'station',
        key: CLOCK_KEYS.timezone,
        label: 'Where the station is',
        type: 'string',
        default: '',
        help: "An IANA zone name such as Europe/London or America/New_York, which is what the station reads the clock in when it says the time. A station is a place and its listeners are in it, so this is deliberately not the server's zone. Leave empty to use whatever this machine is set to.",
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
        key: ACTIVITY_KEYS.retentionDays,
        label: 'Keep the activity feed for (days)',
        type: 'number',
        default: ACTIVITY_DEFAULTS.retentionDays,
        help: 'How long the station remembers its own moments: going on and off air, every time a gate silenced it, every gap that outlived the loop meant to close it. Zero keeps all of it. What aired and what the station wrote have their own lifetimes and are not touched by this.',
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
        key: DISCOVER_KEY,
        label: 'Play records the station does not own yet',
        type: 'boolean',
        default: DISCOVER_DEFAULT,
        help: 'The library holds what your playlists carry, which is a fraction of what a provider knows. With this on, a chosen record the library has never seen is looked up at your providers, taken into the catalog and played. Turning it off makes the library the boundary again: anything outside it is skipped.',
    },
    {
        group: 'rotation',
        key: CHART_GENERATOR_KEYS.mix,
        label: 'How much of each batch comes from a chart',
        type: 'number',
        default: DEFAULT_CHART_MIX,
        help: 'A share between 0 and 1 of each hour taken from a published chart rather than drawn from your library. 0 by default: a chart is a format, and installing a plugin that can serve one should not decide what your station sounds like. Needs a chart plugin installed, and needs "Play records the station does not own yet" on, because a chart names records your library almost certainly does not hold.',
    },
    {
        group: 'rotation',
        key: CHART_GENERATOR_KEYS.chart,
        label: 'Which chart',
        type: 'string',
        dependsOn: CHART_GENERATOR_KEYS.mix,
        help: 'The id of a chart one of your plugins offers, as listed at /charts. Leave it blank to use the first one on offer, or to let a broadcast brief naming a country or a genre choose between them.',
    },
    {
        group: 'rotation',
        key: SIMILAR_GENERATOR_KEYS.mix,
        label: 'How much of each batch comes from similar artists',
        type: 'number',
        default: DEFAULT_SIMILAR_MIX,
        help: 'A share between 0 and 1 of each hour taken from acts that resemble the ones just played, rather than drawn from your library. This is how a station stops sounding like it owns two hundred songs, so it is on by default — unlike the chart mix above, which is a format rather than a habit. 0 turns it off. Needs a similarity plugin installed, and needs "Play records the station does not own yet" on, because the point of it is acts your library does not hold.',
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
        key: ROTATION_KEYS.breakEveryMinutes,
        label: 'Minutes between breaks',
        type: 'number',
        default: DEFAULT_RULES.breakEveryMinutes,
        dependsOn: ROTATION_KEYS.breaks,
        help: 'Fifteen is around as long as a station can go without saying its own name before it sounds like a playlist. Each sort of break keeps its own spacing, so a news bulletin does not push the next ident back.',
    },
    {
        group: 'rotation',
        key: ROTATION_KEYS.welcome,
        label: 'Say hello to a new listener',
        type: 'boolean',
        default: DEFAULT_RULES.welcome,
        dependsOn: ROTATION_KEYS.breaks,
        help: 'Whether the station greets somebody who tunes in to an empty room, rather than leaving them to work out what they are listening to at the next break. It is held off for twenty minutes afterwards, so a phone changing networks does not get greeted twice.',
    },
    {
        group: 'rotation',
        key: WELCOME_KEYS.templates,
        label: 'What the station says to a new listener',
        type: 'text',
        default: WELCOME_TEMPLATES.join('\n'),
        dependsOn: ROTATION_KEYS.welcome,
        help:
            'One phrasing per line, in the same syntax as the breaks above, with {{greeting}} for "good morning" and the like. ' +
            'A greeting is deliberately not a back-announce: somebody who has just arrived did not hear the last record, so ' +
            "{{previous.*}} is not offered here. Empty restores the station's own.",
    },
    {
        group: 'rotation',
        key: CLOCK_BAND_KEYS.bands,
        label: 'The station clock',
        type: 'text',
        dependsOn: ROTATION_KEYS.breaks,
        placeholder: ':00 talkbreak\n:30 news\nevery 90m ident',
        help:
            'One rule per line, in the shape a radio clock is drawn in. ":30 news" is every hour at half past, ' +
            '"09:00 news" is once a day, and "every 90m ident" is a spacing rule for a sort of break the interval above does not cover. ' +
            'The kind is free text: write ":20 sponsor", drop the recordings in the segment inbox, and the station will play them. ' +
            'Empty means the station keeps its ordinary spacing and nothing else. A line starting with # is off without being lost.',
    },
    {
        group: 'rotation',
        key: BULLETIN_KEYS.stories,
        label: 'Headlines in a news bulletin',
        type: 'number',
        default: DEFAULT_STORY_COUNT,
        help: 'How many stories the station reads when the clock above asks for news. Three is a headline round; a station that stops for two minutes every half hour is a news station that plays records.',
    },
    {
        group: 'rotation',
        key: BULLETIN_KEYS.maxAgeHours,
        label: 'How old a story may be (hours)',
        type: 'number',
        default: DEFAULT_MAX_AGE_HOURS,
        help: 'Anything older than this is not read. A feed that stopped updating yesterday would otherwise have the station reading last night as though it had just happened, and a listener cannot tell that from the station being wrong. A bulletin with nothing fresh enough is skipped rather than filled.',
    },
    {
        group: 'rotation',
        key: BULLETIN_KEYS.feed,
        label: 'Which news feed',
        type: 'string',
        help: 'The id of a feed one of your plugins offers, as listed at /news/feeds. Leave it blank to read across all of them, newest first.',
    },
    {
        group: 'rotation',
        key: NEWS_KEYS.templates,
        label: 'How the station introduces the news',
        type: 'text',
        default: NEWS_TEMPLATES.join('\n'),
        help:
            'One phrasing per line, in the same syntax as the breaks below, with {{news.headlines}} for the stories themselves. ' +
            'The headlines are read as published and this decides only what is said around them, which is why every line has to carry ' +
            "{{news.headlines}} outside its [[optional]] parts. Empty restores the station's own.",
    },
    {
        group: 'rotation',
        key: ROTATION_KEYS.crossfade,
        label: 'Blend one record into the next',
        type: 'boolean',
        default: DEFAULT_RULES.crossfade,
        help: "How long each blend lasts is measured from both records rather than set here, so a record that ends cold is barely ridden and one that fades is ridden as far as the next record can absorb it. An album or a sequenced setlist ignores this and stays cold by default, because its gaps are somebody else's decision.",
    },
    {
        group: 'rotation',
        key: TEMPLATE_KEYS.templates,
        label: 'What the station says',
        type: 'text',
        default: DEFAULT_TEMPLATES.join('\n'),
        dependsOn: ROTATION_KEYS.breaks,
        help:
            'One phrasing per line, picked between so the station does not repeat itself. ' +
            `Fill in a record with ${TEMPLATE_VOCABULARY.map(name => `{{${name}}}`).join(', ')}, ` +
            'and wrap a part in [[double brackets]] to have it dropped when there is nothing to put in it. ' +
            "A line starting with # is off without being lost. Empty restores the station's own; to stop it talking, turn breaks off above.",
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
    {
        group: 'playout',
        key: TRACK_CACHE_MAX_BYTES_KEY,
        label: 'Keep at most (of the station’s own copies)',
        type: 'number',
        unit: 'bytes',
        default: DEFAULT_TRACK_CACHE_MAX_BYTES,
        help: 'The station keeps every record it fetches, so playing one twice costs one download and a record can be committed to the running order the moment its audio is here. Left empty it keeps everything, which is the old behaviour; set it and the least recently played records are dropped once the total goes over. A record about to air is never dropped, and the row is kept either way, so a record that goes is simply fetched again next time it comes round.',
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
        key: MODEL_WRITER_KEYS.enabled,
        label: 'Let a model write the talk breaks',
        type: 'boolean',
        default: false,
        help: 'With this off the station writes its own breaks from the phrasings above, which it does instantly and cannot fail at. With it on the model writes them and those phrasings become the floor underneath: a model that is slow, missing or rambling costs a better sentence rather than a silent station.',
    },
    {
        group: 'llm',
        key: MODEL_WRITER_KEYS.model,
        label: 'Model for a talk break',
        type: 'string',
        default: '',
        dependsOn: MODEL_WRITER_KEYS.enabled,
        help: "Per call rather than plugin config, so a big model for a show and a small one for a link is expressible. Leave empty for the plugin's own default.",
    },
    // Who the station sounds like was a setting here and is now a row in `deadair.personas`, with
    // its own page: a character has to reach the phrasings and the voice as well as the prompt, and
    // a `ConfigField` describes one row of a form rather than a list an operator switches between.
    {
        group: 'llm',
        key: MODEL_GENERATOR_KEYS.enabled,
        label: 'Let a model choose what plays',
        type: 'boolean',
        default: false,
        help: 'With this off the station picks by rule: a weighted draw shaped by the repeat window, the artist cooldown and your ratings. With it on the model chooses first and that draw finishes whatever it did not — a model that names six good records has done most of the job, so a partial answer is kept rather than thrown away. It can only choose records already in your library.',
    },
    {
        group: 'llm',
        key: MODEL_GENERATOR_KEYS.model,
        label: 'Model for choosing records',
        type: 'string',
        dependsOn: MODEL_GENERATOR_KEYS.enabled,
        default: '',
        help: "Separate from the talk break's model on purpose: programming an hour is a research task and writing a link is not, so the two are worth sizing differently. Leave empty for the plugin's own default.",
    },
    // What the station plays was a setting here and is now the persona's own `music` line, beside
    // the character that plays it: choosing a persona is one decision about who the station is, and
    // splitting the voice from the programming across two pages made it three.
    {
        group: 'llm',
        key: MODEL_FACTS_KEYS.enabled,
        label: 'Let a model find trivia in the articles',
        type: 'boolean',
        default: false,
        help: 'The station already keeps the opening line of every article it has read, which needs no model and cannot be wrong. With this on a model reads further in for the things that line cannot carry — a film it was used in, who played on it, what it was banned for — and a second call checks each one against the exact words that state it, dropping anything the article does not say outright. It runs in the background at the lowest priority, so a talk break always gets the model first, and it will take days rather than minutes to work through a library.',
    },
    {
        group: 'llm',
        key: MODEL_FACTS_KEYS.model,
        label: 'Model for reading articles',
        type: 'string',
        dependsOn: MODEL_FACTS_KEYS.enabled,
        default: '',
        help: "Reading is the one job here where nothing is waiting, so this is the place a slower and more careful model costs you nothing. Leave empty for the plugin's own default.",
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
    {
        group: 'analysis',
        key: ANALYSIS_PROVIDER_PACE_KEY,
        label: 'Pause after a downloaded track (ms)',
        type: 'number',
        default: DEFAULT_ANALYSIS_PROVIDER_PACE_MS,
        help: "Measuring a track the station does not already hold is a full download through the same account it plays on, and a burst of them can trip a provider's own rate limit. This is the gap the walk leaves after one of those before starting the next.",
    },
    {
        group: 'analysis',
        key: ANALYSIS_LOCAL_PACE_KEY,
        label: 'Pause after an already-local track (ms)',
        type: 'number',
        default: DEFAULT_ANALYSIS_LOCAL_PACE_MS,
        help: 'A record the station has already kept costs no provider request to measure, so this can be far shorter than the download pause above — but it is not free: it is still disk and decode time on whatever machine is running the analyzer. Set to 0 to measure the local half of the library flat out.',
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
