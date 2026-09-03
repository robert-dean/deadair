// The page that answers "what does the station think the news is". The two things worth pinning are
// the two claims it keeps apart: a CATEGORY is what the operator called a feed, and a story's own
// categories are what the publisher said. And a story with no date must not be given one.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewsStory, StationFeed } from '@deadair/sdk';

import { NewsPage } from '../../../src/components/news/news.page';
import { render, screen, setupUser, within } from '../../utils/render';

const listFeeds = vi.fn();
const readNews = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        news: {
            listFeeds: (...args: unknown[]) => listFeeds(...args),
            readNews: (...args: unknown[]) => readNews(...args),
        },
    },
}));

const feed = (over: Partial<StationFeed> = {}): StationFeed => ({
    id: 'deadair.rss:world',
    pluginId: 'deadair.rss',
    name: 'World',
    ...over,
});

const story = (over: Partial<NewsStory> = {}): NewsStory => ({
    id: 'story-1',
    feedId: 'deadair.rss:world',
    feedName: 'World',
    title: 'Something happened somewhere',
    ...over,
});

afterEach(() => {
    vi.resetAllMocks();
});

describe('NewsPage', () => {
    it('reads every feed at rest rather than making anybody pick one', async () => {
        listFeeds.mockResolvedValue({ feeds: [feed()] });
        readNews.mockResolvedValue({ stories: [story()] });

        render(<NewsPage />);

        expect(await screen.findByText('Something happened somewhere')).toBeInTheDocument();
        // Headlines only: this page never draws `content`, and asking for it is what made the route
        // take three seconds against the thirty milliseconds every other call on the page takes.
        expect(readNews).toHaveBeenCalledWith({ headlinesOnly: true });
    });

    /**
     * The operator's word for a feed and the publisher's word for a story are different claims, and
     * the bulletin ranks them differently. Drawing them as one badge would lose that.
     */
    it('tells the operator’s category apart from the publisher’s', async () => {
        listFeeds.mockResolvedValue({ feeds: [feed({ category: 'world' })] });
        readNews.mockResolvedValue({ stories: [story({ categories: ['politics'] })] });

        render(<NewsPage />);

        // Scoped to the story, because the operator's category also populates the filter menu and
        // would otherwise match there: what this case is about is the two badges on the ROW.
        const card = (await screen.findByText('Something happened somewhere')).closest('[class*="Card"]');
        expect(card).not.toBeNull();
        expect(within(card as HTMLElement).getByText('world')).toBeInTheDocument();
        expect(within(card as HTMLElement).getByText('politics')).toBeInTheDocument();
    });

    /** Narrowing by feed is a QUERY, because the contract takes one and a dozen feeds is a lot to pull. */
    it('asks the API for one feed rather than filtering what it already has', async () => {
        listFeeds.mockResolvedValue({ feeds: [feed(), feed({ id: 'deadair.rss:sport', name: 'Sport' })] });
        readNews.mockResolvedValue({ stories: [story()] });

        render(<NewsPage />);
        await screen.findByText('Something happened somewhere');

        const user = setupUser();
        await user.click(screen.getByRole('combobox', { name: 'Feed' }));
        await user.click(await screen.findByRole('option', { name: 'Sport' }));

        expect(readNews).toHaveBeenLastCalledWith({ headlinesOnly: true, feedId: 'deadair.rss:sport' });
    });

    /**
     * Narrowing by category is NOT a query. A category is the operator's own label on a feed, so it
     * is a join from stories to feeds on `feedId` and asks the API nothing.
     */
    it('narrows by category without asking the API again', async () => {
        listFeeds.mockResolvedValue({
            feeds: [feed({ category: 'world' }), feed({ id: 'deadair.rss:sport', name: 'Sport', category: 'sport' })],
        });
        readNews.mockResolvedValue({
            stories: [story(), story({ id: 'story-2', feedId: 'deadair.rss:sport', feedName: 'Sport', title: 'A team won' })],
        });

        render(<NewsPage />);
        await screen.findByText('A team won');

        const before = readNews.mock.calls.length;
        const user = setupUser();
        await user.click(screen.getByRole('combobox', { name: 'Category' }));
        await user.click(await screen.findByRole('option', { name: 'sport' }));

        expect(screen.getByText('A team won')).toBeInTheDocument();
        expect(screen.queryByText('Something happened somewhere')).not.toBeInTheDocument();
        expect(readNews.mock.calls).toHaveLength(before);
    });

    /** A category menu with one entry cannot narrow anything, so a station that sorted nothing gets none. */
    it('offers no category control until the operator has sorted a feed', async () => {
        listFeeds.mockResolvedValue({ feeds: [feed()] });
        readNews.mockResolvedValue({ stories: [story()] });

        render(<NewsPage />);
        await screen.findByText('Something happened somewhere');

        expect(screen.queryByRole('combobox', { name: 'Category' })).not.toBeInTheDocument();
    });

    it('says what to do when no plugin reads a feed at all', async () => {
        listFeeds.mockResolvedValue({ feeds: [] });
        readNews.mockResolvedValue({ stories: [] });

        render(<NewsPage />);

        expect(await screen.findByText('No plugin offers a feed')).toBeInTheDocument();
    });

    /** An empty answer from a real feed is a slow newsroom, which is not a fault. */
    it('treats a feed with nothing on it as ordinary', async () => {
        listFeeds.mockResolvedValue({ feeds: [feed()] });
        readNews.mockResolvedValue({ stories: [] });

        render(<NewsPage />);

        expect(await screen.findByText(/ordinary state for a slow newsroom/)).toBeInTheDocument();
    });
});
