import { describe, expect, it, vi } from 'vitest';

import type { UpstreamItem } from '../src/ytmusic.mapping.js';
import { pageOf, rowsOf, walk } from '../src/ytmusic.paging.js';

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
