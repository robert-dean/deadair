import type { PluginHost } from '@deadair/plugin-sdk';
import { Innertube, Log } from 'youtubei.js';

import { createHostFetch } from './ytmusic.fetch.js';
import { isUnavailable } from './ytmusic.errors.js';
import { LIKED_PLAYLIST_ID } from './ytmusic.manifest.js';
import type { UpstreamItem } from './ytmusic.mapping.js';

/** A page of rows plus the thing that fetches the next one, or nothing when this was the last. */
interface Page {
    items: UpstreamItem[];
    next?: () => Promise<Page>;
}

/** Bounds a continuation walk, so a pathological playlist cannot spend the whole call budget. */
const MAX_PAGES = 40;

/**
 * Rows out of whatever the library handed back.
 *
 * Search answers shelves of rows and a playlist answers rows directly, and continuations of either
 * answer a third shape again, so this reads both levels rather than encoding which one a given call
 * produces. Cheap, and it survives the shapes moving between majors.
 */
function rowsOf(result: unknown): UpstreamItem[] {
    const node = result as { items?: UpstreamItem[]; contents?: (UpstreamItem & { contents?: UpstreamItem[] })[] } | undefined;
    if (Array.isArray(node?.items)) return node.items;

    const contents = node?.contents;
    if (!Array.isArray(contents)) return [];
    // A shelf is a row with rows inside it; a plain row is not.
    return contents.some(entry => Array.isArray(entry?.contents)) ? contents.flatMap(entry => entry?.contents ?? []) : contents;
}

/** Wraps a library result as a {@link Page}, carrying its continuation when it has one. */
function pageOf(result: unknown): Page {
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
async function walk(first: Page, limit?: number): Promise<UpstreamItem[]> {
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
 * The InnerTube session and the four reads this plugin makes of it.
 *
 * Everything here goes out through `host.fetch` (see `createHostFetch`). Nothing in this file
 * catches its own errors into a value: the plugin above translates them, because only it knows
 * whether the call needed the credential, and that is the fact the translation turns on.
 */
export class YtMusicClient {
    private constructor(private readonly inner: Innertube) {}

    static async create(host: PluginHost, cookie: string): Promise<YtMusicClient> {
        // The library writes parser errors straight to the console. In-process that is the
        // station's own stdout rather than `host.logger`, so a plugin's upstream trouble would
        // surface as unattributed noise in the station log. Silenced here and reported through the
        // host instead.
        Log.setLevel();

        const inner = await Innertube.create({
            cookie,
            fetch: createHostFetch(host),
            // The player SCRIPT is the signature-deciphering path, which is only needed to turn a
            // format into a playable URL. This phase hands the station no audio, so fetching and
            // parsing it on every session would be work for nothing.
            retrieve_player: false,
        });

        return new YtMusicClient(inner);
    }

    /**
     * The account's own playlists.
     *
     * `getLibrary()` alone answers the library LANDING view, which is not the playlists. On a real
     * account it came back holding a podcast queue and nothing else. The Playlists view is behind
     * the chip, which is what `applyFilter` presses.
     */
    async libraryPlaylists(): Promise<UpstreamItem[]> {
        const library = await this.inner.music.getLibrary();
        const playlists = await library.applyFilter('Playlists');
        return rowsOf((playlists as { contents?: unknown[] })?.contents?.[0] ?? playlists);
    }

    /** A playlist's rows, all of them: paging is the caller's problem and it wants the whole thing once. */
    async playlistItems(playlistId: string): Promise<UpstreamItem[]> {
        const playlist = await this.inner.music.getPlaylist(playlistId);
        return await walk(pageOf(playlist));
    }

    /** The "Liked Music" list, which the library listing does not carry. */
    async likedPlaylist(): Promise<{ name?: string; items: UpstreamItem[] } | undefined> {
        try {
            const playlist = await this.inner.music.getPlaylist(LIKED_PLAYLIST_ID);
            const header = (playlist as { header?: { title?: { text?: string } } })?.header?.title?.text;
            return { name: header, items: rowsOf(playlist) };
        } catch {
            // An account with no liked music is not an error, and neither is a listing that has
            // moved. Either way there is simply no such playlist to offer.
            return undefined;
        }
    }

    /** Songs matching `query`, paging until `limit` of them are in hand. */
    async searchSongs(query: string, limit?: number): Promise<UpstreamItem[]> {
        const results = await this.inner.music.search(query, { type: 'song' });
        return await walk(pageOf(results), limit);
    }

    /** One record, or nothing when the upstream has no such video. */
    async track(trackId: string): Promise<UpstreamItem | undefined> {
        try {
            const info = await this.inner.music.getInfo(trackId);
            const basic = (info as { basic_info?: Record<string, unknown> })?.basic_info;
            if (!basic) return undefined;

            return {
                id: (basic.id as string | undefined) ?? trackId,
                title: basic.title as string | undefined,
                duration: { seconds: basic.duration as number | undefined },
                artists: basic.author ? [{ name: basic.author as string }] : [],
                thumbnails: basic.thumbnail as { url: string }[] | undefined,
            };
        } catch (error) {
            // "This video is unavailable" is the id being unknown, which the contract answers with
            // `undefined`. Anything else is a real failure and belongs to the caller.
            if (isUnavailable(error)) return undefined;
            throw error;
        }
    }
}
