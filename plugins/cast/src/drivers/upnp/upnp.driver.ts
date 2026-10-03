import { toPluginError, type DiscoveredService, type OutputMetadata, type OutputPlayRequest, type PluginHost } from '@deadair/plugin-sdk';

import type { FoundSpeaker, SpeakerDriver, SpeakerStatus, SpeakerTarget, SpeakerTraits } from '../speaker.driver.js';
import { readRenderer, sinkContentTypes, soap, type UpnpRenderer } from './upnp.device.js';
import { escapeXml, text } from '../xml.js';

/** What a Sonos plays from a radio URL, and what any renderer is assumed to play when it will not say. */
const SONOS_ACCEPTS = ['audio/mpeg', 'audio/aac'];
const FALLBACK_ACCEPTS = ['audio/mpeg'];

/** The scheme a Sonos wants a plain-HTTP radio stream under, so it treats it as live rather than as a file. */
const SONOS_RADIO_SCHEME = 'x-rincon-mp3radio://';

/** How long a renderer may report STOPPED or no media after a play and still be starting. */
export const UPNP_OPENING_GRACE_MS = 15_000;

/** What this driver last asked a device to play, for telling the station's stream from anybody else's. */
interface Played {
    url: string;
    at: number;
}

/**
 * Drives a UPnP/DLNA media renderer through its AVTransport service: an AV receiver, a television,
 * a networked speaker, and a Sonos.
 *
 * A Sonos is a quirk of this driver rather than a driver of its own, because it IS a UPnP renderer
 * and differs in three small ways: a bare address finds it (its description is always at the same
 * place), it wants a plain-HTTP radio stream under its own `x-rincon-mp3radio://` scheme, and it
 * plays only MP3 and AAC from one.
 *
 * Every call is plain HTTP through `host.fetch`, so nothing is held open between calls. The
 * description is read once and kept until a call fails, since some renderers move to a new port
 * when they restart.
 */
export class UpnpDriver implements SpeakerDriver {
    readonly protocol = 'upnp';
    readonly label = 'UPnP / DLNA (Sonos, receivers, televisions)';
    readonly discovery = { protocol: 'ssdp', searchTarget: 'urn:schemas-upnp-org:device:MediaRenderer:1' } as const;

    private readonly renderers = new Map<string, UpnpRenderer>();
    private readonly played = new Map<string, Played>();

    /**
     * A renderer announces where its description is, and its unique name. Its friendly name is only
     * in the description, which {@link describe} reads and answers with.
     */
    found(service: DiscoveredService): FoundSpeaker | undefined {
        if (service.location === undefined) return undefined;
        const key = service.name.split('::')[0] ?? service.name;
        return { key, name: service.address, address: service.location };
    }

    async describe(host: PluginHost, target: SpeakerTarget): Promise<SpeakerTraits> {
        let renderer: UpnpRenderer;
        try {
            renderer = await this.renderer(host, target);
        } catch {
            return { accepts: FALLBACK_ACCEPTS, followsMetadata: false };
        }

        const model = [renderer.manufacturer, renderer.model].filter(Boolean).join(' ') || undefined;
        const traits = (accepts: string[]): SpeakerTraits => ({
            accepts,
            followsMetadata: false,
            ...(model === undefined ? {} : { model }),
            ...(renderer.friendlyName === undefined ? {} : { name: renderer.friendlyName }),
        });
        if (renderer.sonos || renderer.connectionManager === undefined) return traits(renderer.sonos ? SONOS_ACCEPTS : FALLBACK_ACCEPTS);

        try {
            const types = sinkContentTypes(await soap(host, renderer.connectionManager, 'GetProtocolInfo'));
            // MP3 first, whatever order the device listed them in: it is the station's floor.
            const accepts = types.includes('audio/mpeg') ? ['audio/mpeg', ...types.filter(type => type !== 'audio/mpeg')] : types;
            return traits(accepts.length > 0 ? accepts : FALLBACK_ACCEPTS);
        } catch {
            return traits(FALLBACK_ACCEPTS);
        }
    }

    async play(host: PluginHost, target: SpeakerTarget, request: OutputPlayRequest): Promise<void> {
        const renderer = await this.renderer(host, target);
        const uri = renderer.sonos ? sonosUri(request.url) : request.url;

        await this.call(host, target, renderer, 'SetAVTransportURI', {
            InstanceID: '0',
            CurrentURI: uri,
            CurrentURIMetaData: didl(request, renderer.sonos ? request.url : uri),
        });
        await this.call(host, target, renderer, 'Play', { InstanceID: '0', Speed: '1' });
        this.played.set(target.id, { url: request.url, at: Date.now() });
    }

