import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';

import { catalogTracksOptions } from '../../api/catalog.queries';
import { CATALOG_SEARCH_DEFAULTS, validateCatalogSearch } from '../../components/catalog/catalog.page.params';
import { CatalogTracksPage } from '../../components/catalog/catalog.tracks.page';

export const Route = createFileRoute('/catalog/tracks')({
    component: CatalogTracksRoute,
    validateSearch: validateCatalogSearch,
    search: { middlewares: [stripSearchParams(CATALOG_SEARCH_DEFAULTS)] },
    loaderDeps: ({ search }) => ({ page: search.page, search: search.search }),
    // See the sibling `/catalog` route: the rejection stays in the cache for the page's own alert.
    loader: async ({ context, deps }) => {
        await context.queryClient.ensureQueryData(catalogTracksOptions(deps)).catch(() => undefined);
    },
});

function CatalogTracksRoute() {
    const { page, search } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });

    return (
        <CatalogTracksPage
            page={page}
            search={search}
            onPageChange={next => {
                void navigate({ search: previous => ({ ...previous, page: next }) });
            }}
            onSearchChange={next => {
                // A narrower search is a shorter list, so the page resets.
                void navigate({ search: { page: 0, search: next } });
            }}
        />
    );
}
