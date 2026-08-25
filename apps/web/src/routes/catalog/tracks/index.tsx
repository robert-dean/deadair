import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';

import { catalogTracksOptions } from '../../../api/catalog.queries';
import { CATALOG_TRACK_DEFAULTS, validateCatalogTracks } from '../../../components/catalog/catalog.page.params';
import { CatalogTracksPage } from '../../../components/catalog/catalog.tracks.page';

export const Route = createFileRoute('/catalog/tracks/')({
    component: CatalogTracksRoute,
    validateSearch: validateCatalogTracks,
    search: { middlewares: [stripSearchParams(CATALOG_TRACK_DEFAULTS)] },
    loaderDeps: ({ search }) => ({
        page: search.page,
        search: search.search,
        state: search.state,
        sortBy: search.sortBy,
        sort: search.sort,
        pageSize: search.pageSize,
    }),
    // See the sibling `/catalog` route: the rejection stays in the cache for the page's own alert.
    loader: async ({ context, deps }) => {
        await context.queryClient.ensureQueryData(catalogTracksOptions(deps)).catch(() => undefined);
    },
});

function CatalogTracksRoute() {
    const { page, search, state, sortBy, sort, pageSize } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });

    return (
        <CatalogTracksPage
            page={page}
            search={search}
            state={state}
            order={{ sortBy, sort, pageSize }}
            onPageChange={next => {
                void navigate({ search: previous => ({ ...previous, page: next }) });
            }}
            onSearchChange={next => {
                // A narrower search is a shorter list, so the page resets. The state filter stays:
                // "the unmeasured ones, matching this" is one question asked in two boxes.
                void navigate({ search: previous => ({ ...previous, page: 0, search: next }) });
            }}
            onStateChange={next => {
                void navigate({ search: previous => ({ ...previous, page: 0, state: next }) });
            }}
        />
    );
}
