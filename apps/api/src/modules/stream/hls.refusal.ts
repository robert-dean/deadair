import type { AppConfig } from '@maroonedsoftware/appconfig';

/**
 * Whom the station will not serve its playlists to.
 *
 * An HLS listener is anonymous by construction — a `GET` for a playlist, no session, no account —
 * so the only thing an operator can name is what the client says it IS. This is the list of those
 * names, matched against `User-Agent`.
 *
 * ## Why this exists at all
 *
 * A station with `playout.airMode: audience` produces a programme because somebody is listening,
 * and the audience register cannot tell a person from a program: both fetch the playlist, both are
 * counted, and one of them is worth writing breaks and rendering speech for. Measured on the live
 * station: a single client on the operator's own network pulled the MP3 variant continuously for
 * days under two user agents — a Go fetcher and the FFmpeg reader it handed the URL to — and kept
 * the station on air around the clock for nobody at all. Nothing was broken. The station was
 * behaving exactly as designed, for an audience that turned out to be a machine.
 *
 * So the answer is not a smarter count. It is the operator being able to say "not that one", which
 * is a judgement only they can make: the same user agent is a robot on one station and somebody's
 * hi-fi on another.
 *
 * ## Why a setting rather than an environment variable or an nginx rule
 *
 * The edge could do this — a `map` on the user agent and a `return 403` beside the playlist
 * location — and that is where the temporary version of this lived while it was being worked out.
 * It is the wrong home for the permanent one. An nginx rule is baked into the image, so changing
 * whom the station refuses means a rebuild and a container recreate, and it is invisible to the
 * operator standing in front of the settings page wondering why their new player gets nothing.
 * `deadair.settings` is a live layer of `AppConfig`, so a change here applies to the next request
 * with no restart, and it shows up where every other decision about the stream already is.
 *
 * What that costs is the SEGMENTS, which nginx serves off the volume and the app never sees. A
 * refused client keeps whatever segment names its last playlist told it about, and then stops:
 * a live playlist is the only way to learn the next ones, so refusing it stalls a player within
 * one window (six segments, eighteen seconds by default). That is a delay in the client stopping,
 * not a hole — and the register, which counts served playlists only, drops it after fifteen
 * seconds either way.
 */

/** The setting. A string, like every other one; see `apps/api/CLAUDE.md`. */
export const HLS_REFUSE_KEY = 'stream.hlsRefuseAgents';

/** Nobody, which is the only safe default: a station refuses whom it was asked to and nobody else. */
export const HLS_REFUSE_DEFAULT = '';

/**
 * The list an operator typed, as something matchable.
 *
 * Split on whitespace AND commas, because a list of names is written both ways and the entries
 * themselves never contain either: a user agent's product token (`Lavf/59.27.100`,
 * `Go-http-client/1.1`) is one unbroken word, and the spaces in a full user-agent string only ever
 * appear between tokens. So an operator pasting a whole browser user agent gets its tokens as
 * separate entries rather than one entry that matches nothing, which is the failure that would be
 * hardest to see from the settings page.
 *
 * Lowercased here so the match below can be, and deduplicated so a list edited twice does not do
 * the same work twice per request.
 */
export function parseRefusedAgents(raw: unknown): string[] {
    return [
        ...new Set(
            String(raw ?? '')
                .split(/[\s,]+/)
                .map(entry => entry.trim().toLowerCase())
                .filter(entry => entry.length > 0),
        ),
    ];
}

/**
 * Whether this caller is one of them.
 *
 * A case-insensitive SUBSTRING rather than a prefix or an exact match, so `Lavf/` covers every
 * version of it and an operator does not have to come back when the client updates. The cost is
 * that a short entry is a wide net — `go` would refuse anything with `go` anywhere in its user
 * agent — which is why the setting's help text says to use the product token.
 *
 * A caller with NO user agent is never refused. A list of names cannot match the absence of one,
 * and the alternative reading — that anything anonymous is suspect — would refuse hardware players
 * that send nothing, which are the listeners least able to tell anybody why they went quiet.
 */
export function agentIsRefused(refused: string[], userAgent: unknown): boolean {
    if (refused.length === 0) return false;
    if (typeof userAgent !== 'string' || userAgent.trim() === '') return false;

    const agent = userAgent.toLowerCase();
    return refused.some(entry => agent.includes(entry));
}

/**
 * The two above, against the config, for the one caller that has both.
 *
 * Read PER REQUEST, which is the deliberate difference from `TRUST_PROXY` beside it in the
 * middleware: whether the edge can be believed is a property of the deployment and is read once at
 * construction, while this is a list the operator edits in the console and expects to take effect
 * on the next request rather than on the next restart.
 */
export function refusesAgent(config: AppConfig, userAgent: unknown): boolean {
    return agentIsRefused(parseRefusedAgents(config.get(HLS_REFUSE_KEY, HLS_REFUSE_DEFAULT)), userAgent);
}
