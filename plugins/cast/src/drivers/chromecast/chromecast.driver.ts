import { PluginError, type OutputMetadata, type OutputPlayRequest, type PluginHost } from '@deadair/plugin-sdk';

import type { SpeakerDriver, SpeakerStatus, SpeakerTarget, SpeakerTraits } from '../speaker.driver.js';
import { CAST_NS, CAST_RECEIVER_ID, CastChannel, type CastPayload } from './cast.channel.js';

/** Google's Default Media Receiver: the app every Cast device has, which plays a URL it is given. */
export const DEFAULT_MEDIA_RECEIVER = 'CC1AD845';

/** The port every Cast device listens for senders on. */
export const CAST_PORT = 8009;

/**
 * How long a device may report IDLE after a LOAD and still be starting rather than stopped.
 *
 * A live stream takes a few seconds to begin, and the receiver reports IDLE with no reason while it
 * connects. Reading that as stopped would have the host play it again in the middle of starting.
 */
export const CAST_OPENING_GRACE_MS = 15_000;

/** `MusicTrackMediaMetadata` in the Cast media protocol. */
const METADATA_MUSIC_TRACK = 3;

/** The Cast app session this plugin started on one device, as the device last described it. */
interface CastSession {
    transportId: string;
    sessionId: string;
    url: string;
    loadedAt: number;
}

/** The part of a RECEIVER_STATUS this reads. */
interface ReceiverApp {
    appId?: string;
    sessionId?: string;
    transportId?: string;
    displayName?: string;
}

/**
 * Drives a Chromecast, or anything with Cast built in, through the Default Media Receiver.
 *
 * Play is: ask the device what it is running, launch the Default Media Receiver if it is not that,
 * connect to the app's own session, and LOAD the station's URL as a LIVE stream. The device then
 * fetches the mount itself. Stop asks the platform to stop that app, which returns the screen or
 * speaker to whatever it shows when idle.
 *
 * One connection per device, kept between calls and replaced when it closes. Nothing is retried
 * here: the host owns deciding a cast is still wanted (see `capabilities/output.ts`).
 */
export class ChromecastDriver implements SpeakerDriver {
    readonly protocol = 'chromecast';
    readonly label = 'Chromecast (Google Cast)';

    private readonly channels = new Map<string, Promise<CastChannel>>();
    private readonly sessions = new Map<string, CastSession>();

    async describe(): Promise<SpeakerTraits> {
        // MP3 and AAC, the formats every Cast device plays from a plain HTTP stream. Opus and FLAC
        // are on the platform's list too, but in containers the station's Ogg mounts are not, so
        // offering them is a cast that fails on the device rather than here.
        return { accepts: ['audio/mpeg', 'audio/aac'], followsMetadata: false };
    }

    async play(host: PluginHost, target: SpeakerTarget, request: OutputPlayRequest): Promise<void> {
        const channel = await this.channel(host, target);
        const app = await this.ensureMediaReceiver(channel);

        await channel.request(CAST_NS.media, app.transportId, {
            type: 'LOAD',
            autoplay: true,
            currentTime: 0,
            media: {
                contentId: request.url,
                contentUrl: request.url,
                contentType: request.contentType,
                streamType: 'LIVE',
                metadata: castMetadata(request.metadata),
            },
        });

        this.sessions.set(target.id, { transportId: app.transportId, sessionId: app.sessionId, url: request.url, loadedAt: Date.now() });
    }

    async updateMetadata(_host: PluginHost, _target: SpeakerTarget, _metadata: OutputMetadata): Promise<void> {
        // Not called: the Default Media Receiver shows what it was given at LOAD, and changing it
        // means loading again, which restarts the stream. `followsMetadata` says so to the host.
    }

    async stop(host: PluginHost, target: SpeakerTarget): Promise<void> {
        const channel = await this.channel(host, target);
        const app = runningApp(await channel.request(CAST_NS.receiver, CAST_RECEIVER_ID, { type: 'GET_STATUS' }));
        this.sessions.delete(target.id);

        // Only the Default Media Receiver: somebody watching something else on the same television
        // is not this plugin's to interrupt.
        if (app?.appId === DEFAULT_MEDIA_RECEIVER && app.sessionId !== undefined) {
            await channel.request(CAST_NS.receiver, CAST_RECEIVER_ID, { type: 'STOP', sessionId: app.sessionId });
        }
    }

    async status(host: PluginHost, target: SpeakerTarget): Promise<SpeakerStatus> {
        let channel: CastChannel;
        let app: ReceiverApp | undefined;
        try {
            channel = await this.channel(host, target);
            app = runningApp(await channel.request(CAST_NS.receiver, CAST_RECEIVER_ID, { type: 'GET_STATUS' }));
        } catch (error) {
            return { phase: 'unreachable', detail: (error as Error).message };
        }

        const session = this.sessions.get(target.id);
        if (app?.appId !== DEFAULT_MEDIA_RECEIVER || app.transportId === undefined) {
            if (session !== undefined) return { phase: 'stopped', detail: app?.displayName ? `now showing ${app.displayName}` : undefined };
            return { phase: 'idle' };
        }

        let media: CastPayload | undefined;
        try {
            const answer = await channel.request(CAST_NS.media, app.transportId, { type: 'GET_STATUS' });
            media = Array.isArray(answer.status) ? (answer.status[0] as CastPayload | undefined) : undefined;
        } catch (error) {
            return { phase: 'unreachable', detail: (error as Error).message };
        }

        return mediaPhase(media, session);
    }