    async updateMetadata(_host: PluginHost, _target: SpeakerTarget, _metadata: OutputMetadata): Promise<void> {
        // Not called: a renderer is told what it plays with the URI, and telling it again restarts
        // the stream. `followsMetadata` says so; a Sonos reads the stream's own titles anyway.
    }

    async stop(host: PluginHost, target: SpeakerTarget): Promise<void> {
        const renderer = await this.renderer(host, target);
        const media = await this.call(host, target, renderer, 'GetMediaInfo', { InstanceID: '0' });
        const current = fromTransportUri(text(media, 'CurrentURI') ?? '');
        const played = this.played.get(target.id);
        this.played.delete(target.id);

        // Somebody else's choice on the same receiver is not this plugin's to interrupt. With no record
        // of what it played (the station restarted since), being asked to stop is taken at its word.
        if (current === '' || (played !== undefined && current !== played.url)) return;
        await this.call(host, target, renderer, 'Stop', { InstanceID: '0' });
    }

    async status(host: PluginHost, target: SpeakerTarget): Promise<SpeakerStatus> {
        let state: string;
        let current: string;
        try {
            const renderer = await this.renderer(host, target);
            state = text(await this.call(host, target, renderer, 'GetTransportInfo', { InstanceID: '0' }), 'CurrentTransportState') ?? '';
            current = fromTransportUri(text(await this.call(host, target, renderer, 'GetMediaInfo', { InstanceID: '0' }), 'CurrentURI') ?? '');
        } catch (error) {
            return { phase: 'unreachable', detail: toPluginError(error).message };
        }

        const played = this.played.get(target.id);
        const starting = played !== undefined && Date.now() - played.at < UPNP_OPENING_GRACE_MS;
        const withUrl = (status: SpeakerStatus): SpeakerStatus => (current === '' ? status : { ...status, url: current });

        switch (state) {
            case 'PLAYING':
                return withUrl({ phase: 'playing' });
            case 'TRANSITIONING':
                return withUrl({ phase: 'buffering' });
            // A paused live stream is not coming back on its own; it reads as stopped.
            case 'PAUSED_PLAYBACK':
            case 'PAUSED_RECORDING':
                return withUrl({ phase: 'stopped', detail: 'paused on the device' });
            default:
                if (starting) return withUrl({ phase: 'opening' });
                return current === '' ? { phase: 'idle' } : withUrl({ phase: 'stopped' });
        }
    }

    dispose(): void {
        this.renderers.clear();
        this.played.clear();
    }

    private async renderer(host: PluginHost, target: SpeakerTarget): Promise<UpnpRenderer> {
        const known = this.renderers.get(target.id);
        if (known !== undefined) return known;
        const renderer = await readRenderer(host, target.address);
        this.renderers.set(target.id, renderer);
        return renderer;
    }

    /** One AVTransport action. A failure forgets the description, since the device may have moved. */
    private async call(
        host: PluginHost,
        target: SpeakerTarget,
        renderer: UpnpRenderer,
        action: string,
        args: Record<string, string>,
    ): Promise<string> {
        try {
            return await soap(host, renderer.avTransport, action, args);
        } catch (error) {
            this.renderers.delete(target.id);
            throw error;
        }
    }
}

/** The URI a Sonos is handed: its radio scheme for plain HTTP, and HTTPS as it is. */
export function sonosUri(url: string): string {
    return url.startsWith('http://') ? `${SONOS_RADIO_SCHEME}${url.slice('http://'.length)}` : url;
}

/** Undoes {@link sonosUri}, so a Sonos's answer can be compared with the URL the station handed it. */
export function fromTransportUri(uri: string): string {
    return uri.startsWith(SONOS_RADIO_SCHEME) ? `http://${uri.slice(SONOS_RADIO_SCHEME.length)}` : uri;
}

/** The DIDL-Lite a renderer reads the title, the artist line and the artwork from. */
export function didl(request: OutputPlayRequest, resource: string): string {
    const { title, subtitle, artworkUrl } = request.metadata;
    return (
        '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
        'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
        '<item id="deadair" parentID="0" restricted="1">' +
        `<dc:title>${escapeXml(title)}</dc:title>` +
        (subtitle === undefined ? '' : `<upnp:artist>${escapeXml(subtitle)}</upnp:artist>`) +
        (artworkUrl === undefined ? '' : `<upnp:albumArtURI>${escapeXml(artworkUrl)}</upnp:albumArtURI>`) +
        '<upnp:class>object.item.audioItem.audioBroadcast</upnp:class>' +
        `<res protocolInfo="http-get:*:${escapeXml(request.contentType)}:*">${escapeXml(resource)}</res>` +
        '</item></DIDL-Lite>'
    );
}
