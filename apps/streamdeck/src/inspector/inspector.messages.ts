/**
 * What the settings panel and the plugin say to each other, beyond the global settings themselves.
 *
 * The panel never sends the settings here: it writes them as global settings, the Stream Deck app
 * hands them to the plugin, and the plugin checks what it was handed. So the answer the panel shows
 * is always about the settings the keys are actually using.
 */
export type ToPlugin = { event: 'testConnection' };

export type ToInspector = { event: 'connection'; ok: boolean; text: string };

export function isToPlugin(value: unknown): value is ToPlugin {
    return typeof value === 'object' && value !== null && (value as { event?: unknown }).event === 'testConnection';
}

export function isToInspector(value: unknown): value is ToInspector {
    const message = value as Partial<ToInspector> | null;
    return (
        typeof message === 'object' &&
        message !== null &&
        message.event === 'connection' &&
        typeof message.ok === 'boolean' &&
        typeof message.text === 'string'
    );
}
