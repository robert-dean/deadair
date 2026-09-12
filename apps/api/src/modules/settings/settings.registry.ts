import type { ConfigField } from '@deadair/plugin-sdk';
import { AIR_MODES, AIR_MODE_KEY, DEFAULT_AIR_MODE } from '#modules/playout/air.mode.js';
import {
    DEFAULT_LEVELING_ENABLED,
    DEFAULT_SPEECH_TRIM_DB,
    DEFAULT_TARGET_LUFS,
    LEVELING_ENABLED_KEY,
    SPEECH_TRIM_KEY,
    TARGET_LUFS_KEY,
} from '#modules/playout/gain.js';
import { DEFAULT_TRACK_CACHE_MAX_BYTES, TRACK_CACHE_MAX_BYTES_KEY } from '#modules/playout/audio/track.cache.limit.js';
import { DEFAULT_AUTO_EXTEND, DEFAULT_RULES, ROTATION_KEYS } from '#modules/director/rotation.rules.js';
import { DEFAULT_MAX_TRACK_SECONDS, DEFAULT_MIN_TRACK_SECONDS, TRACK_LENGTH_KEYS } from '#modules/director/track.length.js';
import { DEFAULT_TEMPLATES, TEMPLATE_KEYS, TEMPLATE_VOCABULARY } from '#modules/director/break.templates.js';
import { WELCOME_KEYS, WELCOME_TEMPLATES } from '#modules/director/welcome.writer.js';
import { NEWS_KEYS, NEWS_TEMPLATES } from '#modules/director/news.break.writer.js';
import { WEATHER_BREAK_KEYS, WEATHER_TEMPLATES } from '#modules/director/weather.break.writer.js';
import {
    DEFAULT_WEATHER_DAYS,
    DEFAULT_WEATHER_MAX_AGE_MINUTES,
    MAX_WEATHER_DAYS,
    MAX_WEATHER_MAX_AGE_MINUTES,
    MIN_WEATHER_MAX_AGE_MINUTES,
    WEATHER_SOURCE_KEYS,
} from '#modules/director/weather.source.js';
import {
    BULLETIN_KEYS,
    DEFAULT_MAX_AGE_HOURS,
    DEFAULT_STORY_COUNT_MAX,
    DEFAULT_STORY_COUNT_MIN,
    MAX_STORY_COUNT,
} from '#modules/director/bulletin.source.js';
import { NEWS_FEEDS_KEY } from '#modules/news/news.settings.js';
import { CLOCK_KEYS, NAMES_THE_TIME_DEFAULT } from '#modules/director/clock.words.js';
import { DEFAULT_UNITS, WEATHER_KEYS } from '#modules/weather/weather.keys.js';
import {
    BREAK_WORD_KEYS,
    DEFAULT_STORY_WORDS,
    MAX_BREAK_WORDS,
    MAX_STORY_WORDS,
    MIN_BREAK_WORDS,
    MIN_STORY_WORDS,
} from '#modules/director/break.words.js';
import { DEFAULT_MAX_WORDS } from '#modules/director/break.prompt.js';
import { SUSTAINING_KEYS } from '#modules/schedule/schedule.service.js';
import { DEFAULT_MAX_OUTPUT_TOKENS, MODEL_GENERATOR_DEFAULT, MODEL_GENERATOR_KEYS } from '#modules/director/model.set.generator.js';
import { CHART_GENERATOR_KEYS, DEFAULT_CHART_MIX } from '#modules/director/chart.set.generator.js';
import { DEFAULT_SIMILAR_MIX, SIMILAR_GENERATOR_KEYS } from '#modules/director/similar.set.generator.js';
import { BRIEF_ONLY_DEFAULT, BRIEF_ONLY_KEY } from '#modules/director/set.generator.chain.js';
import { DISCOVER_DEFAULT, DISCOVER_KEY } from '#modules/director/pick.resolver.js';
import { DEFAULT_SMART_SHUFFLE, DEFAULT_SMART_SHUFFLE_DAYS, SMART_SHUFFLE_DAYS_RANGE, SMART_SHUFFLE_KEYS } from '#modules/director/smart.shuffle.js';
import { ADVISORY_DEFAULT, ADVISORY_KEY } from '#modules/director/advisory.policy.js';
import { MODEL_WRITER_DEFAULT, MODEL_WRITER_KEYS } from '#modules/director/model.talk.break.writer.js';
import { LLM_PLUGIN_KEY } from '#modules/llm/llm.settings.js';
import { ALWAYS_REACH_DEFAULT, MUSIC_SEARCH_KEYS } from '#modules/llm/music.search.tool.js';
import { MODEL_FACTS_DEFAULT, MODEL_FACTS_KEYS } from '#modules/enrichment/fact.extraction.service.js';
import { PERSONA_NOTES_DEFAULT, PERSONA_NOTES_KEYS } from '#modules/personas/persona.distil.service.js';
import { PERSONA_STORIES_DEFAULT, PERSONA_STORIES_KEYS } from '#modules/personas/persona.story.pass.service.js';
import { PERSONA_MODEL_KEY } from '#modules/personas/persona.writer.js';
import {
    ANALYSIS_CONCURRENCY_KEY,
    ANALYSIS_LOCAL_PACE_KEY,
    ANALYSIS_PLUGIN_KEY,
    ANALYSIS_PROVIDER_PACE_KEY,
    DEFAULT_ANALYSIS_CONCURRENCY,
    DEFAULT_ANALYSIS_LOCAL_PACE_MS,
    DEFAULT_ANALYSIS_PROVIDER_PACE_MS,
    MAX_ANALYSIS_CONCURRENCY,
    MAX_ANALYSIS_PACE_MS,
} from '#modules/analysis/analysis.settings.js';
import { MIXER_PLUGIN_KEY } from '#modules/render/mixer.settings.js';
import { MAIL_DEFAULTS, MAIL_KEYS, MAX_MAIL_PORT, MIN_MAIL_PORT } from '#modules/mail/mail.settings.js';
import {
    PAD_DUCK_KEY,
    PAD_EVERY_BOUNDS,
    PAD_EVERY_KEY,
    PAD_GAP_BOUNDS,
    PAD_GAP_KEY,
    PAD_UNDER_BOUNDS,
    PAD_UNDER_KEY,
    PADS_KEY,
} from '#modules/render/pad.settings.js';
import { SPEECH_PLUGIN_KEY } from '#modules/render/speech.settings.js';
import { SCRIPT_HISTORY_DEFAULTS, SCRIPT_HISTORY_KEYS } from '#modules/render/script.history.settings.js';
import {
    DEFAULT_DIALOGUE_KINDS,
    DEFAULT_DIALOGUE_MINUTES_MAX,
    DEFAULT_DIALOGUE_MINUTES_MIN,
    DEFAULT_GAP_MS,
    DEFAULT_TARGET_MINUTES_MAX,
    DEFAULT_TARGET_MINUTES_MIN,
    DEFAULT_WRITING_MODE,
    MAX_GAP_MS,
    MAX_PRODUCTION_MINUTES,
    MIN_GAP_MS,
    MIN_PRODUCTION_MINUTES,
    PRODUCTION_KEYS,
} from '#modules/productions/production.settings.js';
import { AAC_BITRATES, MP3_BITRATES, OPUS_BITRATES, STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
// Deliberately NOT in `STREAM_KEYS`: that set is what `isStreamSettingKey` marks as needing the
// stream config re-rendered and the audio chain restarted, and this one is read per request by a
// middleware. Putting it there would bounce Liquidsoap to change a list the app alone consults.
import { HLS_REFUSE_DEFAULT, HLS_REFUSE_KEY } from '#modules/stream/hls.refusal.js';
import { ACTIVITY_DEFAULTS, ACTIVITY_KEYS } from '#modules/activity/activity.settings.js';
import { DEFAULT_SWEEP_MAX_PERCENT, SWEEP_MAX_PERCENT_KEY } from '#modules/catalog/ingest/catalog.sweep.guard.js';

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
    /**
     * Which part of the console owns this setting.
     *
     * A section of the settings page for all but two of them. `schedule` and `personas` are the
     * exceptions and are deliberately not drawn there: what the station plays between blocks is a
     * question about the timetable, and what an unnamed host is called is a question about the
     * roster, so each is edited beside the thing it explains, by a panel that draws its own controls.
     * See the groups' own note below.
     */
    group: SettingGroup;
}

