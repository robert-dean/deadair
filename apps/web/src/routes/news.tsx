import { createFileRoute } from '@tanstack/react-router';

import { newsFeedsOptions, newsStoriesOptions } from '../api/news.queries';
import { NewsPage } from '../components/news/news.page';
import { LibraryShell } from '../components/library/library.shell';

export const Route = createFileRoute('/news')({
    component: NewsRoute,
    // Only the feeds are waited on, and they are the cheap half by two orders of magnitude:
    // measured on the live station, `/news/feeds` answers in ~27ms where `/news` took 3.2s, because
    // a story is read from the publisher's own page one page at a time. Awaiting both held the
    // whole route on the slower one and bought nothing — a blank screen for the router's pending
    // delay, then the same skeleton the page draws for itself, then everything at once.
    //
    // The stories are STARTED here and deliberately not awaited, so the request is already in
    // flight when the component mounts and `useNews` adopts that promise rather than opening a
    // second one. `NewsPage` draws a skeleton while they are pending and gates its empty state on
    // having data, so arriving without them shows waiting rather than "no stories".
    //
    // `prefetchQuery` resolves on failure, which is why it needs no `catch` where the feeds do. The
    // feeds' rejection is still swallowed for the reason it always was: a loader that throws is
    // replaced wholesale by the router's error boundary, where what is wanted is the page drawing
    // its own alert over its own controls.
    loader: async ({ context }) => {
        void context.queryClient.prefetchQuery(newsStoriesOptions());
        await context.queryClient.ensureQueryData(newsFeedsOptions).catch(() => undefined);
    },
});

function NewsRoute() {
    return (
        <LibraryShell active="news">
            <NewsPage />
        </LibraryShell>
    );
}
