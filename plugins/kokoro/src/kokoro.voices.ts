/**
 * The station's voice names, and what they sound like on this server.
 *
 * The station asks for a voice by a name it chose (`host`, `newsreader`) and
 * this plugin decides what that means to the engine (`af_heart`, at some speed).
 * Keeping the mapping here rather than in the host is what lets the same station
 * voice be a named preset on this engine and a cloned reference clip on the next
 * one.
 *
 * ## It was a box with separators in it
 *
 * `stationVoice = engineVoice` entries, split on commas and newlines, in a
 * one-line text input, with a hand-written parser and a `refine` to catch a
 * malformed line. That was written because the host's form vocabulary genuinely
 * had no map type. It has one now — a `list` field with declared `columns`,
 * stored as JSON and read back with `parseRows` — and the argument for using it
 * is the one the host already makes about a format clock and a news feed: the
 * moment a list's entries have PARTS, a line an operator can mistype is a voice
 * the station silently does not have.
 *
 * The measured version of that, on this install: 68 voicepacks on the server, a
 * map holding the empty string, and every persona read by the same voice. Nobody
 * fills in a box that requires knowing `af_heart` by heart, which is why the
 * engine cell is an autocomplete over what the server actually reports (see
 * `suggestConfigOptions` in the plugin) rather than free text with a good
 * placeholder.
 *
 * No compatibility path from the old format, deliberately: nothing has shipped,
 * and a station whose stored value is the wrong shape reads as no rows and is
 * refilled from the table in front of the operator.
 */

import { parseRows } from '@deadair/plugin-sdk';

/** The config key the rows are stored under, and the field key columns hang off. */
export const VOICES_FIELD = 'voices';

/** Column keys. Dot-free, and the same strings the manifest declares. */
export const VOICE_NAME_COLUMN = 'name';
export const VOICE_ENGINE_COLUMN = 'engine';
export const VOICE_SPEED_COLUMN = 'speed';

/**
 * The narrowest and widest the engine will read at, as its own API documents
 * them. Out-of-range is clamped rather than refused for `resolveVoiceRows`'
 * reason; the manifest's schema is what tells an operator while the form is
 * still in front of them.
 */
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

/** What one station voice IS on this server. */
export interface VoiceMapping {
    /**
     * The engine's own name for it.
     *
     * Free text rather than one of the server's list, because the server's list
     * is not the whole vocabulary: a blend expression (`af_bella(2)+af_sky(1)`)
     * names no single voicepack and is a legal value the engine accepts.
     */
    engine: string;

    /**
     * How fast to read, when this voice is not read at the engine's own pace.
     *
     * Absent means send nothing, which is not the same as sending 1: a request
     * with no `speed` is the plainest thing this plugin can ask for, and it is
     * what every voice asked for before the column existed.
     */
    speed?: number;
}

/** Station voice name to what it is here. */
export type VoiceMap = Record<string, VoiceMapping>;

/**
 * The map, out of whatever the config holds.
 *
 * Tolerant, and for the reason `parseRows` is: this runs in `init()`, and a value
 * hand-edited into something unreadable should cost the station its mappings
 * rather than its ability to speak at all. Every voice then falls back to the
 * default, which is a station that sounds wrong rather than one that is silent.
 *
 * A row missing either name or engine is dropped rather than half-kept, because
 * the form leaves an empty row behind whenever an operator adds one and thinks
 * better of it, and half a mapping is not a mapping.
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
 * can do is a better answer than ignoring them. Anything that is not a number at
 * all is absent, which means the engine's own pace.
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
 * form is still in front of them rather than becoming a voice that silently does
 * not exist. Deliberately narrower than {@link voiceMapOf}, which has to cope
 * with whatever is already stored: this judges what somebody is about to save.
 *
 * An entirely empty row passes, because that is what the form leaves behind when
 * a row is added and abandoned, and refusing the save over it would be the form
 * fighting the operator.
 */
export function voiceRowsAreComplete(raw: unknown): boolean {
    if (raw === undefined) return true;

    return parseRows(raw).every(row => {
        const name = row[VOICE_NAME_COLUMN]?.trim();
        const engine = row[VOICE_ENGINE_COLUMN]?.trim();

        // `parseRows` already drops a row whose every cell is blank, so anything
        // here has something in it and owes both halves.
        return Boolean(name) && Boolean(engine);
    });
}
