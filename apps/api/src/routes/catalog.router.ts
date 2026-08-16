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
    RateInput,
    Track,
    TrackDetail,
    TrackEnrichmentDetail,
    TrackPage,
    TrackQuery,
    TrackQueryInput,
} from '../modules/catalog/types/catalog.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck)
 */
export const CatalogRouter = ServerKitRouter();

/**
 * Every artist the station has ingested, ordered by name
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L29)
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
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L45)
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
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L60)
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
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L75)
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
 * What the station thinks of this artist. A dislike here excludes every record they are credited on
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L91)
 */
CatalogRouter.put('/catalog/artists/:id/rating', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, RateInput);

    const service = ctx.container.get(ArtistsService);
    const result: Artist = await service.rateArtist(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L112)
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
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L128)
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
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L143)
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
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L158)
 */
CatalogRouter.get('/catalog/albums/:id/tracks', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const query = await parseAndValidate(ctx.query, TrackQueryInput.strict());

    const service = ctx.container.get(TracksService);
    const result: TrackPage = await service.listTracksByAlbum(id, query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * What the station thinks of this record. A dislike here excludes every track on it
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L174)
 */
CatalogRouter.put('/catalog/albums/:id/rating', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, RateInput);

    const service = ctx.container.get(AlbumsService);
    const result: Album = await service.rateAlbum(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * One record and everything it has accumulated: its copies, its bytes, its measurement, what it has aired
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L196)
 */
CatalogRouter.get('/catalog/tracks/:id', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(TracksService);
    const result: TrackDetail = await service.getTrack(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * What the providers said about one recording, including everything no canonical column holds
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L211)
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
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L223)
 */
CatalogRouter.get('/catalog/tracks', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, TrackQueryInput.strict());

    const service = ctx.container.get(TracksService);
    const result: TrackPage = await service.listTracks(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * What the station thinks of this song, which is the narrowest thing an opinion can be about
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L239)
 */
CatalogRouter.put('/catalog/tracks/:id/rating', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, RateInput);

    const service = ctx.container.get(TracksService);
    const result: Track = await service.rateTrack(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
