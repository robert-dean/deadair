import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConfigFieldDescriptor, StationDirectoryEntry } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long the list of shows stays fresh.
 *
 * Long, for `news.queries.ts`' reason: which shows the station carries changes when an operator edits
 * a subscription, not on its own, and asking reads every subscribed feed.
 */
const SHOWS_STALE_TIME = 5 * 60_000;

/**
 * How long a page of episodes stays fresh.
 *
 * Short, because it is the station's own table and answering costs nothing, and because what an
 * operator watches here moves while they watch: a fetch they asked for landing, an episode airing.
 */
const EPISODES_STALE_TIME = 15_000;

/** How many directory results a search asks for. A page an operator reads, not a catalogue. */
const DIRECTORY_RESULTS = 20;

export const podcastShowsOptions = queryOptions({
    queryKey: queryKeys.podcasts.shows(),
    queryFn: () => sdk.podcasts.listShows(),
    staleTime: SHOWS_STALE_TIME,
});

/** Every show the installed podcast plugins carry. */
export function usePodcastShows() {
    return useQuery(podcastShowsOptions);
}

export function podcastEpisodesOptions(showId?: string) {
    return queryOptions({
        queryKey: queryKeys.podcasts.episodes(showId),
        queryFn: () => sdk.podcasts.listEpisodes(showId === undefined ? {} : { showId }),
        staleTime: EPISODES_STALE_TIME,
    });
}

/** The episodes the station knows about, newest first. Absent `showId` is every show's. */
export function usePodcastEpisodes(showId?: string) {
    return useQuery(podcastEpisodesOptions(showId));
}

/**
 * Ask for the feeds to be read again now. The station does it in the background, so what this
 * resolves to is the request being taken rather than the episodes having arrived.
 */
export function useRefreshPodcasts() {
    return useMutation({ mutationFn: () => sdk.podcasts.refreshPodcasts() });
}

/**
 * Ask for one episode's audio now. Every cached page of episodes is read again once the request is
 * taken, so the button becomes "Fetching" without waiting for the page to go stale.
 */
export function useFetchEpisode() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => sdk.podcasts.fetchEpisode(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['podcasts', 'episodes'] });
        },
    });
}

/**
 * Look a show up in the directories the podcast plugins can search.
 *
 * Only asked once somebody has typed something and pressed search, so the words go to a directory
 * because an operator sent them there and never as they type.
 */
export function usePodcastDirectory(query: string) {
    const words = query.trim();
    return useQuery({
        queryKey: queryKeys.podcasts.directory(words),
        queryFn: () => sdk.podcasts.searchPodcastDirectory({ query: words, limit: DIRECTORY_RESULTS }),
        enabled: words.length > 0,
        staleTime: 5 * 60_000,
    });
}

/** The row a subscription adds, and the settings field it goes in. */
export interface Subscription {
    fieldKey: string;
    /** The field's whole new value, as the JSON array a `list` field is stored as. */
    value: string;
}

/**
 * A plugin's subscription list with one show added, or `undefined` when this plugin keeps none the
 * console can find.
 *
 * What a subscription IS belongs to each plugin, which is why the station has no subscribe route: the
 * console writes it into the plugin's own settings through the route any settings form uses, so the
 * plugin's own schema judges it and the plugin reinitializes with it. The list is found the way the
 * host finds a plugin's feed addresses for its allowlist: a `list` field with a column declared `url`.
 * The show's title goes in the first `string` column, where there is one, since that is where a person
 * would have typed a name.
 *
 * A feed already on the list is not added twice.
 */
export function withSubscription(
    fields: readonly ConfigFieldDescriptor[],
    config: Record<string, unknown>,
    show: Pick<StationDirectoryEntry, 'title' | 'feedUrl'>,
): Subscription | undefined {
    const field = fields.find(candidate => candidate.type === 'list' && (candidate.columns ?? []).some(column => column.type === 'url'));
    if (field === undefined) return undefined;

    const urlColumn = field.columns!.find(column => column.type === 'url')!.key;
    const nameColumn = field.columns!.find(column => column.type === 'string')?.key;

    const rows = readRows(config[field.key]);
    if (rows.some(row => row[urlColumn] === show.feedUrl)) return { fieldKey: field.key, value: JSON.stringify(rows) };

    const added: Record<string, string> = { [urlColumn]: show.feedUrl, ...(nameColumn === undefined ? {} : { [nameColumn]: show.title }) };
    return { fieldKey: field.key, value: JSON.stringify([...rows, added]) };
}

/** A stored `list` value as rows, tolerant of anything that is not one, which reads as no rows. */
function readRows(value: unknown): Record<string, unknown>[] {
    if (typeof value !== 'string' || value.trim().length === 0) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row))
            : [];
    } catch {
        return [];
    }
}

/**
 * Subscribe the station to a show a directory found, in the plugin whose directory found it.
 *
 * Reads the plugin's settings fresh rather than from the cache, because what is written back is the
 * whole list and a stale copy would drop a row somebody added since. The save is partial, so every
 * other setting stays as it is. A refresh is asked for afterwards so the show's episodes arrive now
 * rather than at the next half hour.
 */
export function useSubscribePodcast() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (entry: StationDirectoryEntry) => {
            const detail = await sdk.plugins.getPlugin(entry.pluginId);
            const subscription = withSubscription(detail.configFields, detail.config, entry);
            if (subscription === undefined) throw new Error(`${detail.name} keeps no list of feeds the console can add to.`);

            await sdk.plugins.updatePluginConfiguration(entry.pluginId, { config: { [subscription.fieldKey]: subscription.value } });
            await sdk.podcasts.refreshPodcasts();
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.podcasts.shows() });
            void queryClient.invalidateQueries({ queryKey: ['plugins'] });
        },
    });
}
