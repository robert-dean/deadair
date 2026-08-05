import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';

import { catalogArtistAlbumsOptions, catalogArtistOptions } from '../../../api/catalog.queries';
import { ArtistDetailPage } from '../../../components/catalog/artist.detail.page';
import { CATALOG_PAGE_DEFAULTS, validateCatalogPage } from '../../../components/catalog/catalog.page.params';

export const Route = createFileRoute('/catalog/artists/$artistId')({
    component: ArtistDetailRoute,
    validateSearch: validateCatalogPage,
    search: { middlewares: [stripSearchParams(CATALOG_PAGE_DEFAULTS)] },
    loaderDeps: ({ search }) => ({ page: search.page }),
    // Warms the same cache the page's hooks read from. Both rejections are swallowed on purpose:
    // they stay in the query cache for the page's own alerts, so a deep link to an artist that was
    // merged away costs an alert rather than the whole screen.
    loader: async ({ context, params, deps }) => {
        await Promise.all([
            context.queryClient.ensureQueryData(catalogArtistOptions(params.artistId)).catch(() => undefined),
            context.queryClient.ensureQueryData(catalogArtistAlbumsOptions(params.artistId, deps)).catch(() => undefined),
        ]);
    },
});

function ArtistDetailRoute() {
    const { artistId } = Route.useParams();
    const { page } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });

    return (
        <ArtistDetailPage
            artistId={artistId}
            page={page}
            onPageChange={next => {
                void navigate({ search: { page: next } });
            }}
        />
    );
}
