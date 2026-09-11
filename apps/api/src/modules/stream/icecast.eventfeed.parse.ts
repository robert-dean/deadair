/**
 * The wire format of Icecast's event feed, and nothing else.
 *
 * Split out from the client for the reason `listenersForMount` is split out of
 * the stats poll: this is the compatibility boundary with another project's
 * output, it is the part that will be wrong first, and it can be tested without
 * a socket or a server.
 *
 * Deliberately local to this module rather than in `packages/plugin-sdk`, since
 * Icecast's feed is its only consumer today; [icecast-2.5](https://github.com/robert-dean/deadair/discussions/17) records
 * where it moves if a plugin ever needs to read an SSE API.
 */

/**
 * How much unterminated text to hold before giving up on a frame.
 *
 * A feed that never sends a blank line would otherwise grow this buffer for as
 * long as the connection lasts, which on a station left running is forever. No
 * real event is anywhere near this; a megabyte of it is a server doing something
 * other than what this parses.
 */
const MAX_CARRY_CHARS = 1_000_000;

/**
 * A reader that turns a byte stream's worth of text into SSE `data:` payloads.
 *
 * Stateful because frames arrive split across chunks — the half of a frame at
 * the end of one read is the start of the next — and that is the case that
 * breaks a naive parser on exactly the events that matter, since they are the
 * ones that arrive under load.
 */
export class SseFrameReader {
    private carry = '';

    /**
     * Feed a chunk in, take whatever complete frames it finished out.
     *
     * Returns the `data` payload of each, joined by newline when a frame carried
     * several data lines (which the format allows and Icecast does not use). A
     * frame with no data line at all — a comment, a bare `id:`, a heartbeat — is
     * not a payload and is dropped rather than returned as an empty string.
     */
    push(chunk: string): string[] {
        this.carry += chunk;
        if (this.carry.length > MAX_CARRY_CHARS) {
            // Whatever this is, it is not a frame we were ever going to complete.
            this.carry = '';
            return [];
        }

        const parts = this.carry.split(/\r?\n\r?\n/);
        // The last part is either an unfinished frame or the empty string after a
        // terminator; either way it is the start of the next one.
        this.carry = parts.pop() ?? '';

        const payloads: string[] = [];
        for (const frame of parts) {
            const data = dataOf(frame);
            if (data !== undefined) payloads.push(data);
        }
        return payloads;
    }
}

/** The `data:` content of one frame, or `undefined` when it carried none. */
function dataOf(frame: string): string | undefined {
    const lines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        // One optional space after the colon is part of the framing, not the data.
        lines.push(line.slice(5).replace(/^ /, ''));
    }
    return lines.length ? lines.join('\n') : undefined;
}

/** One event from the feed, in the only terms the audience cares about. */
export interface ListenerEvent {
    /** Icecast's own name for what happened, kept for the log line. */
    trigger: string;
    /** The mount the event is about, as Icecast wrote it. */
    uri: string;
    /** How many clients are attached to that mount, whole rather than a delta. */
    listeners: number;
}

/**
 * Read one payload as a listener event, or `undefined` if it is not one.
 *
 * The count is what the whole feed is here for: Icecast reports the source's
 * listener count as a total, which is what `AudienceWatch.report` wants and what
 * a delta could never safely be, since a dropped message would leave the station
 * airing to a room that emptied. Measured against Icecast 2.5.0, one frame is:
 *
 * ```json
 * { "type": "event", "mount": "/live.mp3",
 *   "crude": { "trigger": "source-listener-attach", "uri": "/live.mp3",
 *              "source-listener-count": "1", "connection-ip": "…" } }
 * ```
 *
 * So the fields live under `crude` and the count arrives as a STRING — neither of
 * which is visible in the event source that describes them. Both spellings are
 * accepted (`crude` first, then the top level) rather than only the observed one,
 * because the envelope is the part upstream is most likely to move.
 *
 * The TRIGGER is not filtered on, only kept. 2.5 emits several that carry a
 * count (`source-listeners-changed`, `source-listeners-is-zero`,
 * `source-listener-attach`) and the set is upstream's to grow; a count attached
 * to our mount is a count whatever the event was called, and pinning a list here
 * would silently stop hearing about listeners on the version that renames one.
 */
export function listenerEvent(payload: string): ListenerEvent | undefined {
    let body: unknown;
    try {
        body = JSON.parse(payload) as unknown;
    } catch {
        return undefined;
    }

    if (typeof body !== 'object' || body === null) return undefined;
    const outer = body as Record<string, unknown>;
    const inner = typeof outer.crude === 'object' && outer.crude !== null ? (outer.crude as Record<string, unknown>) : {};

    const text = (key: string): string => {
        const value = inner[key] ?? outer[key];
        return typeof value === 'string' ? value : '';
    };

    // `uri` is the source's own name for the mount; `mount` is the envelope's, and
    // 2.5 sends both. Either identifies it.
    const uri = text('uri') || text('mount');
    const trigger = text('trigger');
    // A count rendered as a string is the same answer as one rendered as a number,
    // and 2.5 sends the string.
    const listeners = Number(inner['source-listener-count'] ?? outer['source-listener-count']);
    if (!uri || !Number.isFinite(listeners) || listeners < 0) return undefined;

    return { trigger, uri, listeners: Math.trunc(listeners) };
}

/**
 * Whether an event's `uri` names the mount being watched.
 *
 * Tolerant of a mount written with or without its leading slash, and of a `uri`
 * that arrives as a whole URL rather than a path, for the same reason the stats
 * parse is: the two endpoints spell it differently and neither is wrong.
 */
export function isMountUri(uri: string, mount: string): boolean {
    if (!uri) return false;

    const path = mount.startsWith('/') ? mount : `/${mount}`;
    try {
        return new URL(uri).pathname === path;
    } catch {
        // Not a URL, so it is the path itself.
        return (uri.startsWith('/') ? uri : `/${uri}`) === path;
    }
}
