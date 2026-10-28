import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';

import { catalogSimilarityOptions } from '../../api/catalog.queries';
import { CATALOG_ALBUM_DEFAULTS } from '../../components/catalog/catalog.page.params';
import { SimilarityGraphPage } from '../../components/catalog/similarity.graph.page';
import { LibraryShell } from '../../components/library/library.shell';
import { PageSkeleton } from '../../components/shared/page.skeleton';

const SIMILARITY_DEFAULTS = { library: false };

/**
 * Who sounds like whom, as a Library tab.
 *
 * The library switch is in the URL, like every other narrowing in the Library, so a link to the
 * library-only map is a link to that map. The loader prefetches rather than awaits, on the
 * `/catalog` route's argument: a slow answer must not swap the tab strip for a skeleton.
 */
export const Route = createFileRoute('/catalog/similarity')({
    component: SimilarityRoute,
    validateSearch: (input: Record<string, unknown>): { library: boolean } => ({ library: input.library === true || input.library === 'true' }),
    search: { middlewares: [stripSearchParams(SIMILARITY_DEFAULTS)] },
    loaderDeps: ({ search }) => ({ library: search.library }),
    loader: async ({ context, deps }) => {
        void context.queryClient.prefetchQuery(catalogSimilarityOptions(deps));
    },
    pendingComponent: () => (
        <LibraryShell active="similarity">
            <PageSkeleton variant="table" />
        </LibraryShell>
    ),
});

function SimilarityRoute() {
    const { library } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });

    return (
        <LibraryShell active="similarity">
            <SimilarityGraphPage
                library={library}
                onLibraryChange={next => {
                    void navigate({ search: { library: next } });
                }}
                onOpenArtist={artistId => {
                    void navigate({ to: '/catalog/artists/$artistId', params: { artistId }, search: CATALOG_ALBUM_DEFAULTS });
                }}
            />
        </LibraryShell>
    );
}
