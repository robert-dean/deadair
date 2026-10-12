// Finding pages about a production's subject. The trust line itself is the web search plugin's and the
// host allowlist's; what is pinned here is that only plugins implementing `enrichTopic` are asked, that
// the pages are bounded and de-duplicated, and that one plugin failing costs only its own pages.

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { describe, expect, it, vi } from 'vitest';

import { MAX_TOPIC_DOCUMENTS, TopicResearcher } from '../../../src/modules/productions/topic.researcher.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;

const page = (url: string) => ({ url, title: url, text: `What ${url} says.`, retrievedAt: '2026-10-12T08:00:00.000Z' });

const enrichmentPlugin = (id: string, enrichTopic?: () => Promise<unknown>) => ({
    id,
    dir: `/plugins/${id}`,
    status: 'active',
    manifest: { capabilities: ['enrichment'] },
    instance: { enrichTrack: async () => ({}), ...(enrichTopic === undefined ? {} : { enrichTopic }) },
});

function build(records: unknown[]) {
    const invoke = vi.fn(async (_id: string, _op: string, work: () => Promise<unknown>) => await work());
    return new TopicResearcher({ list: () => records } as never, { invoke } as never, config, logger as never);
}

describe('TopicResearcher', () => {
    it('asks only the plugins that can research a subject', async () => {
        const researcher = build([
            enrichmentPlugin('deadair.musicbrainz'),
            enrichmentPlugin('deadair.websearch', async () => ({ documents: [page('a')] })),
        ]);

        expect(researcher.canResearch()).toBe(true);
        expect(await researcher.documentsAbout('lighthouse keepers')).toEqual([page('a')]);
    });

    it('keeps no more pages than it reads, and none twice', async () => {
        const many = Array.from({ length: MAX_TOPIC_DOCUMENTS + 2 }, (_, at) => page(`p${at}`));
        const researcher = build([
            enrichmentPlugin('deadair.a', async () => ({ documents: [page('p0'), page('p0')] })),
            enrichmentPlugin('deadair.b', async () => ({ documents: many })),
        ]);

        const documents = await researcher.documentsAbout('lighthouse keepers');

        expect(documents).toHaveLength(MAX_TOPIC_DOCUMENTS);
        expect(new Set(documents.map(document => document.url)).size).toBe(MAX_TOPIC_DOCUMENTS);
    });

    it('carries on past a plugin that failed', async () => {
        const researcher = build([
            enrichmentPlugin('deadair.a', async () => {
                throw new Error('the engine is down');
            }),
            enrichmentPlugin('deadair.b', async () => ({ documents: [page('b')] })),
        ]);

        expect(await researcher.documentsAbout('lighthouse keepers')).toEqual([page('b')]);
    });

    it('cannot research anything with no plugin that implements it', () => {
        expect(build([enrichmentPlugin('deadair.musicbrainz')]).canResearch()).toBe(false);
    });
});
