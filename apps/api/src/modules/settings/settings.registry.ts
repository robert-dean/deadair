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
import { DEFAULT_RULES, ROTATION_KEYS } from '#modules/director/rotation.rules.js';
import { DEFAULT_TEMPLATES, TEMPLATE_KEYS, TEMPLATE_VOCABULARY } from '#modules/director/break.templates.js';
import { WELCOME_KEYS, WELCOME_TEMPLATES } from '#modules/director/welcome.writer.js';
import { NEWS_KEYS, NEWS_TEMPLATES } from '#modules/director/news.break.writer.js';
import { BULLETIN_KEYS, DEFAULT_MAX_AGE_HOURS, DEFAULT_STORY_COUNT } from '#modules/director/bulletin.source.js';
import { CLOCK_KEYS } from '#modules/director/clock.words.js';
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
import { ADVISORY_DEFAULT, ADVISORY_KEY } from '#modules/director/advisory.policy.js';
import { MODEL_WRITER_DEFAULT, MODEL_WRITER_KEYS } from '#modules/director/model.talk.break.writer.js';
import { LLM_PLUGIN_KEY } from '#modules/llm/llm.settings.js';
import { ALWAYS_REACH_DEFAULT, MUSIC_SEARCH_KEYS } from '#modules/llm/music.search.tool.js';
import { MODEL_FACTS_DEFAULT, MODEL_FACTS_KEYS } from '#modules/enrichment/fact.extraction.service.js';
import { PERSONA_NOTES_DEFAULT, PERSONA_NOTES_KEYS } from '#modules/personas/persona.distil.service.js';
import { PERSONA_STORIES_DEFAULT, PERSONA_STORIES_KEYS } from '#modules/personas/persona.story.pass.service.js';
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
import { SPEECH_PLUGIN_KEY } from '#modules/render/speech.settings.js';
import { SCRIPT_HISTORY_DEFAULTS, SCRIPT_HISTORY_KEYS } from '#modules/render/script.history.settings.js';
import {
    DEFAULT_DIALOGUE_KINDS,
    DEFAULT_DIALOGUE_MINUTES,
    DEFAULT_TARGET_MINUTES,
    DEFAULT_WRITING_MODE,
    PRODUCTION_KEYS,
} from '#modules/productions/production.settings.js';
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
    /**
     * Which part of the console owns this setting.
     *
     * A section of the settings page for all but one of them. `schedule` is the exception and is
     * deliberately not drawn there: what the station plays between blocks is a question about the
     * timetable, so it is edited beside the timetable, by a panel that draws its own controls. See
     * the group's own note below.
     */
    group: SettingGroup;
}

/**
 * The groups there are, in the order the settings page draws the ones it draws.
 *
 * Not every group is a card on that page. `schedule` is owned by `SustainingPanel` on the schedule
 * page, which is why `GROUPS` in `settings.page.tsx` is a list of its own rather than this one: a
 * group that is not in that list is drawn by whoever claimed it, and a group in neither is a bug
 * `settings.registry.test.ts` cannot see. Adding one means deciding which page draws it.
 */
export const SETTING_GROUPS = ['station', 'rotation', 'playout', 'render', 'llm', 'analysis', 'schedule'] as const;

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
        key: PRODUCTION_KEYS.targetMinutes,
        label: 'How long a production runs (minutes)',
        type: 'number',
        default: DEFAULT_TARGET_MINUTES,
        help: 'The default length, which decides how many beats it has and how long each one is. Nothing about the timing is left to the model: asked to decide for itself it gives one subject one beat, which at ten minutes is a single beat asked to carry more words than any one answer contains.',
    },
    {
        group: 'render',
        key: PRODUCTION_KEYS.dialogueMinutes,
        label: 'How long a call-in runs (minutes)',
        type: 'number',
        default: DEFAULT_DIALOGUE_MINUTES,
        help: 'The default length for a production that has callers in it, which is its own number because a turn is about a third of a beat: ten minutes of conversation is twenty-odd turns of a phone call rather than a longer one. Three minutes is about seven turns, which is a call.',
    },
    {
        group: 'render',
        key: PRODUCTION_KEYS.dialogueKinds,
        label: 'Which productions have callers',
        type: 'string',
        default: DEFAULT_DIALOGUE_KINDS,
        help: 'Kinds of production that put somebody on the phone, separated by commas. One of these is written as a conversation instead of a talk: the presenter opens, a caller answers, the presenter comes back, and each turn is spoken in its own voice. Who rings in is drawn from the callers on the personas page, least recently heard first, and a station with none simply makes the programme with one voice.',
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
        help: "Separate from the talk break's model on purpose: programming an hour is a research task and writing a link is not, so the two are worth sizing differently. Leave empty for the plugin's own default.",
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
        help: "Reading is the one job here where nothing is waiting, so this is the place a slower and more careful model costs you nothing. Leave empty for the plugin's own default.",
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
        help: "Nothing is waiting on this, so it is another place a slower and more careful model costs you nothing. Leave empty for the plugin's own default.",
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
        help: "Nothing is waiting on this either, so a slower and more careful model costs you nothing — and this is the one pass that uses the station's own search tools, which a stronger model drives better. Leave empty for the plugin's own default.",
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
        // The same bounds `resolveAnalysisConcurrency` clamps a stored row to, shared for the reason
        // every default in this file is shared: two numbers that can disagree eventually do, and
        // here the disagreement would be a console that accepts a figure the walk then ignores.
        min: 1,
        max: MAX_ANALYSIS_CONCURRENCY,
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
