/**
 * The station's voice names, and which ElevenLabs voice each one is.
 *
 * The same indirection `plugins/kokoro` documents: the station asks for a name it chose (`host`,
 * `newsreader`, a persona's key) and this table says what that sounds like here. A row names an
 * ElevenLabs `voice_id` and, optionally, the four `voice_settings` that shape how it reads.
 *
 * ## Why nothing ships
 *
 * `plugins/rhapsode`'s reason, one step further. A shipped row would name a voice id, and which
 * voices an account can use is the account's business: a library voice somebody added, a clone, or
 * one of ElevenLabs' own defaults that the next catalogue change retires. A row naming a voice the
 * account does not have is `voice_not_found` on every break rather than a wrong voice. So a fresh
 * install reads everything in `defaultVoice` until the operator maps the rest, and the autocomplete
 * on the voice column is what makes that a minute's work.
 */

import { parseRows } from '@deadair/plugin-sdk';
import type { VoiceSettingKey } from './elevenlabs.models.js';

/** The config key the rows are stored under, and the field key columns hang off. */
export const VOICES_FIELD = 'voices';

/** Column keys. Dot-free, and the same strings the manifest declares. */
export const VOICE_NAME_COLUMN = 'name';
export const VOICE_VOICE_COLUMN = 'voice';
export const VOICE_STABILITY_COLUMN = 'stability';
export const VOICE_SIMILARITY_COLUMN = 'similarity';
export const VOICE_STYLE_COLUMN = 'style';
export const VOICE_SPEED_COLUMN = 'speed';

/**
 * The range ElevenLabs accepts for each setting.
 *
 * A value outside it is clamped rather than dropped: an operator who typed `1.5` for speed meant
 * "faster", and the fastest the API allows is the closest thing to what they asked for.
 */
export const SETTING_RANGES: Readonly<Record<VoiceSettingKey, { min: number; max: number }>> = {
    stability: { min: 0, max: 1 },
    similarity_boost: { min: 0, max: 1 },
    style: { min: 0, max: 1 },
    speed: { min: 0.7, max: 1.2 },
};

/** The settings a row set, keyed as the API spells them. Absent means the voice's own. */
export type VoiceSettings = Partial<Record<VoiceSettingKey, number>>;

/** What one station voice IS on ElevenLabs. */
export interface VoiceMapping {
    /** The ElevenLabs `voice_id`. */
    voice: string;

    /**
     * How it reads, where the row said.
     *
     * Each one is absent unless typed, and absent is not the same as ElevenLabs' textbook default:
     * a voice saved in the ElevenLabs console carries its own settings, and those are what an
     * omitted field gets.
     */
    settings: VoiceSettings;
}

/** Station voice name to what it is here. */
export type VoiceMap = Record<string, VoiceMapping>;

/** Which column holds which setting. */
const SETTING_COLUMNS: readonly (readonly [string, VoiceSettingKey])[] = [
    [VOICE_STABILITY_COLUMN, 'stability'],
    [VOICE_SIMILARITY_COLUMN, 'similarity_boost'],
    [VOICE_STYLE_COLUMN, 'style'],
    [VOICE_SPEED_COLUMN, 'speed'],
];

/**
 * The map, out of whatever the config holds.
 *
 * Tolerant, for `parseRows`' reason: this runs in `init()`, and a value hand-edited into something
 * unreadable should cost the station its mappings rather than its ability to speak. A row missing
 * either half is dropped rather than half-kept.
 */
export function voiceMapOf(raw: unknown): VoiceMap {
    const voices: VoiceMap = {};

    for (const row of parseRows(raw)) {
        const name = row[VOICE_NAME_COLUMN]?.trim();
        const voice = row[VOICE_VOICE_COLUMN]?.trim();
        if (!name || !voice) continue;

        const settings: VoiceSettings = {};
        for (const [column, key] of SETTING_COLUMNS) {
            const value = settingOf(row[column], key);
            if (value !== undefined) settings[key] = value;
        }

        voices[name] = { voice, settings };
    }

    return voices;
}

/**
 * One cell as a setting, or nothing.
 *
 * Every cell of a `list` is a string. Blank or not a number at all is absent, which leaves the
 * voice's own setting alone; a number is clamped into the range the API takes.
 */
export function settingOf(raw: string | undefined, key: VoiceSettingKey): number | undefined {
    if (raw === undefined || raw.trim().length === 0) return undefined;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return undefined;

    const { min, max } = SETTING_RANGES[key];
    return Math.min(max, Math.max(min, parsed));
}

/**
 * Whether every row an operator has typed is one this plugin could act on.
 *
 * For the manifest's `configSchema`, so a half-filled row is refused while the form is still in
 * front of them. An entirely empty row passes, because `parseRows` drops it and the form leaves one
 * behind whenever a row is added and abandoned.
 */
export function voiceRowsAreComplete(raw: unknown): boolean {
    if (raw === undefined) return true;

    return parseRows(raw).every(row => Boolean(row[VOICE_NAME_COLUMN]?.trim()) && Boolean(row[VOICE_VOICE_COLUMN]?.trim()));
}
