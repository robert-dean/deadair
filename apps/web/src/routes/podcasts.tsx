import { createFileRoute } from '@tanstack/react-router';

import { podcastEpisodesOptions, podcastShowsOptions } from '../api/podcast.queries';
import { LibraryShell } from '../components/library/library.shell';
import { PodcastsPage } from '../components/podcasts/podcasts.page';

export const Route = createFileRoute('/podcasts')({
    component: PodcastsRoute,
    // The News route's shape with the halves the other way round. The episodes are the station's own
    // table and answer at once, so they are waited on; the shows are asked of the plugins, which read
    // every subscribed feed to answer, so they are started here and not awaited, and the page draws
    // its show filter when they land. A failure is swallowed for the News route's reason: the page
    // draws its own alert over its own controls.
    loader: async ({ context }) => {
        void context.queryClient.prefetchQuery(podcastShowsOptions);
        await context.queryClient.ensureQueryData(podcastEpisodesOptions()).catch(() => undefined);
    },
});

function PodcastsRoute() {
    return (
        <LibraryShell active="podcasts">
            <PodcastsPage />
        </LibraryShell>
    );
}
