import type { RequestedRecord } from '../actions/request.reading.js';

/**
 * What the settings panel and the plugin say to each other, beyond the settings themselves.
 *
 * The panel never sends the settings here: it writes them as global settings, the Stream Deck app
 * hands them to the plugin, and the plugin checks what it was handed. So the answer the panel shows
 * is always about the settings the keys are actually using.
 *
 * The search is the same arrangement for the same reason. The panel asks the PLUGIN to search, and
 * the plugin asks the station with the station and key it is using, so a record found here is a
 * record the keys can ask for. The panel never calls the station itself, which would put the key in
 * a browser page for the sake of one search.
 */
export type ToPlugin = { event: 'testConnection' } | { event: 'searchRecords'; q: string };

/**
 * One record a search found, as the panel lists it and as a key saves it.
 *
 * Already reduced to what is saved and what is shown, in the plugin, so what crosses to the panel is
 * plain JSON rather than the SDK's own types, and the panel decides nothing about a search row.
 */
export type FoundRecord = { record: RequestedRecord; title: string; by: string };

/** A search's answer: the records found and the station they were found on, or why there are none. */
export type RecordsFound = { event: 'records'; q: string; records: FoundRecord[]; station: string } | { event: 'records'; q: string; text: string };

export type ToInspector = { event: 'connection'; ok: boolean; text: string } | RecordsFound;

export function isToPlugin(value: unknown): value is ToPlugin {
    if (typeof value !== 'object' || value === null) return false;
    const message = value as { event?: unknown; q?: unknown };
    return message.event === 'testConnection' || (message.event === 'searchRecords' && typeof message.q === 'string');
}

export function isToInspector(value: unknown): value is ToInspector {
    if (typeof value !== 'object' || value === null) return false;
    const message = value as Record<string, unknown>;
    if (message.event === 'connection') return typeof message.ok === 'boolean' && typeof message.text === 'string';
    if (message.event === 'records') {
        return (
            typeof message.q === 'string' &&
            ((Array.isArray(message.records) && typeof message.station === 'string') || typeof message.text === 'string')
        );
    }
    return false;
}
