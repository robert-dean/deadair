/**
 * The station's voice names, and what each one is on a rhapsode.
 *
 * The station asks for a voice by a name it chose (`host`, `newsreader`) and this plugin decides
 * what that means to the server. The same indirection `plugins/kokoro` documents, against a server
 * that holds more than one engine at once.
 *
 * ## Why a row names an engine
 *
 * Because on this server a voice id is only unique WITHIN an engine: rhapsode addresses a voice as
 * the pair `(engine, voice)` and says so — its protocol § 13.3 decides cross-engine namespacing is
 * not the server's job, and that "a client that means 'the same person' on three engines keeps its
 * own table of `(engine, voice)` pairs". This is that table. `af_heart` on Kokoro and a cloned clip
 * on Chatterbox are two different voices that a station may want in the same hour, and a single
 * engine setting for the whole plugin would make the multi-engine server behave like the
 * single-engine ones it replaces.
 *
 * The cost is the operator's to weigh rather than this plugin's to prevent: a rhapsode running at
 * `maxResidentModels: 1` evicts and reloads between two rows on different engines, which is a real
 * pause between two breaks. Left possible, because the operator with a big card wants it and the
 * one without will hear why not.
 *
 * A blank engine cell means the configured default engine, so a station that only ever uses one
 * fills in the column once, at the top of the form, and never again.
 */

import { parseRows } from '@deadair/plugin-sdk';

/** The config key the rows are stored under, and the field key columns hang off. */
export const VOICES_FIELD = 'voices';

/** Column keys. Dot-free, and the same strings the manifest declares. */
export const VOICE_NAME_COLUMN = 'name';
export const VOICE_ENGINE_COLUMN = 'engine';
export const VOICE_VOICE_COLUMN = 'voice';
export const VOICE_VARIANT_COLUMN = 'variant';
export const VOICE_SPEED_COLUMN = 'speed';

/** What one station voice IS on this server. */
export interface VoiceMapping {
    /**
     * Which engine says it, or absent for the configured default engine.
     *
     * Absent rather than filled in at parse time, so that changing the default engine at the top of
     * the form moves every row that never named one, which is what an operator trying a new engine
     * means by changing it.
     */
    engine?: string;

    /**
     * The engine's own name for the voice: `af_heart`, or a voice cloned into the server.
     *
     * Free text rather than one of the server's list, on `plugins/kokoro`'s argument and one more of
     * this server's own: a voice created through `POST /engines/{engine}/voices` exists the moment
     * the operator uploads it, and a form that only offered what a cached listing held would not
     * have it.
     */
    voice: string;

    /**
     * Which build of that engine, or absent for whatever the server has loaded.
     *
     * An engine here is several models — Chatterbox ships `turbo`, `original` and `multilingual` —
     * and they do not all perform the same cues or take the same dials. Naming one pins the reading;
     * leaving it blank takes whatever is resident, which is the cheaper answer and the right default.
     */
    variant?: string;

    /**
     * How fast to read, when this voice is not read at the engine's own pace.
     *
     * Kept as the operator typed it rather than clamped here, because there is no single range to
     * clamp to: `speed` is one of the engine's own dials and each build declares its own `min` and
     * `max`. The plugin asks the build for them before sending one, which is also what stops a speed
     * from reaching an engine that has no such dial — on this server an unknown dial is a refusal
     * naming the key, not a field quietly ignored.
     */
    speed?: number;
}

/** Station voice name to what it is here. */
export type VoiceMap = Record<string, VoiceMapping>;

/**
 * The map, out of whatever the config holds.
 *
 * Tolerant, and for the reason `parseRows` is: this runs in `init()`, and a value hand-edited into
 * something unreadable should cost the station its mappings rather than its ability to speak at all.
 * Every voice then falls back to the defaults, which is a station that sounds wrong rather than one
 * that is silent.
 *
 * A row with no name or no engine voice is dropped rather than half-kept, because the form leaves an
 * empty row behind whenever an operator adds one and thinks better of it, and half a mapping is not
 * a mapping.
 */
export function voiceMapOf(raw: unknown): VoiceMap {
    const voices: VoiceMap = {};

    for (const row of parseRows(raw)) {
        const name = row[VOICE_NAME_COLUMN]?.trim();
        const voice = row[VOICE_VOICE_COLUMN]?.trim();
        if (!name || !voice) continue;

        const engine = row[VOICE_ENGINE_COLUMN]?.trim();
        const variant = row[VOICE_VARIANT_COLUMN]?.trim();
        const speed = speedOf(row[VOICE_SPEED_COLUMN]);

        voices[name] = {
            voice,
            ...(engine ? { engine } : {}),
            ...(variant ? { variant } : {}),
            ...(speed === undefined ? {} : { speed }),
        };
    }

    return voices;
}

/**
 * A speed cell as a number, or nothing.
 *
 * Every cell of a `list` is stored as a string, so this is where a typed field would otherwise be.
 * Anything that is not a positive number at all is absent, which means the engine's own pace — and
 * absent is genuinely different from 1, which is a dial this plugin would then send and a build with
 * no speed dial would refuse.
 */
export function speedOf(raw: string | undefined): number | undefined {
    if (raw === undefined || raw.trim().length === 0) return undefined;

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Whether every row an operator has typed is one this plugin could act on.
 *
 * For the manifest's `configSchema`, so a half-filled row is refused while the form is still in
 * front of them rather than becoming a voice that silently does not exist. Deliberately narrower
 * than {@link voiceMapOf}, which has to cope with whatever is already stored: this judges what
 * somebody is about to save.
 *
 * An entirely empty row passes, because that is what the form leaves behind when a row is added and
 * abandoned, and refusing the save over it would be the form fighting the operator. A row naming
 * only an engine or only a variant does NOT pass: there is no voice in it to say, and the reading it
 * would produce is the default one under somebody else's name.
 */
export function voiceRowsAreComplete(raw: unknown): boolean {
    if (raw === undefined) return true;

    return parseRows(raw).every(row => {
        const name = row[VOICE_NAME_COLUMN]?.trim();
        const voice = row[VOICE_VOICE_COLUMN]?.trim();

        // `parseRows` already drops a row whose every cell is blank, so anything here has something
        // in it and owes both halves.
        return Boolean(name) && Boolean(voice);
    });
}
