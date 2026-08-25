import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';

import { catalogAlbumOptions, catalogAlbumTracksOptions } from '../../../api/catalog.queries';
import { AlbumDetailPage } from '../../../components/catalog/album.detail.page';
import { CATALOG_ALBUM_TRACK_DEFAULTS, validateCatalogAlbumTracks } from '../../../components/catalog/catalog.page.params';

export const Route = createFileRoute('/catalog/albums/$albumId')({
    component: AlbumDetailRoute,
    validateSearch: validateCatalogAlbumTracks,
    search: { middlewares: [stripSearchParams(CATALOG_ALBUM_TRACK_DEFAULTS)] },
    loaderDeps: ({ search }) => ({ page: search.page, sortBy: search.sortBy, sort: search.sort, pageSize: search.pageSize }),
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
    const { page, sortBy, sort, pageSize } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });

    return (
        <AlbumDetailPage
            albumId={albumId}
            page={page}
            order={{ sortBy, sort, pageSize }}
            onPageChange={next => {
                void navigate({ search: previous => ({ ...previous, page: next }) });
            }}
        />
    );
}