/**
 * The groups there are, in the order the settings page draws the ones it draws.
 *
 * Not every group is a card on that page. `schedule` is owned by `SustainingPanel` on the schedule
 * page and `personas` by `PresenterNamePanel` on the characters page, which is why
 * `SETTINGS_SECTIONS` in `settings.shell.tsx` is a list of its own rather than this one: a
 * group that is not in that list is drawn by whoever claimed it, and a group in neither is a bug
 * `settings.registry.test.ts` cannot see. Adding one means deciding which page draws it.
 *
 * `station`, `stream` and `housekeeping` were one group until it grew to thirty-one fields under a
 * single save: ten identity fields, fifteen stream formats and HLS settings, two pieces of
 * housekeeping and four passwords, each of them a different reason to open the page. Split along
 * `SettingGroup` in `settings.types.ck`, so the wire enum and this list cannot disagree about what
 * a group is called. The passwords were a fourth group, `secrets`, until none of them was declared
 * any more; the note above `mail` below says why.
 */
export const SETTING_GROUPS = [
    'station',
    'stream',
    'housekeeping',
    'mail',
    'rotation',
    'playout',
    'render',
    'llm',
    'analysis',
    'schedule',
    'personas',
] as const;

export type SettingGroup = (typeof SETTING_GROUPS)[number];

