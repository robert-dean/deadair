import { PluginError, type PluginHost } from '@deadair/plugin-sdk';

import { elements, escapeXml, text } from '../xml.js';

/** The port a Sonos serves its description on, and the path. */
export const SONOS_PORT = 1400;
export const SONOS_DESCRIPTION_PATH = '/xml/device_description.xml';

/** How long a description or one SOAP call may take: a device on the LAN answers in milliseconds. */
export const UPNP_REQUEST_TIMEOUT_MS = 4_000;

/** One service a renderer offers, as its description declares it. */
export interface UpnpService {
    /** The full type, version included: an action is named against exactly this. */
    type: string;
    /** Absolute. */
    controlUrl: string;
}

/** What the driver needs from a renderer's description. */
export interface UpnpRenderer {
    friendlyName?: string;
    manufacturer?: string;
    model?: string;
    avTransport: UpnpService;
    connectionManager?: UpnpService;
    /** A Sonos, which needs its own radio URI and takes only MP3 and AAC for one. */
    sonos: boolean;
}

/**
 * The description URL for what the operator typed.
 *
 * A full URL is used as it is: most renderers serve their description wherever they like, often on
 * a port chosen at boot, so the only address that finds them is the one discovery reported. A bare
 * host is taken to be a Sonos, whose description is always at the same place, since that is the one
 * renderer an operator can name without looking anything up.
 */
export function descriptionUrl(address: string): string {
    const trimmed = address.trim();
    if (trimmed.includes('://')) return trimmed;
    const [host, port] = trimmed.split(':');
    return `http://${host}:${port ?? SONOS_PORT}${SONOS_DESCRIPTION_PATH}`;
}

/** Reads a renderer's description. Throws when it cannot be fetched, or offers no AVTransport. */
export async function readRenderer(host: PluginHost, address: string): Promise<UpnpRenderer> {
    const url = descriptionUrl(address);
    const response = await host.fetch(url, { timeoutMs: UPNP_REQUEST_TIMEOUT_MS });
    if (!response.ok) {
        await response.body?.cancel();
        throw new PluginError(`the speaker's description answered ${response.status}`).withCode('upstream').withUpstreamStatus(response.status);
    }
    return parseDescription(await response.text(), response.url || url);
}

/** Parses a description. `base` resolves relative control URLs, as the specification says it should. */
export function parseDescription(xml: string, base: string): UpnpRenderer {
    const urlBase = text(xml, 'URLBase');
    const resolve = (path: string): string => new URL(path, urlBase || base).toString();

    const services = elements(xml, 'service').map(service => ({ type: text(service, 'serviceType') ?? '', control: text(service, 'controlURL') }));
    const find = (kind: string): UpnpService | undefined => {
        const service = services.find(candidate => candidate.type.includes(`:service:${kind}:`) && candidate.control !== undefined);
        return service === undefined ? undefined : { type: service.type, controlUrl: resolve(service.control!) };
    };

    const avTransport = find('AVTransport');
    if (avTransport === undefined) throw new PluginError('this device is not a media renderer: it offers no AVTransport').withCode('config');

    const manufacturer = text(xml, 'manufacturer');
    const connectionManager = find('ConnectionManager');
    return {
        avTransport,
        ...(connectionManager === undefined ? {} : { connectionManager }),
        ...optional('friendlyName', text(xml, 'friendlyName')),
        ...optional('manufacturer', manufacturer),
        ...optional('model', text(xml, 'modelName')),
        sonos: /sonos/i.test(manufacturer ?? ''),
    };
}

/**
 * Calls one SOAP action and answers the response body.
 *
 * A fault is a `PluginError` carrying the device's own description of it, which is the only useful
 * thing a renderer ever says when it refuses something.
 */
export async function soap(host: PluginHost, service: UpnpService, action: string, args: Record<string, string> = {}): Promise<string> {
    const body =
        '<?xml version="1.0" encoding="utf-8"?>' +
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
        `<s:Body><u:${action} xmlns:u="${service.type}">` +
        Object.entries(args)
            .map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`)
            .join('') +
        `</u:${action}></s:Body></s:Envelope>`;

    const response = await host.fetch(service.controlUrl, {
        method: 'POST',
        headers: { 'content-type': 'text/xml; charset="utf-8"', soapaction: `"${service.type}#${action}"` },
        body,
        timeoutMs: UPNP_REQUEST_TIMEOUT_MS,
    });
    const answer = await response.text();
    if (!response.ok) {
        const description = text(answer, 'errorDescription') ?? text(answer, 'faultstring') ?? `HTTP ${response.status}`;
        const code = text(answer, 'errorCode');
        throw new PluginError(`${action} was refused: ${description}${code === undefined ? '' : ` (${code})`}`).withCode('upstream');
    }
    return answer;
}

/** Content types under the names devices use for them, folded to the names the station uses. */
const CONTENT_TYPE_ALIASES: Record<string, string> = {
    'audio/mp3': 'audio/mpeg',
    'audio/x-mpeg': 'audio/mpeg',
    'audio/x-mp3': 'audio/mpeg',
    'audio/x-aac': 'audio/aac',
    'audio/vnd.dlna.adts': 'audio/aac',
    'audio/x-flac': 'audio/flac',
    'application/ogg': 'audio/ogg',
    'application/x-mpegurl': 'application/vnd.apple.mpegurl',
    'audio/x-mpegurl': 'application/vnd.apple.mpegurl',
};

/**
 * The content types a renderer plays, from `GetProtocolInfo`'s `Sink`: a comma-separated list of
 * `protocol:network:contentType:info`, of which only HTTP entries mean anything here.
 */
export function sinkContentTypes(protocolInfo: string): string[] {
    const sink = text(protocolInfo, 'Sink') ?? '';
    const types = sink
        .split(',')
        .map(entry => entry.trim().split(':'))
        .filter(parts => parts[0] === 'http-get' && parts[2] !== undefined && parts[2] !== '*' && parts[2].includes('/'))
        .map(parts => (parts[2] as string).toLowerCase())
        .map(type => CONTENT_TYPE_ALIASES[type] ?? type)
        // Only what a stream can be: a renderer that also shows photos lists those too.
        .filter(type => type.startsWith('audio/') || type === 'application/vnd.apple.mpegurl');
    return [...new Set(types)];
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
    return value === undefined || value === '' ? {} : ({ [key]: value } as Record<K, string>);
}
