import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';

import { catalogArtistsOptions } from '../../api/catalog.queries';
import { CatalogArtistsPage } from '../../components/catalog/catalog.artists.page';
import { CATALOG_SEARCH_DEFAULTS, validateCatalogSearch } from '../../components/catalog/catalog.page.params';
import { LibraryShell } from '../../components/library/library.shell';
import { PageSkeleton } from '../../components/shared/page.skeleton';

export const Route = createFileRoute('/catalog/')({
    component: CatalogArtistsRoute,
    validateSearch: validateCatalogSearch,
    // The params stay required in the component and disappear from the URL when they hold their
    // defaults, so the plain `/catalog` link does not immediately rewrite itself to `?page=0&search=`.
    search: { middlewares: [stripSearchParams(CATALOG_SEARCH_DEFAULTS)] },
    loaderDeps: ({ search }) => ({ page: search.page, search: search.search, sortBy: search.sortBy, sort: search.sort, pageSize: search.pageSize }),
    // See the sibling `/catalog/tracks` route for the full argument. Short version: this used to
    // `await ensureQueryData`, so every committed search keystroke, page change or re-sort was an
    // awaited loader run, and any one of those crossing TanStack's 1000ms `defaultPendingMs`
    // (`main.tsx` sets no override) swapped the whole route — heading, tab strip, search box — for
    // `defaultPendingComponent`'s four grey bars. `catalogArtistsOptions` already keeps the previous
    // page on screen while a new query is inflight (`placeholderData: keepPreviousData`), so there
    // was never a need to block the route on it. `prefetchQuery` starts the same fetch without
    // making the navigation wait, and resolves rather than rejects on failure, so no `.catch` is
    // needed to keep a failed fetch out of the router's error boundary — the failure still lands in
    // the query cache for the page's own "catalog could not be loaded" alert.
    loader: async ({ context, deps }) => {
        void context.queryClient.prefetchQuery(catalogArtistsOptions(deps));
    },
    // Keeps the heading, tab strip and search box on screen for the one pending case this route
    // still has: a genuinely cold first load, before there is anything cached to render around.
    pendingComponent: () => (
        <LibraryShell active="artists">
            <PageSkeleton variant="table" />
        </LibraryShell>
    ),
});

function CatalogArtistsRoute() {
    const { page, search, sortBy, sort, pageSize } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });

    return (
        <LibraryShell active="artists">
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
        </LibraryShell>
    );
}
