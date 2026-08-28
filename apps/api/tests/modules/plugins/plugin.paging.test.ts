// `pluginPages` terminates on a short page, and on nothing else except the cap.
// The cap is what is tested here, because for as long as this existed it was
// reported at `warn` and nowhere a caller could reach: a walk that ran out of
// pages returned exactly like one that ran out of data, and the catalog sweep
// read the two as the same thing and would have retired every binding past page
// 200. `onTruncated` is the difference, so what matters is that it fires when the
// data was cut short and stays quiet when it was not.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { PLUGIN_MAX_PAGES, PLUGIN_PAGE_SIZE, pluginPages } from '../../../src/modules/plugins/plugin.paging.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const stubLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
});

function build() {
    const registry = new PluginRegistry();
    registry.upsert({ id: 'p', dir: '/plugins/p', status: 'active' });
    return { invoker: new PluginInvoker(registry, stubPluginLog().log), logger: stubLogger() };
}

/** A page of `PLUGIN_PAGE_SIZE` items, which is what tells the walk to ask again. */
const fullPage = (offset: number): number[] => Array.from({ length: PLUGIN_PAGE_SIZE }, (_, i) => offset + i);

async function drain<T>(pages: AsyncGenerator<T>): Promise<T[]> {
    const items: T[] = [];
    for await (const item of pages) items.push(item);
    return items;
}

describe('pluginPages', () => {
    it('stops at a short page without calling onTruncated', async () => {
        // The ordinary ending. A caller that acts on having seen everything is
        // entitled to, and nothing should suggest otherwise.
        const { invoker, logger } = build();
        const onTruncated = vi.fn();

        const items = await drain(
            pluginPages(invoker, logger, { pluginId: 'p', op: 'catalog.listPlaylists', incomplete: 'its catalog', onTruncated }, async offset =>
                offset === 0 ? fullPage(0) : [999],
            ),
        );

        expect(items).toHaveLength(PLUGIN_PAGE_SIZE + 1);
        expect(onTruncated).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('calls onTruncated when a provider that ignores offset runs it into the cap', async () => {
        // The failure the callback exists for: every page is full, so the walk
        // never reaches an ending of its own and the cap is what stops it.
        const { invoker, logger } = build();
        const onTruncated = vi.fn();

        const items = await drain(
            pluginPages(invoker, logger, { pluginId: 'p', op: 'catalog.getPlaylistTracks', incomplete: 'its catalog', onTruncated }, async offset =>
                fullPage(offset),
            ),
        );

        expect(items).toHaveLength(PLUGIN_MAX_PAGES * PLUGIN_PAGE_SIZE);
        expect(onTruncated).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('page cap'), expect.objectContaining({ plugin: 'p' }));
    });

    it('still warns at the cap when no caller asked to be told', async () => {
        // The playlist read passes no callback and is unchanged by this: an
        // optional hook must not become a condition of the warning.
        const { invoker, logger } = build();

        await drain(
            pluginPages(invoker, logger, { pluginId: 'p', op: 'catalog.getPlaylistTracks', incomplete: 'this list' }, async offset =>
                fullPage(offset),
            ),
        );

        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('page cap'), expect.objectContaining({ plugin: 'p' }));
    });

    it('does not call onTruncated when an abort stops the walk early', async () => {
        // A cancelled walk is incomplete too, but the caller already knows: it
        // owns the signal. Reporting it as a truncation would blame the provider
        // for a shutdown.
        const { invoker, logger } = build();
        const onTruncated = vi.fn();
        const controller = new AbortController();

        const items = await drain(
            pluginPages(
                invoker,
                logger,
                { pluginId: 'p', op: 'catalog.listPlaylists', incomplete: 'its catalog', onTruncated, signal: controller.signal },
                async offset => {
                    controller.abort();
                    return fullPage(offset);
                },
            ),
        );

        expect(items).toHaveLength(PLUGIN_PAGE_SIZE);
        expect(onTruncated).not.toHaveBeenCalled();
    });
});
