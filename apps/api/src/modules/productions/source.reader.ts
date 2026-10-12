import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { SourceDocument } from '@deadair/plugin-sdk';
import { asNewsPlugin, type NewsPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { byPluginId, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * How long one page may take, end to end. Longer than the invoker's default, because a whole page is
 * the point of the call rather than a garnish on it, and nothing on the air is waiting for it.
 */
export const READ_PAGE_TIMEOUT_MS = 20_000;

/**
 * Reading a page somebody named, through whichever installed plugin can.
 *
 * The station does not fetch arbitrary pages from Node. `host.fetch` is a plugin's, behind that plugin's
 * own network grant, and a page an operator names is on no allowlist a manifest could write down. So the
 * page is read by a news plugin that implements `readPage`, which in practice is the RSS plugin: it
 * already opens whatever page a feed links to, under a `network.open` grant the operator answered, and the
 * private-address check that grant carries applies here too.
 *
 * Several plugins may implement it; they are asked in `byPluginId` order and the first document wins.
 * Optional on a capability with no single pick, on `enrichArtist`'s terms, so it cannot become the
 * disagreeing selection `plugin.selection.ts` exists to prevent.
 */
@Injectable()
export class SourceReader {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly logger: Logger,
    ) {}

    /**
     * The page as a document. Throws with a sentence an operator can act on when nothing could read it,
     * since the caller is a research pass that fails the production with exactly that reason.
     */
    async read(url: string): Promise<SourceDocument> {
        const readers = this.readers();
        if (readers.length === 0) {
            throw new Error('no installed plugin can read a page; the RSS plugin can, once it is allowed to open the web');
        }

        const failures: string[] = [];
        for (const plugin of readers) {
            try {
                const document = await this.pluginInvoker.invoke(
                    plugin.record.id,
                    'news.readPage',
                    async () => await plugin.instance.readPage!(url),
                    {
                        timeoutMs: READ_PAGE_TIMEOUT_MS,
                    },
                );
                if (document !== undefined) return document;
                failures.push(`${plugin.record.id} found no prose on it`);
            } catch (error) {
                this.logger.info('productions: a plugin could not read a page', {
                    plugin: plugin.record.id,
                    site: siteOf(url),
                    error: errorText(error),
                });
                failures.push(`${plugin.record.id}: ${errorText(error)}`);
            }
        }

        throw new Error(`could not read ${siteOf(url)} (${failures.join('; ')})`);
    }

    private readers(): NewsPlugin[] {
        return pluginsWith(this.pluginRegistry.list(), asNewsPlugin)
            .filter(plugin => typeof plugin.instance.readPage === 'function')
            .sort(byPluginId);
    }
}

/** The site a page is on, for a reason an operator reads. The address itself when it is not one. */
export function siteOf(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}
