import { dirname, join, resolve } from 'node:path';
import type { AppConfig } from '@maroonedsoftware/appconfig';

/**
 * The log files this install has, and the ONLY place a source id becomes something on disk.
 *
 * A closed table, deliberately. The plugin log routes have to push their id through `safeChannel`
 * because a plugin id comes out of a third-party manifest and could be anything; nothing here came
 * from a request. `LogsService` looks a requested id up in this table and 404s when it is not in it,
 * so no operator-supplied string ever reaches a path or a `Content-Disposition` header. Adding a
 * source means adding a row here, which is the point.
 */

/** How a source's lines are read back. */
export type LogSourceKind =
    /** The app's own channel in the process-wide `RotatingLogStore`: rotated, redacted, level-tagged. */
    | 'store'
    /** A plain file some other process appends to, in a format this app does not own and does not parse. */
    | 'file';

/** One row of the table. */
export interface LogSourceDescriptor {
    id: string;
    label: string;
    description: string;
    kind: LogSourceKind;
    /** Whether its lines carry a level this API can filter on. True only for the store. */
    levels: boolean;
    /** For `kind: 'file'`, the file's name inside {@link streamLogsDir}. Absent for the store. */
    filename?: string;
}

/** The app's own log. Its id, held apart because the service branches on it. */
export const APP_LOG_SOURCE_ID = 'api';

/**
 * Every source, in the order the console offers them: the station's own first, then the two the
 * audio chain writes, in the order a problem travels through them.
 */
export const LOG_SOURCES: readonly LogSourceDescriptor[] = [
    {
        id: APP_LOG_SOURCE_ID,
        label: 'Station',
        description: "The station's own log: every subsystem, plus whatever the plugins wrote through it.",
        kind: 'store',
        levels: true,
    },
    {
        id: 'liquidsoap',
        label: 'Audio chain',
        description: 'What plays, what ducks under what, and what is handed to the stream. Written by Liquidsoap, in its own format.',
        kind: 'file',
        levels: false,
        filename: 'liquidsoap.log',
    },
    {
        id: 'shim',
        label: 'Track shim',
        description: 'The fetcher that turns a provider stream into something the audio chain can play, and its restart loop.',
        kind: 'file',
        levels: false,
        filename: 'spotify-shim.log',
    },
];

/** The descriptor for `id`, or `undefined` when nothing by that name is a source. */
export function logSourceById(id: string): LogSourceDescriptor | undefined {
    return LOG_SOURCES.find(source => source.id === id);
}

/**
 * Where the audio chain and the shim put their logs.
 *
 * `STREAM_LOGS_DIR` when an operator has set one, and otherwise DERIVED from `LOGS_DIR` as its
 * sibling `streamlogs`. That derivation is not a guess: in the production image `LOGS_DIR` is
 * `/data/logs` and the stream's logs are at `/data/streamlogs`, both set by the Dockerfile, so the
 * deployment this matters most for needs no new variable at all.
 *
 * It is deliberately wrong in the compose dev tree, where the API runs on the host with `LOGS_DIR`
 * at `apps/api/logs` while the stream container writes to `.docvol/streamlogs`. The derived path
 * does not exist there, both sources report themselves absent, and that is the honest answer for a
 * process that genuinely cannot see those files — an operator who wants them points
 * `STREAM_LOGS_DIR` at `../../.docvol/streamlogs`.
 *
 * Not in `deploy/.env.example`, on that file's own closing instruction: nothing else belongs in it,
 * and the derivation is already right for the deployment it describes.
 */
export function streamLogsDir(config: AppConfig): string {
    const configured = config.get('STREAM_LOGS_DIR', '');
    if (typeof configured === 'string' && configured.length > 0) return resolve(configured);

    const logsDir = resolve(String(config.get('LOGS_DIR', './logs')));
    return join(dirname(logsDir), 'streamlogs');
}

/** The absolute path a `kind: 'file'` source reads, or `undefined` for the store-backed one. */
export function logSourcePath(source: LogSourceDescriptor, config: AppConfig): string | undefined {
    if (source.filename === undefined) return undefined;
    return join(streamLogsDir(config), source.filename);
}
