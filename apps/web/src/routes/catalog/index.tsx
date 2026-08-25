import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';

import { catalogArtistsOptions } from '../../api/catalog.queries';
import { CatalogArtistsPage } from '../../components/catalog/catalog.artists.page';
import { CATALOG_SEARCH_DEFAULTS, validateCatalogSearch } from '../../components/catalog/catalog.page.params';

export const Route = createFileRoute('/catalog/')({
    component: CatalogArtistsRoute,
    validateSearch: validateCatalogSearch,
    // The params stay required in the component and disappear from the URL when they hold their
    // defaults, so the plain `/catalog` link does not immediately rewrite itself to `?page=0&search=`.
    search: { middlewares: [stripSearchParams(CATALOG_SEARCH_DEFAULTS)] },
    loaderDeps: ({ search }) => ({ page: search.page, search: search.search, sortBy: search.sortBy, sort: search.sort, pageSize: search.pageSize }),
    // Warms the same cache the page's hook reads from, so the loader and the render are one
    // request rather than two. The rejection is swallowed on purpose: the failure stays in the
    // query cache for the page's own "catalog could not be loaded" alert, which keeps the search
    // box reachable instead of abandoning the navigation to the router's error component.
    loader: async ({ context, deps }) => {
        await context.queryClient.ensureQueryData(catalogArtistsOptions(deps)).catch(() => undefined);
    },
});

function CatalogArtistsRoute() {
    const { page, search, sortBy, sort, pageSize } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });

    return (
        <CatalogArtistsPage
            page={page}
            search={search}
            order={{ sortBy, sort, pageSize }}
            onPageChange={next => {
                void navigate({ search: previous => ({ ...previous, page: next }) });
            }}
            onSearchChange={next => {
                // A narrower search is a shorter list, so the page resets: staying on page 4 of a
                // result set that now has one page renders an empty table under a full pager.
                void navigate({ search: previous => ({ ...previous, page: 0, search: next }) });
            }}
            onOrderChange={next => {
                // The page resets for the search box's own reason one clause up: a re-ordered list
                // is a different list, and page 4 of it is not the part they were looking at. A new
                // size resets for the harder version of the same thing, since the page numbers
                // themselves mean something else afterwards.
                void navigate({ search: previous => ({ ...previous, page: 0, ...next }) });
            }}
        />
    );
}