    dispose(): void {
        for (const pending of this.channels.values())
            void pending.then(
                channel => channel.close(),
                () => undefined,
            );
        this.channels.clear();
        this.sessions.clear();
    }

    /** The open connection to a device, opening one when there is none or the last one closed. */
    private async channel(host: PluginHost, target: SpeakerTarget): Promise<CastChannel> {
        const existing = this.channels.get(target.id);
        if (existing !== undefined) {
            const channel = await existing.catch(() => undefined);
            if (channel !== undefined && !channel.closed) return channel;
        }

        const opening = CastChannel.open(host, castUrl(target.address), { label: target.name });
        this.channels.set(target.id, opening);
        try {
            const channel = await opening;
            channel.onClose(() => {
                if (this.channels.get(target.id) === opening) this.channels.delete(target.id);
            });
            return channel;
        } catch (error) {
            if (this.channels.get(target.id) === opening) this.channels.delete(target.id);
            throw error;
        }
    }

    /** The Default Media Receiver's session on this device, launching it when something else is running. */
    private async ensureMediaReceiver(channel: CastChannel): Promise<{ transportId: string; sessionId: string }> {
        let app = runningApp(await channel.request(CAST_NS.receiver, CAST_RECEIVER_ID, { type: 'GET_STATUS' }));
        if (app?.appId !== DEFAULT_MEDIA_RECEIVER) {
            // Launching takes a few seconds on a television; the answer comes when it is up.
            app = runningApp(await channel.request(CAST_NS.receiver, CAST_RECEIVER_ID, { type: 'LAUNCH', appId: DEFAULT_MEDIA_RECEIVER }, 15_000));
        }
        if (app?.appId !== DEFAULT_MEDIA_RECEIVER || app.transportId === undefined || app.sessionId === undefined) {
            throw new PluginError('the device did not start its media player').withCode('upstream');
        }
        return { transportId: app.transportId, sessionId: app.sessionId };
    }
}

/**
 * `tls://host:8009` from whatever the operator typed: a bare address, `host:port`, or a URL in any
 * scheme, of which only the host and an explicit port are kept.
 */
export function castUrl(address: string): string {
    const trimmed = address.trim();
    const parsed = new URL(trimmed.includes('://') ? trimmed : `tls://${trimmed}`);
    return `tls://${parsed.hostname}:${parsed.port === '' ? CAST_PORT : parsed.port}`;
}

/** The app in the foreground of a RECEIVER_STATUS, if any. */
function runningApp(answer: CastPayload): ReceiverApp | undefined {
    const status = answer.status as { applications?: ReceiverApp[] } | undefined;
    return status?.applications?.[0];
}

function castMetadata(metadata: OutputMetadata): CastPayload {
    return {
        metadataType: METADATA_MUSIC_TRACK,
        title: metadata.title,
        ...(metadata.subtitle === undefined ? {} : { artist: metadata.subtitle }),
        ...(metadata.artworkUrl === undefined ? {} : { images: [{ url: metadata.artworkUrl }] }),
    };
}

/** Reads a MEDIA_STATUS entry as an output phase. */
function mediaPhase(media: CastPayload | undefined, session: CastSession | undefined): SpeakerStatus {
    const url =
        typeof (media?.media as CastPayload | undefined)?.contentId === 'string' ? ((media?.media as CastPayload).contentId as string) : session?.url;
    const withUrl = (status: SpeakerStatus): SpeakerStatus => (url === undefined ? status : { ...status, url });
    const starting = session !== undefined && Date.now() - session.loadedAt < CAST_OPENING_GRACE_MS;

    switch (media?.playerState) {
        case 'PLAYING':
            return withUrl({ phase: 'playing' });
        case 'BUFFERING':
        case 'LOADING':
            return withUrl({ phase: 'buffering' });
        // A live stream that is paused is not coming back on its own; it reads as stopped, the way
        // the desktop's BluOS player found a pause and a dead stream impossible to tell apart.
        case 'PAUSED':
            return withUrl({ phase: 'stopped', detail: 'paused on the device' });
        default: {
            const reason = typeof media?.idleReason === 'string' ? media.idleReason : undefined;
            if (reason === undefined && starting) return withUrl({ phase: 'opening' });
            if (reason === undefined && session === undefined) return withUrl({ phase: 'idle' });
            return withUrl({ phase: 'stopped', ...(reason === undefined ? {} : { detail: idleDetail(reason) }) });
        }
    }
}

function idleDetail(reason: string): string {
    switch (reason) {
        case 'ERROR':
            return 'the device could not play the stream';
        case 'INTERRUPTED':
            return 'something else started playing';
        case 'CANCELLED':
            return 'stopped on the device';
        case 'FINISHED':
            return 'the stream ended';
        default:
            return reason.toLowerCase();
    }
}