/**
 * Every station setting there is.
 *
 * Ordered as an operator should meet them: what the station IS, then what puts
 * it on air, then how it speaks. The secrets the station seeds for itself are
 * deliberately absent; see the note where they used to be, above `mail`.
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
        key: WEATHER_KEYS.location,
        label: 'Where the station is',
        type: 'string',
        default: '',
        placeholder: 'Atlanta, Georgia',
        help:
            'A town or city, as you would say it on air. The station reports the weather here unless a break asks for somewhere else, so a fresh ' +
            'install needs nothing but this. Leave it empty and the station simply never mentions the weather.',
    },
    {
        group: 'station',
        key: WEATHER_KEYS.units,
        label: 'Units',
        type: 'select',
        default: DEFAULT_UNITS,
        options: [
            { value: 'metric', label: 'Celsius and km/h' },
            { value: 'imperial', label: 'Fahrenheit and mph' },
        ],
        help: 'What the station says its measurements in. Whichever service answers, this is what a listener hears.',
    },
    {
        group: 'station',
        key: CLOCK_KEYS.timezone,
        // Named for the CLOCK rather than for the place, now that the place above
        // has the other name. Both were called "Where the station is", which is
        // one label doing two jobs: a station in Atlanta reads its clock in
        // America/New_York, and neither box can be filled in from the other.
        label: 'Station timezone',
        type: 'string',
        default: '',
        // Suggestions rather than a `select`, on the console's own rule for these: the list is what
        // the OPERATOR's browser knows, and a zone their server knows and their browser does not
        // has to stay typeable. What it buys is that `Europe/Lundon` is visibly not on the list at
        // the moment it is typed, where today `stationZone` deliberately lets it through and
        // `Intl.DateTimeFormat` throws at the first break that tries to say the time.
        optionsFrom: 'intl.timeZones',
        help: "An IANA zone name such as Europe/London or America/New_York, which is what the station reads the clock in when it says the time. A station is a place and its listeners are in it, so this is deliberately not the server's zone. Leave empty to use whatever this machine is set to.",
    },
    {
        group: 'station',
        key: CLOCK_KEYS.namesTheTime,
        label: 'Let the station say the hour',
        type: 'boolean',
        default: NAMES_THE_TIME_DEFAULT,
        help: 'A break that says "just after half past four" is only true for a few minutes, so the station checks the clock before airing it and drops it if the running order arrived early. While the order runs ahead of what the station projects, that check costs almost every break that names an hour. With this off the station still says "this afternoon", which stays true for hours. Turn it back on once breaks stop being dropped for reaching their slot early.',
    },

    // ── stream ─────────────────────────────────────────────────────────────────
    {
        group: 'stream',
        key: STREAM_KEYS.bitrate,
        label: 'Bitrate (kbps)',
        type: 'string',
        default: STREAM_DEFAULTS.bitrate,
        // Suggestions, not a closed set, and that is the difference between this and the two
        // bitrates below: `%mp3(bitrate=…)` in `radio.liq` takes an `int_of_string`, so anything
        // typed here is honoured, where `%opus` and `%fdkaac` want a literal at parse time and are
        // therefore a menu. Offering the usual figures costs nothing and rules nothing out.
        options: MP3_BITRATES.map(value => ({ value, label: `${value} kbps` })),
        help: 'The MP3 mount, which every listener can play and which is the one the station is always on. The usual figures are offered; unlike the formats below, anything you type here is honoured.',
    },
    {
        group: 'stream',
        key: STREAM_KEYS.opusEnabled,
        label: 'Also publish Opus',
        type: 'boolean',
        default: STREAM_DEFAULTS.opusEnabled,
        help: 'The best quality per bit of any format here, and the one for a browser or a modern player. Hardware radios and car head units generally cannot play it, which is why MP3 stays whatever you choose here. The mount is the MP3 one with its extension swapped.',
    },
    {
        group: 'stream',
        key: STREAM_KEYS.opusBitrate,
        label: 'Opus bitrate (kbps)',
        type: 'select',
        default: STREAM_DEFAULTS.opusBitrate,
        options: OPUS_BITRATES.map(value => ({ value, label: `${value} kbps` })),
        help: 'A fixed set rather than free text, because the encoder takes this figure when the stream script is read and not as something it can be handed later.',
    },
    {
        group: 'stream',
        key: STREAM_KEYS.aacEnabled,
        label: 'Also publish AAC',
        type: 'boolean',
        default: STREAM_DEFAULTS.aacEnabled,
        help: 'The format that widens hardware reach: a Sonos takes MP3 or AAC and nothing else, and most players that cannot manage Opus can manage this.',
    },
    {
        group: 'stream',
        key: STREAM_KEYS.aacBitrate,
        label: 'AAC bitrate (kbps)',
        type: 'select',
        default: STREAM_DEFAULTS.aacBitrate,
        options: AAC_BITRATES.map(value => ({ value, label: `${value} kbps` })),
    },
    {
        group: 'stream',
        key: STREAM_KEYS.flacEnabled,
        label: 'Also publish FLAC',
        type: 'boolean',
        default: STREAM_DEFAULTS.flacEnabled,
        help: 'Lossless, and worth having only when the records themselves are: a FLAC of a decoded lossy file is a perfect copy of a lossy file at seven times the bandwidth. Costs roughly 900 kbps per listener.',
    },
    {
        group: 'stream',
        key: STREAM_KEYS.hlsEnabled,
        label: 'Also publish an HLS stream',
        type: 'boolean',
        default: STREAM_DEFAULTS.hlsEnabled,
        help: 'One address, carrying AAC, that survives a phone moving between wifi and mobile: the mounts above are a single connection that dies with the network, while this is ordinary web requests a player simply retries. Costs a few seconds more delay than the mounts, and one more encoder.',
    },
    {
        group: 'stream',
        key: HLS_REFUSE_KEY,
        label: 'Players the station will not serve',
        type: 'string',
        default: HLS_REFUSE_DEFAULT,
        help: 'Names from a player\'s "user agent", separated by spaces — anything matching is answered with a refusal and is not counted as a listener. Leave empty unless something is streaming that should not be: with the station set to air only while somebody is listening, one program fetching the stream around the clock keeps it broadcasting to nobody. Use the short product name, such as `Lavf/` or `Go-http-client`, so it keeps matching when that thing updates.',
    },
    {
        group: 'stream',
        key: STREAM_KEYS.hlsSegmentSeconds,
        label: 'HLS segment length (seconds)',
        type: 'number',
        default: STREAM_DEFAULTS.hlsSegmentSeconds,
        // The bounds `resolveStreamSettings` clamps a stored row to, shared for the reason
        // every default in this file is shared.
        min: 1,
        max: 10,
        help: 'Shorter segments put a listener closer to live and cost one more request each, per listener. Below about two seconds most players stop keeping up.',
    },
    {
        group: 'stream',
        key: STREAM_KEYS.hlsSegmentCount,
        label: 'HLS segments in the playlist',
        type: 'number',
        default: STREAM_DEFAULTS.hlsSegmentCount,
        min: 3,
        max: 20,
        help: 'How much a player is told about at once. More is more delay and more tolerance of a bad connection; fewer is the opposite. Segment length multiplied by this is roughly how far behind live a listener starts.',
    },
    // How Icecast describes the station to players and directories. These were on the Station card,
    // beside the name, which made them read as the station's identity; nothing but Icecast and the
    // headers Liquidsoap sends it reads any of them, so they sit with the hostname, location and
    // language that are the same kind of thing.
    {
        group: 'stream',
        key: STREAM_KEYS.publicUrl,
        label: 'Public URL',
        type: 'url',
        default: STREAM_DEFAULTS.publicUrl,
        help: 'Where listeners reach the station. Also where the hostname is derived from when one is not set below.',
    },
    {
        group: 'stream',
        key: STREAM_KEYS.hostname,
        label: 'Advertised hostname',
        type: 'string',
        default: STREAM_DEFAULTS.hostname,
        help: 'What Icecast calls itself. Leave empty to derive it from the public URL.',
    },
    {
        group: 'stream',
        key: STREAM_KEYS.description,
        label: 'Description',
        type: 'string',
        default: STREAM_DEFAULTS.description,
        help: 'A line about the station, as Icecast advertises it. Players and directories that show one show it under the name.',
    },
    {
        group: 'stream',
        key: STREAM_KEYS.genre,
        label: 'Genre',
        type: 'string',
        default: STREAM_DEFAULTS.genre,
        help: 'The genre Icecast advertises for the station, which players and directories show beside the name.',
    },
    {
        group: 'stream',
        key: STREAM_KEYS.location,
        label: 'Location',
        type: 'string',
        default: STREAM_DEFAULTS.location,
        help: 'Where the station broadcasts from, as Icecast advertises it. Leave empty to advertise none.',
    },
    {
        group: 'stream',
        key: STREAM_KEYS.language,
        label: 'Language',
        type: 'string',
        default: STREAM_DEFAULTS.language,
        help: 'The language of what is broadcast, as a BCP 47 tag such as `en` or `en-GB`. Sent to Icecast with the stream.',
    },
    {
        group: 'stream',
        key: STREAM_KEYS.icecastHost,
        label: 'Icecast host',
        type: 'string',
        default: STREAM_DEFAULTS.icecastHost,
        help: 'Where the app tells Liquidsoap to publish. The compose service name, not a public address.',
    },
    {
        group: 'stream',
        key: STREAM_KEYS.icecastPort,
        label: 'Icecast port',
        // A number rather than free text, so `serializeSetting` refuses one that is not. The stored
        // ROW is unchanged — it writes `String(8000)` into the same text column, and
        // `resolveStreamSettings` still reads it as the string it always was — so the only
        // difference is where a typo stops: in front of the operator, rather than in the config
        // Liquidsoap is handed on its next restart.
        type: 'number',
        // `Number(...)` rather than a literal, so this stays tied to the resolver's own fallback
        // the way every default in this file is. A `number` field needs a numeric default or the
        // console draws an empty box for a station that has never set one: `parseSetting` answers
        // an unstored key with the descriptor's default verbatim.
        default: Number(STREAM_DEFAULTS.icecastPort),
        min: 1,
        max: 65535,
    },

    // ── housekeeping ───────────────────────────────────────────────────────────
    {
        group: 'housekeeping',
        key: ACTIVITY_KEYS.retentionDays,
        label: 'Keep the activity feed for (days)',
        type: 'number',
        default: ACTIVITY_DEFAULTS.retentionDays,
        help: 'How long the station remembers its own moments: going on and off air, every time a gate silenced it, every gap that outlived the loop meant to close it. Zero keeps all of it. What aired and what the station wrote have their own lifetimes and are not touched by this.',
    },
    {
        group: 'housekeeping',
        key: SWEEP_MAX_PERCENT_KEY,
        label: 'Most of a library one sync may retire (%)',
        type: 'number',
        default: DEFAULT_SWEEP_MAX_PERCENT,
        // The same bounds `resolveSweepMaxPercent` clamps a stored row to, shared for the reason
        // every default in this file is shared.
        min: 1,
        max: 100,
        control: 'slider',
        help: 'Each hour the station asks a music source what it still has, and stops offering whatever is no longer there. If a source suddenly does not recognise more than this much of what the station holds — which is what a library server renumbering its own ids looks like, not a library being deleted — the station refuses rather than throwing the lot away. Set it to 100 to retire whatever a sync did not see. Copies that really have gone are still dropped one at a time when their audio does not arrive.',
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
        key: SMART_SHUFFLE_KEYS.enabled,
        label: 'Smart shuffle',
        type: 'boolean',
        default: DEFAULT_SMART_SHUFFLE,
        help:
            'Records the station has aired lately are less likely to be drawn again soon, so the rotation works through more of your library ' +
            'before it comes back round. It is a lean and never a refusal: anything outside the repeat window above can still be drawn, and a ' +
            'small library still plays everything it holds. It shapes the draw from your own library, and the similarity mix takes a fresher record ' +
            'from each similar artist rather than always their best known. Off, the draw is a plain random one that favours only what you have liked.',
    },
    {
        group: 'rotation',
        key: SMART_SHUFFLE_KEYS.days,
        label: 'How long a record stays cold after it airs (days)',
        type: 'number',
        default: DEFAULT_SMART_SHUFFLE_DAYS,
        // The resolver clamps a stored row into this range, so the console refuses the same figures
        // rather than accepting one the draw is not running on. The ceiling is the play history's own
        // retention: past it, a record that aired is indistinguishable from one that never did.
        min: SMART_SHUFFLE_DAYS_RANGE.min,
        max: SMART_SHUFFLE_DAYS_RANGE.max,
        dependsOn: SMART_SHUFFLE_KEYS.enabled,
        help:
            'A record that has just aired starts at a quarter of its usual chance of being drawn and warms up evenly until this many days ' +
            'have passed, when it is back to full. A fortnight suits most libraries. Play history is kept for 120 days, so that is the longest this can be.',
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
        key: ROTATION_KEYS.maxPerAlbum,
        label: 'Most tracks off one release per batch',
        type: 'number',
        default: DEFAULT_RULES.maxPerAlbum,
        help: '0 turns the cap off.',
    },
    {
        group: 'rotation',
        key: TRACK_LENGTH_KEYS.minTrackSeconds,
        label: 'Shortest record the station will play (seconds)',
        type: 'number',
        default: DEFAULT_MIN_TRACK_SECONDS,
        help: 'A record shorter than this is not drawn and not aired, even by name. 60 is a reasonable floor against an interlude or a jingle nobody meant to programme. 0 turns it off.',
    },
    {
        group: 'rotation',
        key: TRACK_LENGTH_KEYS.maxTrackSeconds,
        label: 'Longest record the station will play (seconds)',
        type: 'number',
        default: DEFAULT_MAX_TRACK_SECONDS,
        help: 'A record longer than this is not drawn and not aired, even by name. 900 is a reasonable ceiling against an hour-long mix or a DJ set the catalog mistook for a single track. A record of unknown length is always let through. 0 turns it off.',
    },
    {
        group: 'rotation',
        key: ROTATION_KEYS.autoExtend,
        label: 'Keep the running order topped up',
        type: 'boolean',
        default: DEFAULT_AUTO_EXTEND,
        help: 'What a new broadcast does when it runs short, unless you say otherwise when you start one. Turning this off means a broadcast plays what is planned and then stops. It never overrules a broadcast that is already on air.',
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
        key: ADVISORY_KEY,
        label: 'Explicit content',
        type: 'select',
        default: ADVISORY_DEFAULT,
        options: [
            { value: 'prefer-explicit', label: 'Play the original version' },
            { value: 'prefer-clean', label: 'Prefer a clean version where there is one' },
            { value: 'clean-only', label: 'Only play records marked clean' },
        ],
        help:
            'Where a record exists both ways, which one the station reaches for. Most music has no clean version at all, ' +
            'so "prefer a clean version" is a lean rather than a promise: it still plays the original when that is all there is. ' +
            '"Only play records marked clean" is the promise, and it is strict on purpose — a record is played only if a ' +
            'provider actually said it was clean, so anything unmarked is skipped. Read what that costs you: most sources ' +
            'never say, and a library from one of those has nothing marked at all, so the station would play nothing. ' +
            'It also cannot override your own account: if the account the audio comes from has explicit content turned ' +
            'off, that decision is above this one, and the plugin says so when it connects.',
    },
    {
        group: 'rotation',
        key: CHART_GENERATOR_KEYS.mix,
        label: 'How much of each batch comes from a chart',
        type: 'number',
        default: DEFAULT_CHART_MIX,
        // The range the generator's own `readMix` clamps a stored row to, which until now was
        // documented in the help text below and enforced nowhere an operator could see: the route
        // took 5 and the generator quietly ran at 1. Declared, it is refused in front of them.
        unit: 'fraction',
        min: 0,
        max: 1,
        step: 0.05,
        control: 'slider',
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
        key: BRIEF_ONLY_KEY,
        label: 'A brief is binding',
        type: 'boolean',
        default: BRIEF_ONLY_DEFAULT,
        help: 'Only applies while a broadcast has a brief. Normally, whatever the model and the charts cannot fill is finished by an ordinary weighted draw from your library, which has no way to read what you asked for — so an hour briefed "flamenco guitar" can end in whatever else you own. With this on the station leaves those slots empty instead and the hour runs short, which eventually means silence. Turn it on if a wrong record is worse to you than no record. The activity feed says whenever this actually cost the station something.',
    },
    {
        group: 'rotation',
        key: SIMILAR_GENERATOR_KEYS.mix,
        label: 'How much of each batch comes from similar artists',
        type: 'number',
        default: DEFAULT_SIMILAR_MIX,
        // The chart mix's range, for the chart mix's reason. Each generator holds its own copy of
        // the same `readMix`, so this is one declaration standing in front of two clamps.
        unit: 'fraction',
        min: 0,
        max: 1,
        step: 0.05,
        control: 'slider',
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
        key: BREAK_WORD_KEYS.talk,
        label: 'Words a talk break may run to',
        type: 'number',
        default: DEFAULT_MAX_WORDS,
        dependsOn: ROTATION_KEYS.breaks,
        // The bounds `resolveBreakWords` clamps a stored row to, shared for the reason every default
        // in this file is shared. The FLOOR is the one that matters: the ceiling is not an
        // instruction and a model stops where it stops, but a break refused for being longer than
        // three words falls to the phrasings every time with nothing saying why.
        min: MIN_BREAK_WORDS,
        max: MAX_BREAK_WORDS,
        step: 10,
        control: 'slider',
        help: 'How long the presenter may talk between two records. Forty is about fifteen seconds, which is a link rather than a monologue — and it is a ceiling rather than a target, so raising it lets a character run where it has something to say instead of making every break longer. A persona given latitude of its own still gets whichever is the greater.',
    },
    {
        group: 'rotation',
        key: BREAK_WORD_KEYS.story,
        label: 'Words a story may run to',
        type: 'number',
        default: DEFAULT_STORY_WORDS,
        dependsOn: ROTATION_KEYS.breaks,
        min: MIN_STORY_WORDS,
        max: MAX_STORY_WORDS,
        step: 10,
        control: 'slider',
        help: 'How long the presenter may take over one of their own stories, when your clock asks for one. A hundred and twenty words is around three quarters of a minute. Stories are written on each persona; a character with none passes the slot over rather than filling it.',
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
        key: ROTATION_KEYS.callins,
        label: 'Take calls',
        type: 'boolean',
        default: DEFAULT_RULES.callins,
        help: 'Whether somebody phones in while the station is on air. A call is a short programme rather than a break: your host takes it, a caller answers, and the few turns go into the running order as one block, each in its own voice. Who rings is drawn from the callers on the personas page, least recently heard first, so a station with none simply never takes one. Deliberately NOT under the breaks switch — a station that wants a DJ has said nothing about whether it wants a phone-in.',
    },
    {
        group: 'rotation',
        key: ROTATION_KEYS.callinEveryMinutes,
        label: 'Minutes between calls',
        type: 'number',
        default: DEFAULT_RULES.callinEveryMinutes,
        dependsOn: ROTATION_KEYS.callins,
        min: 1,
        max: 720,
        help: 'Airtime between one call ending and the next being asked for. Its own number rather than the break spacing, because a call runs minutes where a break runs seconds: at the break spacing the station would be on the phone for a fifth of the hour. The first call of a broadcast is not made to wait — the count starts once one has aired.',
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
        key: BULLETIN_KEYS.storiesMin,
        label: 'Headlines in a news bulletin',
        type: 'number',
        min: 1,
        max: MAX_STORY_COUNT,
        default: DEFAULT_STORY_COUNT_MIN,
        // The two ends of one range, so one control with two handles. `storiesMax` keeps its own
        // key, its own row and its own refusal by name; what it loses is a box of its own.
        //
        // The ONLY pair drawn this way, and the reason is the width: one to eight is a track whose
        // every position is a bulletin somebody might want, where the two production lengths below
        // span one to a hundred and twenty and sit in the first tenth of it. What this buys is
        // legibility rather than correctness — `howManyStories` reads the ends as an unordered pair
        // and sorts them, exactly as `stationTargetMs` does, so an inverted range was never obeyed
        // by either of them.
        rangeWith: BULLETIN_KEYS.storiesMax,
        help: 'How many stories the station reads when the clock asks for news. A range rather than a number, because the story count is what makes one bulletin longer than the next — a fixed one is a news round that is the same shape every half hour. Around three is a headline round; a station that stops for two minutes every half hour is a news station that plays records. Put both handles on the same number for a bulletin that is always the same length.',
    },
    {
        group: 'rotation',
        key: BULLETIN_KEYS.storiesMax,
        // Not drawn on its own: the console gives this end the far handle of the control above. The
        // label is what `serializeSetting` calls it when it refuses one, so it still has to read as
        // a whole setting rather than as "the other end".
        label: 'Headlines in a news bulletin, most',
        type: 'number',
        min: 1,
        max: MAX_STORY_COUNT,
        default: DEFAULT_STORY_COUNT_MAX,
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
        key: NEWS_FEEDS_KEY,
        label: 'The feeds a bulletin reads',
        type: 'list',
        placeholder: 'No feeds listed, so a bulletin reads every feed the station has, newest first.',
        // One column, because a row here IS a feed. The choices are the feeds the plugins currently
        // offer, resolved by the console — the cell stores the qualified id and shows the operator's
        // own name for it, which is the only form they have ever seen. It replaced a free-text box
        // holding one id typed by hand off another page, blank on every install that had one.
        columns: [{ key: 'feed', label: 'Feed', type: 'select', required: true, optionsFrom: 'station.newsFeeds' }],
        help:
            'The bulletin reads one story from each of these in turn, in this order, so a publisher who posts twenty times a day cannot crowd ' +
            'out one who posts three. A feed with nothing new is skipped and the next takes its place. Leave the list empty and the station ' +
            'reads every feed it has, newest first; a feed that is not listed is not read out, though it is still shown on the news page and ' +
            'still offered to the presenter.',
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
        key: WEATHER_SOURCE_KEYS.days,
        label: 'How far ahead the weather looks',
        type: 'number',
        min: 0,
        max: MAX_WEATHER_DAYS,
        default: DEFAULT_WEATHER_DAYS,
        help:
            "Days. One is today's high alongside the conditions now, which is what a station between two records says. Zero is the conditions " +
            "alone. More than one is only read by a model, since the station's own phrasings mention today and no further.",
    },
    {
        group: 'rotation',
        key: WEATHER_SOURCE_KEYS.maxAgeMinutes,
        label: 'How old a reading may be (minutes)',
        type: 'number',
        min: MIN_WEATHER_MAX_AGE_MINUTES,
        max: MAX_WEATHER_MAX_AGE_MINUTES,
        default: DEFAULT_WEATHER_MAX_AGE_MINUTES,
        help:
            'Measured at the moment the break AIRS, not when it was written: a break is written several records ahead of its slot, so a reading ' +
            'that was fresh at the keyboard can be stale on air. Anything older than this is not reported, and the slot is passed over rather ' +
            "than filled with this morning's weather. Two hours is generous on purpose — a national service can be most of an hour behind before " +
            'the station ever sees a reading, and a tighter setting silences the weather on a station that is working.',
    },
    {
        group: 'rotation',
        key: WEATHER_BREAK_KEYS.templates,
        label: 'How the station gives the weather',
        type: 'text',
        default: WEATHER_TEMPLATES.join('\n'),
        help:
            'One phrasing per line, in the same syntax as the news above, with {{weather.report}} for the reading itself and ' +
            '{{weather.place}} for where it is about. The reading is a whole sentence built from what the service measured, so every line has ' +
            "to carry {{weather.report}} outside its [[optional]] parts and after a full stop. Empty restores the station's own.",
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
        help: 'Where measured records are set before they air, so a quiet master and a loud one arrive at the same level. A record the station has not measured is left to the live leveller instead. Changing this needs the same number set in the stream config, which the player levels everything else against. Still used for the DJ even with the switch below off — nothing else corrects a break.',
    },
    {
        group: 'playout',
        key: LEVELING_ENABLED_KEY,
        label: 'Level records to the target above',
        type: 'boolean',
        default: DEFAULT_LEVELING_ENABLED,
        help: 'With this off, a record plays at whatever its own master happens to sit at instead of being corrected to the target loudness above — a quiet 1970s pressing next to a loud modern one will sit at very different volumes. The live leveller in the stream keeps running either way, so this is not the same as raw and uncorrected; it only turns off the precomputed per-record correction. Does not affect the DJ, who is always corrected.',
    },
    {
        group: 'playout',
        key: SPEECH_TRIM_KEY,
        label: 'Keep the DJ under the music by (dB)',
        type: 'number',
        default: DEFAULT_SPEECH_TRIM_DB,
        help: 'How far under the target loudness a break is aimed. Levelled to exactly the figure the records sit at, a voice arrives on top of them: loudness is a gated average and speech is the denser, more continuous signal. Raise it for a DJ that still jumps out of the hour, lower it for one that disappears, and a negative number puts the voice over the music instead. It applies from the next break, with no restart.',
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
        optionsFrom: 'plugins.speech',
        help: 'Leave it empty and the station uses the first by id, and the log says which.',
    },
    {
        group: 'render',
        key: MIXER_PLUGIN_KEY,
        label: 'Join audio with',
        type: 'string',
        default: '',
        optionsFrom: 'plugins.mixer',
        help: 'The plugin id that makes one piece of audio out of several, which is what lets a programme written turn by turn air as a single item with a pause you chose between the turns. Its own key rather than the measurement one, so a station can measure with one engine and join with another. Leave empty when only one plugin can. With none available a programme simply airs as its separate parts.',
    },
    {
        group: 'render',
        key: PADS_KEY,
        label: 'Let the station use its soundboard',
        type: 'boolean',
        default: true,
        help: 'Whether a presenter with a board may hit a pad at all. On covers both halves \u2014 a character being told what it has to hand, and the station putting one in by itself when the words were written without a model. A character with no board is unaffected either way.',
    },
    {
        group: 'render',
        key: PAD_EVERY_KEY,
        label: 'Put one in every N breaks',
        type: 'number',
        default: PAD_EVERY_BOUNDS.default,
        min: PAD_EVERY_BOUNDS.min,
        max: PAD_EVERY_BOUNDS.max,
        control: 'slider',
        help: 'How far apart the station puts a soundboard hit into a break it wrote without a model. Zero switches that off while leaving a character free to reach for one itself. Lower than about four and the station is a jingle package rather than a presenter: a hit every other break is a noise roughly every ninety seconds of speech.',
    },
    {
        group: 'render',
        key: PAD_GAP_KEY,
        label: 'Space around a soundboard hit (ms)',
        type: 'number',
        default: PAD_GAP_BOUNDS.default,
        min: PAD_GAP_BOUNDS.min,
        max: PAD_GAP_BOUNDS.max,
        help: 'How much silence sits either side of a drop when a break is joined around one. Much shorter than the pause between a production\u2019s turns, and for the opposite reason: a rimshot lands on the beat after the line, and a fifth of a second in front of it is a presenter who missed their own cue. Zero butts it straight against the words.',
    },
    {
        group: 'render',
        key: PAD_UNDER_KEY,
        label: 'Land a hit under the words by (ms)',
        type: 'number',
        default: PAD_UNDER_BOUNDS.default,
        min: PAD_UNDER_BOUNDS.min,
        max: PAD_UNDER_BOUNDS.max,
        help: 'Zero is a sting: the sound follows the line. Above zero it starts that far before the words end and plays ON them, with nothing moved \u2014 which is funnier when it lands and is a timing judgement about your own phrasings rather than one the station can make for you. A hit at the very start of a break always follows, because there are no words in front of it.',
    },
    {
        group: 'render',
        key: PAD_DUCK_KEY,
        label: 'Duck the words under a hit by (dB)',
        type: 'number',
        default: 0,
        min: -24,
        max: 0,
        control: 'slider',
        help: 'How far to pull the speech down for the length of an overlaid hit, and only for that. Zero is right for the short loud drop this is nearly always used for: ducking under a rimshot that did not need it makes the presenter sound like they flinched. Worth setting for something longer running under a break.',
    },
    {
        group: 'render',
        key: SCRIPT_HISTORY_KEYS.retentionDays,
        label: 'Keep what the station wrote for (days)',
        type: 'number',
        default: SCRIPT_HISTORY_DEFAULTS.retentionDays,
        help: 'Every break the station wrote, including the attempts that came to nothing, kept for this long and then swept nightly. Zero keeps all of it. This is the only record of what was said once a segment has been rewritten or deleted, so it is worth more than it costs.',
    },
    {
        group: 'render',
        key: PRODUCTION_KEYS.writingMode,
        label: 'How much to write a production',
        type: 'select',
        options: [
            { value: 'quick', label: 'Quick — one draft per beat' },
            { value: 'outlined', label: 'Outlined — plan it, then write it' },
            { value: 'polished', label: 'Polished — plan, write, then check and fix' },
        ],
        default: DEFAULT_WRITING_MODE,
        help: 'How many passes a production gets when nobody says otherwise. The outline is what makes something a programme rather than a run of beats; the check is arithmetic rather than another opinion, and it costs one more model call per beat that failed something. Each production can override this when it is asked for.',
    },
    {
        group: 'render',
        key: PRODUCTION_KEYS.targetMinutesMin,
        label: 'How long a production runs, shortest (minutes)',
        type: 'number',
        // Deliberately NOT a `rangeWith` pair, unlike the news headlines above, and the difference
        // is the width rather than the shape: 1 to 120 with a station sitting at 8 to 12 puts both
        // handles in the first tenth of a track, so nine tenths of it is unreachable ground and the
        // exact figure an operator has in mind is a pixel. `MAX_PRODUCTION_MINUTES` is a TYPO GUARD
        // — two hours is where a length becomes a block nothing can be scheduled around — and a
        // guard makes a bad extent for a control. Nothing is lost by leaving these as boxes:
        // `stationTargetMs` reads the two ends as an unordered pair, so a range typed the wrong way
        // round is sorted rather than obeyed.
        min: MIN_PRODUCTION_MINUTES,
        max: MAX_PRODUCTION_MINUTES,
        default: DEFAULT_TARGET_MINUTES_MIN,
        help: 'The length a production is commissioned at, which decides how many beats it has and how long each one is. A range rather than a number, because a strand that is always exactly the same length is the one thing about a schedule a listener notices without being able to say why. Nothing about the timing is left to the model: asked to decide for itself it gives one subject one beat, which at ten minutes is a single beat asked to carry more words than any one answer contains.',
    },
    {
        group: 'render',
        key: PRODUCTION_KEYS.targetMinutesMax,
        label: 'How long a production runs, longest (minutes)',
        type: 'number',
        min: MIN_PRODUCTION_MINUTES,
        max: MAX_PRODUCTION_MINUTES,
        default: DEFAULT_TARGET_MINUTES_MAX,
        help: 'The other end. Set both to the same number for a strand that is always the same length.',
    },
    {
        group: 'render',
        key: PRODUCTION_KEYS.dialogueMinutesMin,
        label: 'How long a call-in runs, shortest (minutes)',
        type: 'number',
        // Boxes for the reason the pair above is, and more so: a call sits at 2 to 3 minutes out of
        // the same 1 to 120, which is the first fortieth of a track.
        min: MIN_PRODUCTION_MINUTES,
        max: MAX_PRODUCTION_MINUTES,
        default: DEFAULT_DIALOGUE_MINUTES_MIN,
        help: 'Its own range, because a turn is a fraction of a beat: ten minutes of conversation is dozens of turns of a phone call rather than a longer one. Two to three minutes is a call.',
    },
    {
        group: 'render',
        key: PRODUCTION_KEYS.dialogueMinutesMax,
        label: 'How long a call-in runs, longest (minutes)',
        type: 'number',
        min: MIN_PRODUCTION_MINUTES,
        max: MAX_PRODUCTION_MINUTES,
        default: DEFAULT_DIALOGUE_MINUTES_MAX,
        help: 'The other end. Set both to the same number for a phone-in that is always the same length.',
    },
    {
        group: 'render',
        key: PRODUCTION_KEYS.gapMs,
        label: 'Pause between turns (ms)',
        type: 'number',
        min: MIN_GAP_MS,
        max: MAX_GAP_MS,
        default: DEFAULT_GAP_MS,
        help: 'A production is written one beat at a time and then joined into a single piece of audio, and this is the silence put between the beats. Each one is trimmed to where it actually starts and stops first, so this is the whole pause rather than an addition to whatever the voice left behind. Two hundred is a beat between turns; past a second it is a break in the programme. It needs something set under "Join audio with" above, and a station without one hears its productions as separate beats.',
    },
    {
        group: 'render',
        key: PRODUCTION_KEYS.dialogueKinds,
        label: 'Which productions have callers',
        type: 'string',
        default: DEFAULT_DIALOGUE_KINDS,
        // A set, and it always was: `dialogueKinds()` splits this on commas and trims each one. The
        // stored value is unchanged — the form splits and joins — and what it stops is the failure
        // a one-line list always has, where a stray comma or a doubled space is a kind the station
        // quietly does not have and nothing anywhere says so.
        control: 'tags',
        help: 'Kinds of production that put somebody on the phone, one per entry. One of these is written as a conversation instead of a talk: the presenter opens, a caller answers, the presenter comes back, and each turn is spoken in its own voice. Who rings in is drawn from the callers on the personas page, least recently heard first, and a station with none simply makes the programme with one voice.',
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
        optionsFrom: 'plugins.llm',
        help: 'The plugin id the station asks for words. Leave empty when only one plugin can, and set it when several can. With none available the station still writes its own breaks, deterministically.',
    },
    {
        group: 'llm',
        key: MODEL_WRITER_KEYS.enabled,
        label: 'Let a model write the talk breaks',
        type: 'boolean',
        default: MODEL_WRITER_DEFAULT,
        help: 'With this off the station writes its own breaks from the phrasings above, which it does instantly and cannot fail at. With it on the model writes them and those phrasings become the floor underneath: a model that is slow, missing or rambling costs a better sentence rather than a silent station.',
    },
    {
        group: 'llm',
        key: MODEL_WRITER_KEYS.model,
        label: 'Model for a talk break',
        type: 'string',
        default: '',
        dependsOn: MODEL_WRITER_KEYS.enabled,
        optionsFrom: 'llm.models',
        help: "Per call rather than plugin config, so a big model for a show and a small one for a link is expressible. Leave empty for the plugin's own default. Written provider:model, the provider being the name you gave it in the plugin's own settings.",
    },
    // Who the station sounds like was a setting here and is now a row in `deadair.personas`, with
    // its own page: a character has to reach the phrasings and the voice as well as the prompt, and
    // a `ConfigField` describes one row of a form rather than a list an operator switches between.
    {
        group: 'llm',
        key: MODEL_GENERATOR_KEYS.enabled,
        label: 'Let a model choose what plays',
        type: 'boolean',
        default: MODEL_GENERATOR_DEFAULT,
        help: 'With this off the station picks by rule: a weighted draw shaped by the repeat window, the artist cooldown and your ratings. With it on the model chooses first and that draw finishes whatever it did not — a model that names six good records has done most of the job, so a partial answer is kept rather than thrown away. It chooses from your library and from your providers, and a record you do not own yet is fetched when it is picked.',
    },
    {
        group: 'llm',
        key: MUSIC_SEARCH_KEYS.alwaysReach,
        label: 'Always search your providers',
        type: 'boolean',
        default: ALWAYS_REACH_DEFAULT,
        dependsOn: MODEL_GENERATOR_KEYS.enabled,
        help: 'Off, the station searches your own library and only reaches your providers when it comes up short — which is nearly always the right thing, and is not the only way a record gets found: anything the model names is fetched whether a provider was searched or not. On, every search asks your providers too, which finds more and costs a request each time. Worth turning on if your library is small and you want the model choosing from everything; worth leaving off if a provider rate-limits you, or if talk breaks start feeling slow, since they share this search.',
    },
    {
        group: 'llm',
        key: MODEL_GENERATOR_KEYS.model,
        label: 'Model for choosing records',
        type: 'string',
        dependsOn: MODEL_GENERATOR_KEYS.enabled,
        default: '',
        optionsFrom: 'llm.models',
        help: "Separate from the talk break's model on purpose: programming an hour is a research task and writing a link is not, so the two are worth sizing differently. Leave empty for the plugin's own default. Written provider:model, the provider being the name you gave it in the plugin's own settings.",
    },
    {
        group: 'llm',
        key: MODEL_GENERATOR_KEYS.maxTokens,
        label: 'Room to answer with',
        type: 'number',
        default: DEFAULT_MAX_OUTPUT_TOKENS,
        dependsOn: MODEL_GENERATOR_KEYS.enabled,
        help: 'How many tokens the model gets for one hour of programming. Two dozen records of JSON is small, so nearly all of this is room to think in — and a model that runs out mid-thought answers with nothing at all rather than with a short list. Raise it if the log says the model ran out of room; a reasoning model on a long brief can want several times this. The cost of setting it too high is a slower refill, which nobody is waiting on.',
    },
    // What the station plays was a setting here and is now the persona's own `music` line, beside
    // the character that plays it: choosing a persona is one decision about who the station is, and
    // splitting the voice from the programming across two pages made it three.
    {
        group: 'llm',
        key: MODEL_FACTS_KEYS.enabled,
        label: 'Let a model find trivia in the articles',
        type: 'boolean',
        default: MODEL_FACTS_DEFAULT,
        help: 'The station already keeps the opening line of every article it has read, which needs no model and cannot be wrong. With this on a model reads further in for the things that line cannot carry — a film it was used in, who played on it, what it was banned for — and a second call checks each one against the exact words that state it, dropping anything the article does not say outright. It runs in the background at the lowest priority, so a talk break always gets the model first, and it will take days rather than minutes to work through a library.',
    },
    {
        group: 'llm',
        key: MODEL_FACTS_KEYS.model,
        label: 'Model for reading articles',
        type: 'string',
        dependsOn: MODEL_FACTS_KEYS.enabled,
        default: '',
        optionsFrom: 'llm.models',
        help: "Reading is the one job here where nothing is waiting, so this is the place a slower and more careful model costs you nothing. Leave empty for the plugin's own default. Written provider:model, the provider being the name you gave it in the plugin's own settings.",
    },
    {
        group: 'llm',
        key: PERSONA_NOTES_KEYS.enabled,
        label: 'Let a model read each character back to itself',
        type: 'boolean',
        default: PERSONA_NOTES_DEFAULT,
        help: 'Once a night, a model reads what each of your characters has actually said on air and writes down what is worth remembering: opinions they gave, and habits they have settled into. Anything it claims the presenter SAID is checked against the exact words that were broadcast; anything it infers about who they are becoming is proposed rather than used, and waits for you on the persona’s notebook. It runs in the background at the lowest priority, so a talk break always gets the model first.',
    },
    {
        group: 'llm',
        key: PERSONA_NOTES_KEYS.model,
        label: 'Model for reading a character back',
        type: 'string',
        dependsOn: PERSONA_NOTES_KEYS.enabled,
        default: '',
        optionsFrom: 'llm.models',
        help: "Nothing is waiting on this, so it is another place a slower and more careful model costs you nothing. Leave empty for the plugin's own default. Written provider:model, the provider being the name you gave it in the plugin's own settings.",
    },
    {
        group: 'llm',
        key: PERSONA_STORIES_KEYS.enabled,
        label: 'Let a model think of things your characters have lived through',
        type: 'boolean',
        default: PERSONA_STORIES_DEFAULT,
        help: 'Once a night, a model looks at what your station actually plays and writes down something that might have happened to each of your characters — a new story, or one more thing they remember about a story they already have. Nothing it writes can ever be said on air until you have read it and kept it: a story is made up by definition, so there is nothing to check it against and you are the check. It runs in the background at the lowest priority.',
    },
    {
        group: 'llm',
        key: PERSONA_STORIES_KEYS.model,
        label: 'Model for thinking one up',
        type: 'string',
        dependsOn: PERSONA_STORIES_KEYS.enabled,
        default: '',
        optionsFrom: 'llm.models',
        help: "Nothing is waiting on this either, so a slower and more careful model costs you nothing — and this is the one pass that uses the station's own search tools, which a stronger model drives better. Leave empty for the plugin's own default. Written provider:model, the provider being the name you gave it in the plugin's own settings.",
    },
    // Declared here at last. It has been read since `persona.writer.ts` was written and never
    // appeared on this page, so the only way to set it was by hand in the settings table — which
    // meant the one model setting an operator presses a button to exercise was the one they could
    // not choose. There is no `enabled` beside it deliberately; see `PERSONA_MODEL_KEY`.
    {
        group: 'llm',
        key: PERSONA_MODEL_KEY,
        label: 'Model for writing a character',
        type: 'string',
        default: '',
        optionsFrom: 'llm.models',
        help: "Used when you press Write on a persona. Nothing is on air waiting for it and what it produces is edited before anything is said, so a slower and more careful model is the right trade. Leave empty for the plugin's own default. Written provider:model, the provider being the name you gave it in the plugin's own settings.",
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
        optionsFrom: 'plugins.analysis',
        help: 'The plugin id that measures records, so the station can trim dead air and time what it says over an intro. Leave empty when only one plugin can. With none available every track still plays, unmeasured.',
    },
    {
        group: 'analysis',
        key: ANALYSIS_CONCURRENCY_KEY,
        label: 'Tracks measured at once',
        type: 'number',
        default: DEFAULT_ANALYSIS_CONCURRENCY,
        // The same bounds `resolveAnalysisConcurrency` clamps a stored row to, shared for the reason
        // every default in this file is shared: two numbers that can disagree eventually do, and
        // here the disagreement would be a console that accepts a figure the walk then ignores.
        min: 1,
        max: MAX_ANALYSIS_CONCURRENCY,
        control: 'slider',
        help: "How many measurements the walk keeps in flight. The analyzer's own ceiling is the other half: above it the extra requests wait there and spend their timeout waiting, so raise this towards what the connection test on the analyzer plugin says it will measure at once, and no further.",
    },
    {
        group: 'analysis',
        key: ANALYSIS_PROVIDER_PACE_KEY,
        label: 'Pause after a downloaded track (ms)',
        type: 'number',
        default: DEFAULT_ANALYSIS_PROVIDER_PACE_MS,
        min: 0,
        max: MAX_ANALYSIS_PACE_MS,
        help: "Measuring a track the station does not already hold is a full download through the same account it plays on, and a burst of them can trip a provider's own rate limit. This is the gap the walk leaves after one of those before starting the next.",
    },
    {
        group: 'analysis',
        key: ANALYSIS_LOCAL_PACE_KEY,
        label: 'Pause after an already-local track (ms)',
        type: 'number',
        default: DEFAULT_ANALYSIS_LOCAL_PACE_MS,
        min: 0,
        max: MAX_ANALYSIS_PACE_MS,
        help: 'A record the station has already kept costs no provider request to measure, so this can be far shorter than the download pause above — but it is not free: it is still disk and decode time on whatever machine is running the analyzer. Set to 0 to measure the local half of the library flat out.',
    },

    // ── schedule ───────────────────────────────────────────────────────────────
    // What plays in the hours no block claims — what a broadcaster calls a
    // sustaining service. Declared here because they are station settings and
    // `PUT /settings` refuses a key nobody declared, and drawn NOWHERE on the
    // settings page: `SustainingPanel` owns them, beside the timetable that makes
    // sense of them. The labels are the panel's, and are short because the page
    // around them says what they are about.
    {
        group: 'schedule',
        key: SUSTAINING_KEYS.pluginId,
        label: 'Playing from: which plugin',
        type: 'string',
        help: 'The plugin behind the playlist a gap plays. Both halves are needed for a playlist to be read; a brief alone is also a coherent answer, and so is nothing at all.',
    },
    {
        group: 'schedule',
        key: SUSTAINING_KEYS.playlistId,
        label: 'Playing from: which playlist',
        type: 'string',
        help: 'The playlist id, as the plugin knows it.',
    },
    {
        group: 'schedule',
        key: SUSTAINING_KEYS.chartId,
        label: 'Playing from: which chart',
        type: 'string',
        help:
            'A published chart to play between blocks instead, as `plugin:chart`. An alternative to the playlist above rather than a companion, ' +
            'and it wins if both are set. A chart is a few dozen records, so a longer gap plays it and then carries on with the station\u2019s own ' +
            'rotation.',
    },
    {
        group: 'schedule',
        key: SUSTAINING_KEYS.chartOrder,
        label: 'Playing from: which way round',
        type: 'string',
        help: 'countdown, ranked or unordered. A countdown ends on number one, which is the shape a chart show has, and is what an empty box means.',
    },
    {
        group: 'schedule',
        key: SUSTAINING_KEYS.brief,
        label: 'Asked to play',
        type: 'text',
        help:
            "In your own words, for the model that chooses records, exactly as a block's own brief works. Set on its own it makes the station " +
            'programme itself towards something between blocks rather than from a playlist. It never falls silent: a gap plays something or the ' +
            'station keeps what it has, so the schedule can never take a running station off air.',
    },
    {
        group: 'schedule',
        key: SUSTAINING_KEYS.eraFrom,
        label: 'From year',
        type: 'number',
        help:
            'The period played between blocks, as a four-digit year. Unlike the words above, this reaches the record draw as well as the model, ' +
            'so it holds even on a station with no model configured. A record whose release year the catalogue does not know is played whatever ' +
            'the period: leaving it out is not evidence of the wrong decade.',
    },
    {
        group: 'schedule',
        key: SUSTAINING_KEYS.eraTo,
        label: 'To year',
        type: 'number',
        help: 'The other end, on the same terms. Set both for a decade; either stands alone, so a lower bound on its own means "this year onwards".',
    },

    // ── personas ───────────────────────────────────────────────────────────────
    // Drawn nowhere on the settings page, on the schedule group's terms:
    // `PresenterNamePanel` owns it, above the roster on the characters page. It
    // sat beside the station's name for as long as it existed, where it read as
    // THE presenter's name, and any host with a name of its own overrides it,
    // which nothing on that page could say.
    {
        group: 'personas',
        key: TEMPLATE_KEYS.djName,
        label: 'Presenter name',
        type: 'string',
        default: '',
        help:
            'What a host without a name of its own is called on air, and what the station is called while nobody is on air. It fills the ' +
            'phrasings that ask for a name and tells the model what it is called. Leave it empty and neither happens.',
    },

    // ── the stream's own secrets are NOT here ─────────────────────────────────
    // `STREAM_SECRET_KEYS` (the Icecast source and admin passwords, the harbor password, the shim
    // secret and the playout bridge secret) were declared here and editable from the console for as
    // long as the console existed, on the premise that an operator might need to match one to
    // something else. Nothing else ever holds one: `ensureStreamSecrets` seeds all five on first
    // boot, both ends of each are rendered from the same row, and the image publishes nothing but
    // port 80. What the field did offer was a way off the air: a changed value is adopted by Icecast
    // and Liquidsoap only on their next restart, the bridge secret is read once at `ready`, and a
    // cleared source or admin password stops the materializer rendering at all. Undeclared, `PUT
    // /settings` refuses a write to one like any other key nobody declared. The rows are untouched,
    // and one set by hand with psql is honoured: `resolveStreamSettings` accepts plaintext for it.

    // ── mail ───────────────────────────────────────────────────────────────────
    // The only thing the station sends email for is signing in, so this page is worth visiting
    // exactly once. The password is the only `secret` the station declares: typed by the operator,
    // because nothing can mint it, and drawn beside the server it authenticates to, since it is
    // useless three fields away from the host it goes with.
    //
    // Everything below hangs off the host through `dependsOn`, which is what makes the page a
    // single question — "where does this station send mail" — rather than six unrelated ones. The
    // host is also the switch: there is no `mail.enabled` (see `mail.settings.ts` for why).
    {
        group: 'mail',
        key: MAIL_KEYS.host,
        label: 'SMTP server',
        type: 'string',
        default: '',
        help: 'The mail server the station signs people in through. Leave it empty and the station sends nothing, and says so plainly rather than failing quietly.',
    },
    {
        group: 'mail',
        key: MAIL_KEYS.port,
        label: 'Port',
        type: 'number',
        default: MAIL_DEFAULTS.port,
        min: MIN_MAIL_PORT,
        max: MAX_MAIL_PORT,
        dependsOn: MAIL_KEYS.host,
        help: '587 for STARTTLS, which is the common one. 465 wants the setting below turned on too.',
    },
    {
        group: 'mail',
        key: MAIL_KEYS.secure,
        label: 'TLS from the first byte',
        type: 'boolean',
        default: MAIL_DEFAULTS.secure,
        dependsOn: MAIL_KEYS.host,
        help: 'On for port 465, off for 587. Turning it on against a server expecting STARTTLS does not fail, it hangs: both ends wait for the other to speak first.',
    },
    {
        group: 'mail',
        key: MAIL_KEYS.user,
        label: 'Username',
        type: 'string',
        default: '',
        dependsOn: MAIL_KEYS.host,
        help: 'Leave empty for a relay that takes no credentials, which a mail server on the same machine usually does.',
    },
    {
        group: 'mail',
        key: MAIL_KEYS.password,
        label: 'Password',
        type: 'secret',
        dependsOn: MAIL_KEYS.host,
    },
    {
        group: 'mail',
        key: MAIL_KEYS.from,
        label: 'Sends from',
        type: 'string',
        default: '',
        dependsOn: MAIL_KEYS.host,
        help: 'The address sign-in emails come from. Needed as much as the server is: most providers refuse an envelope whose sender is not one of theirs.',
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
