import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';

import { catalogTracksOptions } from '../../../api/catalog.queries';
import { CATALOG_TRACK_DEFAULTS, validateCatalogTracks } from '../../../components/catalog/catalog.page.params';
import { CatalogTracksPage } from '../../../components/catalog/catalog.tracks.page';
import { LibraryShell } from '../../../components/library/library.shell';
import { PageSkeleton } from '../../../components/shared/page.skeleton';

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
    // This used to `await ensureQueryData`, which made every committed search keystroke, page
    // change or re-sort an awaited loader run. `main.tsx`'s `defaultPendingComponent` has no
    // `defaultPendingMs` override, so TanStack's 1000ms default applies — any of those crossing a
    // second swapped the WHOLE route, `LibraryShell` included, for four grey bars (measured over
    // 5s on the phone). The page's own `tracks.isPending` skeleton in `catalog.tracks.page.tsx`
    // almost never got the chance to show, because `catalogTracksOptions` keeps the previous
    // page's rows on screen (`placeholderData: keepPreviousData`) while the new query is inflight.
    //
    // Firing the fetch and letting the route render immediately is the same shape `/news` uses for
    // its slower query: `keepPreviousData` covers a re-query of a warm list, and the `pendingComponent`
    // below covers the one case that's actually cold — first arrival at this route.
    //
    // `prefetchQuery` resolves rather than rejects on failure (unlike `ensureQueryData`), so no
    // `.catch` is needed to stop a failed fetch turning into a thrown loader and the router's error
    // boundary — the failure still lands in the query cache for the page's own alert.
    loader: async ({ context, deps }) => {
        void context.queryClient.prefetchQuery(catalogTracksOptions(deps));
    },
    // Keeps the heading, tab strip and search box on screen for the one pending case this route
    // still has: a genuinely cold first load, before anything is cached to render around. Rendered
    // inside `LibraryShell` rather than falling through to `main.tsx`'s bare `defaultPendingComponent`,
    // which is what blanked the whole destination in the first place.
    pendingComponent: () => (
        <LibraryShell active="tracks">
            <PageSkeleton variant="table" />
        </LibraryShell>
    ),
});

function CatalogTracksRoute() {
    const { page, search, state, sortBy, sort, pageSize } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });

    return (
        <LibraryShell active="tracks">
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
