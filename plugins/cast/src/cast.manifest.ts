import { PLUGIN_CAPABILITY_OUTPUT, type ConfigFieldOption, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.cast';
export const PLUGIN_VERSION = '0.0.1';

/** The settings key holding the speakers, and the allowlist entry that reads their addresses. */
export const DEVICES_FIELD = 'devices';

export const configSchema = z.object({
    devices: z.string().optional(),
});

export type CastConfig = z.infer<typeof configSchema>;

/**
 * The manifest, for the protocols the plugin was built with.
 *
 * A function of the drivers rather than a constant, so the protocol column offers exactly what the
 * plugin can drive: a choice with no driver behind it is a speaker that can never play.
 */
export function castManifest(protocols: ConfigFieldOption[]): PluginManifest {
    return {
        id: PLUGIN_ID,
        name: 'Speakers',
        version: PLUGIN_VERSION,
        capabilities: [PLUGIN_CAPABILITY_OUTPUT],
        apiVersion: '^1.0.0',
        description:
            'Plays the station on speakers and televisions on your network: anything with Chromecast built in, a Sonos, or a UPnP/DLNA renderer such as an AV receiver.',
        permissions: {
            // Every speaker is an address the operator typed in, and nothing else is reached.
            network: [{ fromConfig: DEVICES_FIELD }],
            // A Cast device is driven over TLS on port 8009, with its own framing.
            tls: true,
            storage: false,
            oauth: false,
        },
        configFields: [
            {
                key: 'about',
                label: 'How this works',
                type: 'note',
                help:
                    'Each speaker fetches the station’s stream itself, from the public address in the station’s stream settings, so ' +
                    'that address has to be one the speaker can reach. A speaker playing the station counts as a listener.',
            },
            {
                key: DEVICES_FIELD,
                label: 'Speakers',
                type: 'list',
                help:
                    'One row per speaker. For a Chromecast or a Sonos, the address is the one your router gave it; a fixed one in your ' +
                    'router’s settings stops it moving. For any other UPnP/DLNA renderer, paste the full address of its description ' +
                    '(an http:// URL ending in .xml), which a UPnP browser shows; some move it when they restart.',
                columns: [
                    { key: 'name', label: 'Name', type: 'string', required: true, placeholder: 'Kitchen' },
                    { key: 'protocol', label: 'Kind', type: 'select', required: true, options: protocols },
                    { key: 'address', label: 'Address', type: 'url', required: true, placeholder: '192.168.1.20' },
                ],
            },
        ],
        configSchema,
    };
}
