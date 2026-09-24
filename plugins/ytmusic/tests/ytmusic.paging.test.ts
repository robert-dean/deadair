import { describe, expect, it, vi } from 'vitest';

import type { UpstreamItem } from '../src/ytmusic.mapping.js';
import { PageCursor, pageOf, rowsOf, walk, type Page } from '../src/ytmusic.paging.js';

const song = (id: string): UpstreamItem => ({ id, item_type: 'song', title: id });
const songs = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => song(`${prefix}${i}`));

/**
 * The four shapes, captured from live calls. Two of them differ WITHIN one walk, which is the whole
 * reason `rowsOf` exists rather than a property read at each call site.
 */
describe('rowsOf reads every shape the library answers', () => {
    it('a search: contents is an array of shelves', () => {
        expect(rowsOf({ contents: [{ contents: songs(2, 'a') }, { contents: songs(1, 'b') }] })).toHaveLength(3);
    });

    it('a playlist: items directly', () => {
        expect(rowsOf({ items: songs(4, 'p') })).toHaveLength(4);
    });

    it('a playlist continuation: contents is an array of rows', () => {
        expect(rowsOf({ contents: songs(3, 'c') })).toHaveLength(3);
    });

    it('a SEARCH continuation: contents is a single shelf OBJECT, not an array', () => {
        // The shape that broke the walk. Page one of the same search answers an array of shelves,
        // so a reader that handles only arrays finds nothing on page two and stops -- which shows up
        // as `limit: 45` honoured with 20 rows, indistinguishable from a genuinely thin search.
        const continuation = { contents: { type: 'MusicShelfContinuation', contents: songs(20, 's') } };
        expect(rowsOf(continuation)).toHaveLength(20);
    });

    it('answers nothing for a shape it does not recognise, rather than throwing', () => {
        expect(rowsOf(undefined)).toEqual([]);
        expect(rowsOf({ header: {} })).toEqual([]);
    });

    it('does not recurse forever on a self-referencing node', () => {
        const loop: Record<string, unknown> = {};
        loop.contents = loop;
        expect(rowsOf(loop)).toEqual([]);
    });
});

describe('walk', () => {
    /** Pages of 20, the way a search really answers, with page two in the continuation shape. */
    const search = () => {
        let page = 0;
        const build = (): unknown => {
            const rows = songs(20, `p${page}_`);
            const body = page === 0 ? { contents: [{ contents: rows }] } : { contents: { contents: rows } };
            page++;
            return { ...body, getContinuation: async () => build() };
        };
        return build();
    };

    it('treats limit as a total and pages until it is met', async () => {
        // The rule: a short answer is indistinguishable from a genuinely thin search, so page
        // internally rather than handing back one upstream page.
        expect(await walk(pageOf(search()), 45)).toHaveLength(45);
    });

    it('stops as soon as it has enough rather than fetching a page it will not use', async () => {
        const getContinuation = vi.fn();
        const rows = await walk(pageOf({ contents: [{ contents: songs(20, 'a') }], getContinuation }), 5);

        expect(rows).toHaveLength(5);
        expect(getContinuation).not.toHaveBeenCalled();
    });

    it('stops at the end of the list when there is no limit', async () => {
        expect(await walk(pageOf({ items: songs(7, 'x') }))).toHaveLength(7);
    });

    it('treats a throwing continuation as the end of the list', async () => {
        // Measured: a continuation that has run out throws rather than answering an empty page.
        const first = pageOf({
            items: songs(3, 'x'),
            getContinuation: async () => {
                throw new Error('Continuation not found.');
            },
        });
        expect(await walk(first, 100)).toHaveLength(3);
    });

    it('is bounded, so a pathological list cannot spend the whole call budget', async () => {
        const endless = (): unknown => ({ items: songs(1, 'e'), getContinuation: async () => endless() });
        const rows = await walk(pageOf(endless()));

        expect(rows.length).toBeLessThanOrEqual(40);
    });
});

describe('PageCursor', () => {
    /** Pages of `size` rows, `count` of them, counting how many were fetched. */
    const pages = (size: number, count: number) => {
        let fetched = 0;
        const at = (index: number): Page => {
            fetched++;
            return { items: songs(size, `p${index}_`), ...(index + 1 < count ? { next: async () => at(index + 1) } : {}) };
        };
        return { first: async () => at(0), fetched: () => fetched };
    };

    it('fetches only as far as it is asked', async () => {
        const source = pages(100, 10);
        const cursor = new PageCursor(source.first);

        expect((await cursor.through(50)).length).toBeGreaterThanOrEqual(50);
        expect(source.fetched()).toBe(1);

        await cursor.through(250);
        expect(source.fetched()).toBe(3);
    });

    it('reads to the end when no end is given, and stops there', async () => {
        const source = pages(10, 3);
        const cursor = new PageCursor(source.first);

        expect(await cursor.through()).toHaveLength(30);
        expect(await cursor.through(1_000)).toHaveLength(30);
        expect(source.fetched()).toBe(3);
    });

    it('serialises reads, so two callers at once do not each advance the continuation', async () => {
        const source = pages(10, 5);
        const cursor = new PageCursor(source.first);

        const [a, b] = await Promise.all([cursor.through(20), cursor.through(20)]);
        expect(a).toHaveLength(20);
        expect(b).toHaveLength(20);
        expect(source.fetched()).toBe(2);
    });

    it('carries on from where it got to after a failed read', async () => {
        let fail = true;
        const cursor = new PageCursor(async () => ({
            items: songs(10, 'a'),
            next: async () => {
                if (fail) {
                    fail = false;
                    throw new Error('upstream hiccup');
                }
                return { items: songs(10, 'b') };
            },
        }));

        await expect(cursor.through(20)).rejects.toThrow('upstream hiccup');
        expect(await cursor.through(20)).toHaveLength(20);
    });

    it('bounds one call, so a caller that jumps far ahead is answered short rather than timed out', async () => {
        const endless = (): Page => ({ items: songs(1, 'e'), next: async () => endless() });
        const cursor = new PageCursor(async () => endless());

        expect((await cursor.through(10_000)).length).toBeLessThanOrEqual(40);
    });
});
