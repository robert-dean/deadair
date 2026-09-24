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

/**
 * A walk that stops where the caller stopped asking, and carries on from there next time.
 *
 * The host reads a playlist fifty rows at a time and gives each read its own deadline, and YouTube
 * answers about a hundred rows per upstream page. {@link walk} read the WHOLE playlist on the first
 * call and served the rest from a memo, so page one cost every upstream page there was: a playlist of
 * a few thousand records spent the entire call budget before answering anything, and a scheduled
 * block built on one was refused at every boundary. This reads only as far as the offset asked for,
 * so every call costs about one upstream page however long the playlist is.
 *
 * Calls are serialised, because a sync and a changeover can read the same playlist at once and two
 * walks advancing one continuation would each skip the other's page.
 */
export class PageCursor {
    private readonly rows: UpstreamItem[] = [];
    private next?: () => Promise<Page>;
    private started = false;
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly first: () => Promise<Page>) {}

    /**
     * The rows from the start up to `end`, or every row there is when `end` is absent, fetching only
     * what has not been fetched yet. At most {@link MAX_PAGES} upstream pages per call, so a caller
     * that jumps far ahead is answered short rather than timed out, and asks again.
     */
    through(end?: number): Promise<readonly UpstreamItem[]> {
        const run = this.queue.then(() => this.extend(end));
        // A failed read must not poison the next call: it tries again from where this one got to.
        this.queue = run.catch(() => undefined);
        return run;
    }

    private async extend(end: number | undefined): Promise<readonly UpstreamItem[]> {
        for (let fetched = 0; fetched < MAX_PAGES; fetched++) {
            if (end !== undefined && this.rows.length >= end) break;
            if (this.started && !this.next) break;

            const page = this.started ? await this.next!() : await this.first();
            this.started = true;
            this.next = page.items.length === 0 ? undefined : page.next;
            this.rows.push(...page.items);
        }
        return this.rows;
    }
}
