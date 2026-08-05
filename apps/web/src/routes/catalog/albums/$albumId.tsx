import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';

import { catalogAlbumOptions, catalogAlbumTracksOptions } from '../../../api/catalog.queries';
import { AlbumDetailPage } from '../../../components/catalog/album.detail.page';
import { CATALOG_PAGE_DEFAULTS, validateCatalogPage } from '../../../components/catalog/catalog.page.params';

export const Route = createFileRoute('/catalog/albums/$albumId')({
    component: AlbumDetailRoute,
    validateSearch: validateCatalogPage,
    search: { middlewares: [stripSearchParams(CATALOG_PAGE_DEFAULTS)] },
    loaderDeps: ({ search }) => ({ page: search.page }),
    // See the sibling artist route: the rejections stay in the cache for the page's own alerts.
    loader: async ({ context, params, deps }) => {
        await Promise.all([
            context.queryClient.ensureQueryData(catalogAlbumOptions(params.albumId)).catch(() => undefined),
            context.queryClient.ensureQueryData(catalogAlbumTracksOptions(params.albumId, deps)).catch(() => undefined),
        ]);
    },
});

function AlbumDetailRoute() {
    const { albumId } = Route.useParams();
    const { page } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });

    return (
        <AlbumDetailPage
            albumId={albumId}
            page={page}
            onPageChange={next => {
                void navigate({ search: { page: next } });
            }}
        />
    );
}
