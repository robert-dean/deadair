import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import type { SourceDocument } from '@deadair/plugin-sdk';
import type { EnrichmentPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PROVIDER_CAPABILITIES, pluginsInOrder } from '#modules/plugins/plugin.providers.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * How long one plugin may take over a subject: a search and a few pages, each bounded by the plugin's own
 * timeouts. An album's enrichment budget, which is the nearest thing to it, with a page more.
 */
export const RESEARCH_TOPIC_TIMEOUT_MS = 48_000;

/** How many pages a production researched from its subject reads, at most, across every plugin. */
export const MAX_TOPIC_DOCUMENTS = 4;

/**
 * Finding pages about a production's subject, for one asked to research itself.
 *
 * Asks every enrichment plugin that implements the optional `enrichTopic`, in the station's enrichment
 * order, and keeps the first {@link MAX_TOPIC_DOCUMENTS} pages they hand back. In practice that is the web
 * search plugin, which searches only the operator's trusted sites and reads only what it finds there: the
 * station quotes sites its operator chose, never whatever an engine ranked first, and that line is the
 * plugin's and the host allowlist's rather than anything here.
 *
 * A plugin that fails costs its own pages and nothing else, since having three pages instead of four is
 * not a failure. Having none is, and the caller says so.
 */
@Injectable()
export class TopicResearcher {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** Whether any installed plugin can research a subject at all. */
    canResearch(): boolean {
        return this.researchers().length > 0;
    }

    async documentsAbout(subject: string): Promise<SourceDocument[]> {
        const documents: SourceDocument[] = [];
        const seen = new Set<string>();

        for (const plugin of this.researchers()) {
            if (documents.length >= MAX_TOPIC_DOCUMENTS) break;
            try {
                const answer = await this.pluginInvoker.invoke(
                    plugin.record.id,
                    'enrichment.enrichTopic',
                    async () => await plugin.instance.enrichTopic!({ query: subject }),
                    { timeoutMs: RESEARCH_TOPIC_TIMEOUT_MS },
                );
                for (const document of answer.documents ?? []) {
                    if (documents.length >= MAX_TOPIC_DOCUMENTS) break;
                    if (seen.has(document.url) || document.text.trim().length === 0) continue;
                    seen.add(document.url);
                    documents.push(document);
                }
            } catch (error) {
                this.logger.info('productions: a plugin could not research a subject', { plugin: plugin.record.id, error: errorText(error) });
            }
        }

        return documents;
    }

    private researchers(): EnrichmentPlugin[] {
        return pluginsInOrder(this.pluginRegistry.list(), this.config, PROVIDER_CAPABILITIES.enrichment).filter(
            plugin => typeof plugin.instance.enrichTopic === 'function',
        );
    }
}
