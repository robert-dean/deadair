import type { UpstreamItem } from './ytmusic.mapping.js';

/** A page of rows plus the thing that fetches the next one, or nothing when this was the last. */
export interface Page {
    items: UpstreamItem[];
    next?: () => Promise<Page>;
}

/** Bounds a continuation walk, so a pathological playlist cannot spend the whole call budget. */
export const MAX_PAGES = 40;

interface ShapedNode {
    items?: UpstreamItem[];
    contents?: unknown;
}

/**
 * Rows out of whatever the library handed back, whichever of its four shapes that is.
 *
 * There genuinely are four, and the difference between two of them is why this function is
 * recursive rather than a couple of property reads. A search answers `contents` as an ARRAY of
 * shelves; a playlist answers `items` directly; a playlist continuation answers `contents` as an
 * array of rows. And a SEARCH continuation answers `contents` as a single `MusicShelfContinuation`
 * OBJECT rather than an array of shelves, which is the one that is easy to miss, because the page
 * before it in the very same walk was an array.
 *
 * That was not a hypothetical: a reader that handled only the array cases found no rows on page two
 * of a search, which stopped the walk. The visible symptom was `searchTracks` honouring a `limit` of
 * 45 with 20 rows — the SDK's "limit is a total, not a page size" rule broken in the one way that
 * looks like a thin search rather than like a bug.
 */
export function rowsOf(result: unknown, depth = 0): UpstreamItem[] {
    if (!result || typeof result !== 'object' || depth > 3) return [];

    const node = result as ShapedNode;
    if (Array.isArray(node.items)) return node.items;

    const contents = node.contents;
    if (Array.isArray(contents)) {
        const rows = contents as (UpstreamItem & { contents?: UpstreamItem[] })[];
        // A shelf is a row with rows inside it; a plain row is not.
        return rows.some(entry => Array.isArray(entry?.contents)) ? rows.flatMap(entry => entry?.contents ?? []) : rows;
    }

    // One shelf rather than a list of them, which is what a search continuation answers.
    return rowsOf(contents, depth + 1);
}

/** Wraps a library result as a {@link Page}, carrying its continuation when it has one. */
export function pageOf(result: unknown): Page {
    const node = result as { getContinuation?: () => Promise<unknown> } | undefined;
    const items = rowsOf(result);
    if (typeof node?.getContinuation !== 'function') return { items };

    return {
        items,
        next: async () => {
            // A continuation that has run out throws rather than answering an empty page, and that
            // is an ordinary end-of-list here rather than a failure to report.
            try {
                return pageOf(await node.getContinuation!());
            } catch {
                return { items: [] };
            }
        },
    };
}

/**
 * Walk pages until `limit` rows are in hand, or the pages run out.
 *
 * `limit` is a TOTAL in the SDK's contract rather than a page size, and this provider's own page is
 * about twenty rows for a search and about a hundred for a playlist. Answering one upstream page
 * and stopping would be indistinguishable from a genuinely thin result.
 */
export async function walk(first: Page, limit?: number): Promise<UpstreamItem[]> {
    const wanted = limit !== undefined && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;
    const collected = [...first.items];

    let page = first;
    for (let index = 1; index < MAX_PAGES; index++) {
        if (wanted !== undefined && collected.length >= wanted) break;
        if (!page.next) break;

        page = await page.next();
        if (page.items.length === 0) break;
        collected.push(...page.items);
    }

    return wanted === undefined ? collected : collected.slice(0, wanted);
}
