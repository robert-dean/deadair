import type { AppConfig } from '@maroonedsoftware/appconfig';
import { pluginOrder } from '#modules/plugins/plugin.order.js';
import { LYRICS_KEYS } from './lyrics.keys.js';

/**
 * Orders two lyric rows by whose word the station takes: the operator's `lyrics.providerOrder`, then by
 * id.
 *
 * Read from the setting rather than from the installed plugins, because a row a since-removed plugin
 * wrote is still a lyric somebody matched. The vocal markers and the served lyrics both sort through
 * this, so the record's timing and the words a client shows always come from the same source.
 */
export function lyricsProviderRank(config: AppConfig): (left: { provider: string }, right: { provider: string }) => number {
    const order = pluginOrder(config, LYRICS_KEYS.providerOrder);
    const rank = (provider: string) => {
        const listed = order.indexOf(provider);
        return listed === -1 ? order.length : listed;
    };
    return (left, right) => rank(left.provider) - rank(right.provider) || left.provider.localeCompare(right.provider);
}
