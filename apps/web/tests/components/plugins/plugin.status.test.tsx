import { describe, expect, it } from 'vitest';

import { feedsTrackFetcher } from '../../../src/components/plugins/plugin.status';
import { pluginSummary } from '../../utils/plugin.fixture';

describe('feedsTrackFetcher', () => {
    it('is true for a plugin that uses the station track fetcher', () => {
        expect(feedsTrackFetcher(pluginSummary({ capabilities: ['catalog', 'stream', 'oauth'], usesTrackFetcher: true }))).toBe(true);
    });

    // What this read before: Navidrome declares `stream` because it can put a record on air, by
    // minting its own URLs, and was offered a Spotify fetcher login on the strength of it.
    it('is false for a plugin that streams without the fetcher', () => {
        const navidrome = pluginSummary({
            id: 'deadair.navidrome',
            name: 'Navidrome',
            capabilities: ['catalog', 'stream', 'enrichment'],
            usesTrackFetcher: false,
        });

        expect(feedsTrackFetcher(navidrome)).toBe(false);
    });

    it('is false when the station does not say, which is what an older one sends', () => {
        expect(feedsTrackFetcher(pluginSummary({ capabilities: ['catalog', 'stream'] }))).toBe(false);
    });
});
