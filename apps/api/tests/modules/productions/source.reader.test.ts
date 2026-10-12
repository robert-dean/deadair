// Reading a page somebody named. The station never opens one from Node: it asks whichever installed news
// plugin implements `readPage`, in plugin order, and the first document wins. What is pinned is the
// order, the reason an operator reads when nothing could, and that a plugin without the method is
// never asked.

import { describe, expect, it, vi } from 'vitest';

import { SourceReader, siteOf } from '../../../src/modules/productions/source.reader.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const DOCUMENT = {
    url: 'https://example.com/808',
    title: 'A history of the 808',
    text: 'It came out in 1980.',
    retrievedAt: '2026-10-12T08:00:00.000Z',
};

/** A news plugin record as the registry holds one, with or without `readPage`. */
const newsPlugin = (id: string, readPage?: (url: string) => Promise<unknown>) => ({
    id,
    dir: `/plugins/${id}`,
    status: 'active',
    manifest: { capabilities: ['news'] },
    instance: { listFeeds: async () => [], fetchItems: async () => [], ...(readPage === undefined ? {} : { readPage }) },
});

function build(records: unknown[]) {
    const invoke = vi.fn(async (_id: string, _op: string, work: () => Promise<unknown>) => await work());
    const reader = new SourceReader({ list: () => records } as never, { invoke } as never, logger as never);
    return { reader, invoke };
}

describe('SourceReader', () => {
    it('asks the plugins that can read a page, in plugin order, and takes the first document', async () => {
        const first = vi.fn(async () => undefined);
        const second = vi.fn(async () => DOCUMENT);
        const { reader } = build([newsPlugin('deadair.z', second), newsPlugin('deadair.a', first), newsPlugin('deadair.feeds')]);

        expect(await reader.read('https://example.com/808')).toEqual(DOCUMENT);
        expect(first).toHaveBeenCalledWith('https://example.com/808');
        expect(second).toHaveBeenCalled();
    });

    it('says which site it could not read, and why, when nothing could', async () => {
        const { reader } = build([
            newsPlugin('deadair.rss', async () => {
                throw new Error('503 from the publisher');
            }),
        ]);

        await expect(reader.read('https://example.com/808')).rejects.toThrow('could not read example.com (deadair.rss: 503 from the publisher)');
    });

    it('says how to fix it when no installed plugin can read a page at all', async () => {
        const { reader, invoke } = build([newsPlugin('deadair.feeds')]);

        await expect(reader.read('https://example.com/808')).rejects.toThrow('no installed plugin can read a page');
        expect(invoke).not.toHaveBeenCalled();
    });
});

describe('siteOf', () => {
    it('is the host of an address, and the text itself when it is not one', () => {
        expect(siteOf('https://www.example.com/a/b?c')).toBe('www.example.com');
        expect(siteOf('not an address')).toBe('not an address');
    });
});
