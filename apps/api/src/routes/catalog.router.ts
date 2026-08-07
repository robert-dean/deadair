import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { AlbumsService } from '#src/modules/catalog/albums.service.js';
import { ArtistsService } from '#src/modules/catalog/artists.service.js';
import { EnrichmentReadService } from '#src/modules/enrichment/enrichment.read.service.js';
import { TracksService } from '#src/modules/catalog/tracks.service.js';
import {
    Album,
    AlbumEnrichmentDetail,
    AlbumPage,
    Artist,
    ArtistEnrichmentDetail,
    ArtistPage,
    CatalogQuery,
    CatalogQueryInput,
    TrackEnrichmentDetail,
    TrackPage,
} from '../modules/catalog/types/catalog.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck)
 */
export const CatalogRouter = ServerKitRouter();

/**
 * Every artist the station has ingested, ordered by name
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L27)
 */
CatalogRouter.get('/catalog/artists', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, CatalogQueryInput.strict());

    const service = ctx.container.get(ArtistsService);
    const result: ArtistPage = await service.listArtists(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * One artist. 404s on an id that was merged away, since reads never return merged rows
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L43)
 */
CatalogRouter.get('/catalog/artists/:id', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(ArtistsService);
    const result: Artist = await service.getArtist(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * What every enrichment provider said about this artist, and when each of them said it
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L58)
 */
CatalogRouter.get('/catalog/artists/:id/enrichment', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(EnrichmentReadService);
    const result: ArtistEnrichmentDetail = await service.getArtistEnrichment(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The albums credited to one artist
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L73)
 */
CatalogRouter.get('/catalog/artists/:id/albums', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const query = await parseAndValidate(ctx.query, CatalogQueryInput.strict());

    const service = ctx.container.get(AlbumsService);
    const result: AlbumPage = await service.listAlbumsByArtist(id, query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L86)
 */
CatalogRouter.get('/catalog/albums', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, CatalogQueryInput.strict());

    const service = ctx.container.get(AlbumsService);
    const result: AlbumPage = await service.listAlbums(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L102)
 */
CatalogRouter.get('/catalog/albums/:id', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(AlbumsService);
    const result: Album = await service.getAlbum(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The record's own enrichment: the label, pressing and cover belong to the release, not to a track on it
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L117)
 */
CatalogRouter.get('/catalog/albums/:id/enrichment', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(EnrichmentReadService);
    const result: AlbumEnrichmentDetail = await service.getAlbumEnrichment(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * One album's tracks
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L132)
 */
CatalogRouter.get('/catalog/albums/:id/tracks', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const query = await parseAndValidate(ctx.query, CatalogQueryInput.strict());

    const service = ctx.container.get(TracksService);
    const result: TrackPage = await service.listTracksByAlbum(id, query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * What the providers said about one recording, including everything no canonical column holds
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L148)
 */
CatalogRouter.get('/catalog/tracks/:id/enrichment', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(EnrichmentReadService);
    const result: TrackEnrichmentDetail = await service.getTrackEnrichment(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Every track, flat. The only way to answer "do we have this song?" without knowing its artist
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L160)
 */
CatalogRouter.get('/catalog/tracks', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, CatalogQueryInput.strict());

    const service = ctx.container.get(TracksService);
    const result: TrackPage = await service.listTracks(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
