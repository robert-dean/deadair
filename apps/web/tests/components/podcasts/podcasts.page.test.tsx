import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StationEpisode } from '@deadair/sdk';

import { episodeState, PodcastsPage } from '../../../src/components/podcasts/podcasts.page';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';

const listShows = vi.fn();
const listEpisodes = vi.fn();
const fetchEpisode = vi.fn();
const refreshPodcasts = vi.fn();
const searchPodcastDirectory = vi.fn();
const getPlugin = vi.fn();
const updatePluginConfiguration = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        podcasts: {
            listShows: (...args: unknown[]) => listShows(...args),
            listEpisodes: (...args: unknown[]) => listEpisodes(...args),
            fetchEpisode: (...args: unknown[]) => fetchEpisode(...args),
            refreshPodcasts: (...args: unknown[]) => refreshPodcasts(...args),
            searchPodcastDirectory: (...args: unknown[]) => searchPodcastDirectory(...args),
        },
        plugins: {
            getPlugin: (...args: unknown[]) => getPlugin(...args),
            updatePluginConfiguration: (...args: unknown[]) => updatePluginConfiguration(...args),
        },
    },
}));

const SHOW = 'deadair.podcast:73b7fb89';
const FEED = 'https://longwave.example.com/feed.xml';

const episode = (overrides: Partial<StationEpisode> = {}): StationEpisode => ({
    id: 'row-1',
    showId: SHOW,
    episodeId: 'ep12',
    showTitle: 'The Long Wave',
    title: 'Episode 12: The night shift',
    seenAt: '2026-09-15T08:00:00.000Z',
    fetched: false,
    publishedAt: '2026-09-14T06:00:00.000Z',
    durationMs: 3_723_000,
    ...overrides,
});

const carrying = () => listShows.mockResolvedValue({ shows: [{ id: SHOW, pluginId: 'deadair.podcast', title: 'The Long Wave', feedUrl: FEED }] });

afterEach(() => {
    vi.resetAllMocks();
});

describe('PodcastsPage', () => {
    it('lists the episodes the station knows about, with how long each runs in hours', async () => {
        carrying();
        listEpisodes.mockResolvedValue({ episodes: [episode()] });

        render(<PodcastsPage />);

        const card = (await screen.findByText('Episode 12: The night shift')).closest('[class*="Card"]') as HTMLElement;
        expect(within(card).getByText('Not fetched')).toBeInTheDocument();
        expect(within(card).getByText('1:02:03')).toBeInTheDocument();
    });

    it('asks for an episode’s audio when told to, and says the station is on it', async () => {
        carrying();
        listEpisodes.mockResolvedValue({ episodes: [episode()] });
        fetchEpisode.mockResolvedValue(episode({ fetchRequestedAt: new Date().toISOString() }));

        const user = setupUser();
        render(<PodcastsPage />);
        await user.click(await screen.findByRole('button', { name: 'Fetch now' }));

        await waitFor(() => expect(fetchEpisode).toHaveBeenCalledWith('row-1'));
    });

    it('offers no fetch for an episode the station already holds', async () => {
        carrying();
        listEpisodes.mockResolvedValue({ episodes: [episode({ fetched: true })] });

        render(<PodcastsPage />);

        expect(await screen.findByText('Ready to air')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Fetch now' })).not.toBeInTheDocument();
    });

    it('says why a fetch failed, and offers to try again', async () => {
        carrying();
        listEpisodes.mockResolvedValue({
            episodes: [episode({ fetchError: 'the publisher answered 404', fetchRequestedAt: '2026-09-01T00:00:00.000Z' })],
        });

        render(<PodcastsPage />);

        expect(await screen.findByText('The last attempt failed: the publisher answered 404.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it('says the station carries nothing yet rather than drawing an empty list', async () => {
        listShows.mockResolvedValue({ shows: [] });
        listEpisodes.mockResolvedValue({ episodes: [] });

        render(<PodcastsPage />);

        expect(await screen.findByText('The station carries no shows yet')).toBeInTheDocument();
    });

    // The words go to somebody else's directory, so nothing is sent until somebody presses search.
    it('searches the directory only when asked, and marks a show the station already carries', async () => {
        carrying();
        listEpisodes.mockResolvedValue({ episodes: [] });
        searchPodcastDirectory.mockResolvedValue({
            results: [
                { id: '1', pluginId: 'deadair.podcast', title: 'The Long Wave', feedUrl: FEED },
                { id: '2', pluginId: 'deadair.podcast', title: 'Night Radio', feedUrl: 'https://night.example.com/feed.xml' },
            ],
        });

        const user = setupUser();
        render(<PodcastsPage />);
        const input = await screen.findByLabelText('Show, publisher or subject');
        await user.type(input, 'radio');
        expect(searchPodcastDirectory).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Search' }));

        await waitFor(() => expect(searchPodcastDirectory).toHaveBeenCalledWith({ query: 'radio', limit: 20 }));
        const carried = (await screen.findByText(FEED)).closest('[class*="Card"]') as HTMLElement;
        expect(within(carried).getByText('Subscribed')).toBeInTheDocument();
        const fresh = screen.getByText('https://night.example.com/feed.xml').closest('[class*="Card"]') as HTMLElement;
        expect(within(fresh).getByRole('button', { name: 'Subscribe' })).toBeInTheDocument();
    });

    it('subscribes by adding a row to the plugin’s own list of feeds, and reads the feeds again', async () => {
        carrying();
        listEpisodes.mockResolvedValue({ episodes: [] });
        searchPodcastDirectory.mockResolvedValue({
            results: [{ id: '2', pluginId: 'deadair.podcast', title: 'Night Radio', feedUrl: 'https://night.example.com/feed.xml' }],
        });
        getPlugin.mockResolvedValue({
            name: 'Podcasts',
            config: { feeds: JSON.stringify([{ url: FEED }]), directory: true },
            configFields: [
                {
                    key: 'feeds',
                    label: 'Shows',
                    type: 'list',
                    columns: [
                        { key: 'name', label: 'Name', type: 'string' },
                        { key: 'url', label: 'Feed address', type: 'url' },
                    ],
                },
            ],
        });
        updatePluginConfiguration.mockResolvedValue({});
        refreshPodcasts.mockResolvedValue(undefined);

        const user = setupUser();
        render(<PodcastsPage />);
        await user.type(await screen.findByLabelText('Show, publisher or subject'), 'night');
        await user.click(screen.getByRole('button', { name: 'Search' }));
        await user.click(await screen.findByRole('button', { name: 'Subscribe' }));

        await waitFor(() =>
            expect(updatePluginConfiguration).toHaveBeenCalledWith('deadair.podcast', {
                config: { feeds: JSON.stringify([{ url: FEED }, { url: 'https://night.example.com/feed.xml', name: 'Night Radio' }]) },
            }),
        );
        await waitFor(() => expect(refreshPodcasts).toHaveBeenCalled());
    });
});

describe('episodeState', () => {
    const now = Date.parse('2026-09-15T12:00:00.000Z');

    it('reads aired before anything else, since an episode airs once', () => {
        expect(episodeState(episode({ fetched: true, airedAt: '2026-09-14T21:00:00.000Z' }), now).label).toBe('Aired');
    });

    it('reads a recent request as still going, and an old failed one as failed', () => {
        expect(episodeState(episode({ fetchRequestedAt: '2026-09-15T11:55:00.000Z' }), now).label).toBe('Fetching');
        expect(episodeState(episode({ fetchRequestedAt: '2026-09-15T10:00:00.000Z', fetchError: 'gone' }), now).label).toBe('Could not fetch');
    });
});
