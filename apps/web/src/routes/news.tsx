import { createFileRoute } from '@tanstack/react-router';

import { newsFeedsOptions, newsStoriesOptions } from '../api/news.queries';
import { NewsPage } from '../components/news/news.page';
import { LibraryShell } from '../components/library/library.shell';

export const Route = createFileRoute('/news')({
    component: NewsRoute,
    // Both halves in one pass, since the page needs the feeds to name a story's category and the
    // stories to have anything to categorise. Both rejections are swallowed on purpose: they stay
    // in the query cache for the page's own alert, which keeps the filters reachable.
    loader: async ({ context }) => {
        await Promise.all([
            context.queryClient.ensureQueryData(newsFeedsOptions).catch(() => undefined),
            context.queryClient.ensureQueryData(newsStoriesOptions()).catch(() => undefined),
        ]);
    },
});

function NewsRoute() {
    return (
        <LibraryShell active="news">
            <NewsPage />
        </LibraryShell>
    );
}
