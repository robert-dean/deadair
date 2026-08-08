/**
 * The station's voice names, and what they sound like on this server.
 *
 * The station asks for a voice by a name it chose (`host`, `newsreader`) and
 * this plugin decides what that means to Kokoro (`af_heart`). Keeping the
 * mapping here rather than in the host is what lets the same station voice be a
 * named preset on this engine and a cloned reference clip on the next one.
 *
 * Written as text rather than structured config because the host's form
 * vocabulary has no map type, and a fixed set of named slots would be a guess at
 * how many voices a station wants.
 */

/** A parse that either produced a map or can say which line it choked on. */
export type VoiceMapResult = { ok: true; voices: Record<string, string> } | { ok: false; line: number; reason: string };

/** A blank line, or one commented out with `#`. Neither is an error. */
const isIgnorable = (line: string): boolean => line.length === 0 || line.startsWith('#');

/**
 * One mapping per line, or per comma.
 *
 * Commas because the host renders a `string` config field as a single-line
 * input, where a newline cannot be typed at all. Newlines because that is what
 * this wants to be, and will be the moment the form grows a multi-line field.
 * Supporting both costs one character in a regex and means the setting an
 * operator can write today keeps working when it does.
 */
const SEPARATOR = /[\r\n,]+/;

/**
 * Reads `stationVoice = engineVoice` entries.
 *
 * Tolerant about spacing and about `:` instead of `=`, because both are things a
 * person types into a box; strict about an entry that names no voice at all,
 * which is a typo the operator should see while the form is still in front of
 * them. That is why this returns a result rather than throwing or silently
 * skipping: the manifest's `configSchema` refuses the save with it.
 */
export function parseVoiceMap(raw: string | undefined): VoiceMapResult {
    const voices: Record<string, string> = {};
    if (raw === undefined) return { ok: true, voices };

    const lines = raw.split(SEPARATOR);
    for (const [index, rawLine] of lines.entries()) {
        const line = rawLine.trim();
        if (isIgnorable(line)) continue;

        const separator = line.search(/[=:]/);
        if (separator === -1) return { ok: false, line: index + 1, reason: `"${line}" is not "stationVoice = engineVoice"` };

        const station = line.slice(0, separator).trim();
        const engine = line.slice(separator + 1).trim();
        if (station.length === 0 || engine.length === 0) {
            return { ok: false, line: index + 1, reason: `"${line}" is missing a name on one side` };
        }

        voices[station] = engine;
    }

    return { ok: true, voices };
}

/**
 * The map, with a bad one read as empty.
 *
 * For `init()`, which runs after `configSchema` has already refused anything
 * malformed. A station with no mappings is an ordinary state — every request
 * falls back to the default voice — so this cannot be the thing that stops a
 * plugin loading.
 */
export function voiceMapOf(raw: unknown): Record<string, string> {
    if (typeof raw !== 'string') return {};
    const parsed = parseVoiceMap(raw);
    return parsed.ok ? parsed.voices : {};
}
