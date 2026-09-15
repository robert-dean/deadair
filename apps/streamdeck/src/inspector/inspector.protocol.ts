import type { NowPlayingSettings } from '../actions/now.playing.options.js';
import { parseAddress, type StationSettings } from '../station/station.settings.js';
import type { ToPlugin } from './inspector.messages.js';

/**
 * What the settings panel sends the Stream Deck app, for the panel with this id opened on this action.
 *
 * The app's property-inspector protocol, by hand: it is six messages, and the library Elgato
 * suggests for it is a copy of somebody's script to vendor, where these can be type-checked beside
 * the plugin that answers them.
 */
export function inspectorMessages(uuid: string, action: string) {
    return {
        register: (event: string) => ({ event, uuid }),
        getGlobalSettings: () => ({ event: 'getGlobalSettings', context: uuid }),
        setGlobalSettings: (settings: StationSettings) => ({ event: 'setGlobalSettings', context: uuid, payload: settings }),
        /** The settings of the one key the panel was opened on. */
        setSettings: (settings: NowPlayingSettings) => ({ event: 'setSettings', context: uuid, payload: settings }),
        testConnection: () => ({ event: 'sendToPlugin', action, context: uuid, payload: { event: 'testConnection' } satisfies ToPlugin }),
        openUrl: (url: string) => ({ event: 'openUrl', payload: { url } }),
    };
}

/** The settings as typed: trimmed, and absent rather than empty. */
export function settingsFrom(address: string, apiKey: string): StationSettings {
    const typedAddress = address.trim();
    const typedKey = apiKey.trim();
    return { ...(typedAddress ? { address: typedAddress } : {}), ...(typedKey ? { apiKey: typedKey } : {}) };
}

/** The console's page for issuing a key, from whatever address has been typed, or nothing until it reads. */
export function keysPageFor(address: string | undefined): string | undefined {
    const parsed = parseAddress(address);
    return 'origin' in parsed ? `${parsed.origin}/settings/security` : undefined;
}
