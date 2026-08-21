/**
 * The station's voice names, and what they sound like on this server.
 *
 * The same shape `plugins/kokoro` reads, and deliberately its own copy rather
 * than a shared module. A plugin is a self-contained package and the SDK's job
 * is the CONTRACT rather than a library of config helpers, so the alternative to
 * these forty lines is a `@deadair/plugin-speech-config` that exists to save one
 * of them. The two will also stop agreeing the moment either engine grows a knob
 * the other has no meaning for — this one's voices are reference WAVs and its
 * native path carries expressiveness dials, and neither is a thing to force on
 * the engine next door.
 *
 * What is genuinely shared is `parseRows`, which is the encoding, and that comes
 * from the SDK because the CONSOLE writes it.
 */

import { parseRows } from '@deadair/plugin-sdk';

/** The config key the rows are stored under, and the field key columns hang off. */
export const VOICES_FIELD = 'voices';

/** Column keys. Dot-free, and the same strings the manifest declares. */
export const VOICE_NAME_COLUMN = 'name';
export const VOICE_ENGINE_COLUMN = 'engine';
export const VOICE_SPEED_COLUMN = 'speed';

/**
 * The narrowest and widest this server will read at.
 *
 * Its OpenAI-compatible `/v1/audio/speech` takes a `speed`, which is worth
 * saying because it did not have to: that shape is the plainest thing an engine
 * can expose and a build that ignored the field would be within its rights.
 * Confirmed against the running server rather than assumed.
 */
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

/** What one station voice IS on this server. */
export interface VoiceMapping {
    /**
     * The engine's own name for it: a filename in the server's predefined-voice
     * directory, like `Olivia.wav`.
     *
     * Free text rather than one of the server's list, because an operator who
     * drops a new WAV in reaches it before this plugin's suggestions have been
     * refreshed, and because being unable to name a voice the server has is a
     * worse failure than naming one it does not.
     */
    engine: string;

    /** How fast to read, or absent to read at the engine's own pace. */
    speed?: number;
}

/** Station voice name to what it is here. */
export type VoiceMap = Record<string, VoiceMapping>;

/**
 * The map, out of whatever the config holds.
 *
 * Tolerant on purpose: this runs in `init()`, and a value hand-edited into
 * something unreadable should cost the station its mappings rather than its
 * ability to speak at all. Every voice then falls back to the default, which is
 * a station that sounds wrong rather than a silent one.
 */
export function voiceMapOf(raw: unknown): VoiceMap {
    const voices: VoiceMap = {};

    for (const row of parseRows(raw)) {
        const name = row[VOICE_NAME_COLUMN]?.trim();
        const engine = row[VOICE_ENGINE_COLUMN]?.trim();
        if (!name || !engine) continue;

        const speed = speedOf(row[VOICE_SPEED_COLUMN]);
        voices[name] = { engine, ...(speed === undefined ? {} : { speed }) };
    }

    return voices;
}

/**
 * A speed cell as a number the engine will accept, or nothing.
 *
 * Every cell of a `list` is stored as a string, so this is where a typed field
 * would otherwise be. Clamped rather than rejected: a value out of range is an
 * operator asking for something the engine cannot do, and the nearest thing it
 * can do beats ignoring them.
 */
export function speedOf(raw: string | undefined): number | undefined {
    if (raw === undefined || raw.trim().length === 0) return undefined;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;

    return Math.min(MAX_SPEED, Math.max(MIN_SPEED, parsed));
}

/**
 * Whether every row an operator has typed is one this plugin could act on.
 *
 * For the manifest's `configSchema`, so a half-filled row is refused while the
 * table is still in front of them rather than becoming a voice that silently
 * does not exist. An entirely empty row passes, because that is what the form
 * leaves behind when a row is added and abandoned.
 */
export function voiceRowsAreComplete(raw: unknown): boolean {
    if (raw === undefined) return true;

    return parseRows(raw).every(row => Boolean(row[VOICE_NAME_COLUMN]?.trim()) && Boolean(row[VOICE_ENGINE_COLUMN]?.trim()));
}
