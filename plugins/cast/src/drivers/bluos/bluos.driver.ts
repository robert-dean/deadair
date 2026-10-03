import { PluginError, toPluginError, type OutputMetadata, type OutputPlayRequest, type PluginHost } from '@deadair/plugin-sdk';

import type { SpeakerDriver, SpeakerStatus, SpeakerTarget, SpeakerTraits } from '../speaker.driver.js';
import { attribute, text } from '../xml.js';

/** The port every BluOS player answers its HTTP API on. */
export const BLUOS_PORT = 11000;

/** How long one call may take. A player on the LAN answers in milliseconds. */
export const BLUOS_REQUEST_TIMEOUT_MS = 4_000;

/** What a BluOS player plays from a radio URL that the station publishes. */
const BLUOS_ACCEPTS = ['audio/mpeg', 'audio/aac'];

/** Whether what a player is on is the station's stream, something else, or nothing it will name. */
export type StreamMatch = 'ours' | 'other' | 'absent';

/**
 * Drives a BluOS player (Bluesound, NAD, Dali and the rest) through its HTTP API on port 11000.
 *
 * A port of the desktop app's BluOS plugin (`apps/desktop/plugins/bluos`), which measured every rule
 * here against a real player, and the lessons come with it (`apps/desktop/CLAUDE.md` § "Plugins:
 * BluOS"):
 *
 * - `/Play` on the URL already playing does nothing, so a stream that went quiet is stopped first.
 * - Starting a stream takes seconds and reads as `connecting`, then as playing with no seconds yet:
 *   both are starting, never a failure.
 * - A pause and a stream that stopped arriving look the same, and both read as stopped.
 * - A player on another source is somebody's choice, and is reported, never interrupted.
 *
 * Nothing is held open between calls, so nothing needs letting go of.
 */
export class BluOsDriver implements SpeakerDriver {
    readonly protocol = 'bluos';
    readonly label = 'BluOS (Bluesound, NAD)';

    /** The URL last played on each player, for telling the station's stream from somebody else's. */
    private readonly played = new Map<string, string>();

    async describe(host: PluginHost, target: SpeakerTarget): Promise<SpeakerTraits> {
        const traits: SpeakerTraits = { accepts: BLUOS_ACCEPTS, followsMetadata: false };
        try {
            const sync = await get(host, target, 'SyncStatus');
            const model = [attribute(sync, 'SyncStatus', 'brand'), attribute(sync, 'SyncStatus', 'modelName')].filter(Boolean).join(' ');
            return model === '' ? traits : { ...traits, model };
        } catch {
            return traits;
        }
    }

    async play(host: PluginHost, target: SpeakerTarget, request: OutputPlayRequest): Promise<void> {
        const status = await get(host, target, 'Status');
        const state = text(status, 'state');
        if (stopFirst(state, match(text(status, 'streamUrl'), request.url))) await get(host, target, 'Stop');

        const query = new URLSearchParams({ url: request.url, title1: request.metadata.title });
        if (request.metadata.artworkUrl !== undefined) query.set('image', request.metadata.artworkUrl);
        const answer = await get(host, target, `Play?${query.toString()}`);
        // `/Play` answers with the state it moved to, and a player that cannot take the URL says so here.
        if (/^\s*<error/i.test(answer))
            throw new PluginError(`the player refused the stream: ${text(answer, 'error') ?? 'no reason given'}`).withCode('upstream');
        this.played.set(target.id, request.url);
    }

    async updateMetadata(_host: PluginHost, _target: SpeakerTarget, _metadata: OutputMetadata): Promise<void> {
        // Not called: a BluOS player shows the stream's own titles, second line per record.
    }

    async stop(host: PluginHost, target: SpeakerTarget): Promise<void> {
        const status = await get(host, target, 'Status');
        const state = text(status, 'state')?.toLowerCase();
        const played = this.played.get(target.id);
        this.played.delete(target.id);

        if (state === undefined || state === '' || state === 'stop') return;
        // Another source is somebody's choice. With no record of what it played (the station
        // restarted since), being asked to stop is taken at its word.
        if (played !== undefined && match(text(status, 'streamUrl'), played) === 'other') return;
        await get(host, target, 'Stop');
    }

    async status(host: PluginHost, target: SpeakerTarget): Promise<SpeakerStatus> {
        let status: string;
        try {
            status = await get(host, target, 'Status');
        } catch (error) {
            return { phase: 'unreachable', detail: toPluginError(error).message };
        }
        return phaseOf(text(status, 'state'), numberOf(text(status, 'secs')), text(status, 'streamUrl'));
    }

    dispose(): void {
        this.played.clear();
    }
}

/** The player's base address for what the operator typed: a bare host, `host:port`, or a URL. */
export function bluosBase(address: string): string {
    const trimmed = address.trim();
    const parsed = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);
    return `http://${parsed.hostname}:${parsed.port === '' ? BLUOS_PORT : parsed.port}`;
}

/**
 * Whether a player's `streamUrl` is the station's. By containment rather than equality, as the
 * desktop found: a player may report the URL with its own decoration around it.
 */
export function match(streamUrl: string | undefined, ours: string | undefined): StreamMatch {
    if (streamUrl === undefined || streamUrl.trim() === '') return 'absent';
    if (ours === undefined) return 'other';
    return streamUrl.toLowerCase().includes(ours.toLowerCase()) ? 'ours' : 'other';
}

/** Whether to send `/Stop` before `/Play`: only when it is on our stream and not already stopped. */
export function stopFirst(state: string | undefined, matched: StreamMatch): boolean {
    if (matched !== 'ours') return false;
    const word = state?.trim().toLowerCase();
    return word !== undefined && word !== '' && word !== 'stop';
}

/**
 * Reads a `/Status` as an output phase. The URL goes back as the player reported it, so the host
 * tells the station's stream from anything else by the URL it handed over.
 */
export function phaseOf(state: string | undefined, secs: number | undefined, streamUrl: string | undefined): SpeakerStatus {
    const word = state?.trim().toLowerCase();
    // The http(s) URL inside whatever the player wraps it in: one that filed the station under TuneIn
    // reports `TuneIn:https://...`, and the host compares the URL it handed over exactly.
    const reported = streamUrl?.trim() ?? '';
    const url = reported === '' ? undefined : (/https?:\/\/\S+/i.exec(reported)?.[0] ?? reported);
    const withUrl = (status: SpeakerStatus): SpeakerStatus => (url === undefined ? status : { ...status, url });

    switch (word) {
        case 'stop':
            return url === undefined ? { phase: 'idle' } : withUrl({ phase: 'stopped' });
        case 'pause':
            return withUrl({ phase: 'stopped', detail: 'paused, or the stream stopped arriving' });
        case 'connecting':
            return withUrl({ phase: 'opening' });
        case 'stream':
        case 'play':
            return withUrl({ phase: secs === undefined || secs === 0 ? 'buffering' : 'playing' });
        default:
            return withUrl({ phase: 'opening', ...(word === undefined || word === '' ? {} : { detail: `the player says ${word}` }) });
    }
}

function numberOf(value: string | undefined): number | undefined {
    if (value === undefined || value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/** One GET against the player, answering the body. A non-200 is an `upstream` error. */
async function get(host: PluginHost, target: SpeakerTarget, path: string): Promise<string> {
    const response = await host.fetch(`${bluosBase(target.address)}/${path}`, { timeoutMs: BLUOS_REQUEST_TIMEOUT_MS });
    const body = await response.text();
    if (!response.ok) throw new PluginError(`the player answered ${response.status}`).withCode('upstream').withUpstreamStatus(response.status);
    return body;
}
