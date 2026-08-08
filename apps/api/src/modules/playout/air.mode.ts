/**
 * What puts the station on air.
 *
 * deadair holds the mount on a lease it has to keep renewing (see
 * `stream/README.md`), and this decides what the renewal is conditional on:
 *
 * - `audience` — renew only while somebody is listening. Producing audio costs a
 *   provider fetch and a download per track on a rate-limited account, and an
 *   empty mount is the one case where nobody benefits from that. The station
 *   stays exactly where it was and picks up when the next listener arrives.
 * - `always` — renew whenever there is a programme, which is what deadair did
 *   before there was a choice. For a station that has to be on whether or not
 *   anyone is currently connected: a relay downstream, a recording, an operator
 *   who wants the running order to keep moving.
 *
 * A runtime knob, so it lives in `deadair.settings` rather than the environment
 * or a column: env is for what the app needs before a database exists, and this
 * is a decision an operator changes from the console. It is per install, which
 * is right while there is one station — if the deferred multi-station work lands
 * it moves onto the station row, where the mount it governs will live.
 */

/** The `deadair.settings` key. Dot-keyed, like every other setting. */
export const AIR_MODE_KEY = 'playout.airMode';

export type AirMode = 'audience' | 'always';

/**
 * What an install with nothing stored gets.
 *
 * `audience`, deliberately, and that includes a station upgrading into this: a
 * mount airing to nobody is the thing being fixed, so the fix has to be what
 * happens by default rather than something to opt into.
 */
export const DEFAULT_AIR_MODE: AirMode = 'audience';

export const AIR_MODES: readonly AirMode[] = ['audience', 'always'];

/**
 * Read a stored value as a mode.
 *
 * An unset key and an unrecognised one both fall back to {@link DEFAULT_AIR_MODE}
 * rather than throwing. This is read on the reconcile path, and a station that
 * refused to air because someone typed a bad value into a settings row would be
 * a worse failure than the one it was guarding against.
 */
export function parseAirMode(raw: string | undefined): AirMode {
    return AIR_MODES.includes(raw as AirMode) ? (raw as AirMode) : DEFAULT_AIR_MODE;
}
