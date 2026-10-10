import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { AlbumsService } from '#src/modules/catalog/albums.service.js';
import { ArtistsService } from '#src/modules/catalog/artists.service.js';
import { EnrichmentReadService } from '#src/modules/enrichment/enrichment.read.service.js';
import { TracksService } from '#src/modules/catalog/tracks.service.js';
import { VocalMarkersService } from '#src/modules/lyrics/vocal.markers.service.js';
import {
    Album,
    AlbumEnrichmentDetail,
    AlbumPage,
    Artist,
    ArtistEnrichmentDetail,
    ArtistPage,
    CatalogQueryInput,
    ClearEnrichmentQuery,
    RateInput,
    Track,
    TrackClearResult,
    TrackDetail,
    TrackEnrichmentDetail,
    TrackPage,
    TrackQueryInput,
    VocalMarkersDetail,
    VocalMarkersInput,
} from '../modules/catalog/types/catalog.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [catalog.ck](../../data/contracts/catalog/catalog.ck)
 */
export const CatalogRouter = ServerKitRouter();

/**
 * Every artist the station has ingested, ordered by name
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `GET /catalog/artists`
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
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `GET /catalog/artists/{id}`
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
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `GET /catalog/artists/{id}/enrichment`
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
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `GET /catalog/artists/{id}/albums`
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
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `PUT /catalog/artists/{id}/rating`
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
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `GET /catalog/albums`
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
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `GET /catalog/albums/{id}`
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
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `GET /catalog/albums/{id}/enrichment`
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
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `GET /catalog/albums/{id}/tracks`
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
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `PUT /catalog/albums/{id}/rating`
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
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `GET /catalog/tracks/{id}`
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
 * Drop the station's own copies of this record. The next play fetches them again
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `DELETE /catalog/tracks/{id}/audio`
 */
CatalogRouter.delete('/catalog/tracks/:id/audio', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(TracksService);
    const result: TrackClearResult = await service.clearAudio(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Forget the measurement, so the walk takes it again
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `DELETE /catalog/tracks/{id}/analysis`
 */
CatalogRouter.delete('/catalog/tracks/:id/analysis', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(TracksService);
    const result: TrackClearResult = await service.clearAnalysis(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Where the singing starts and stops on one record, from an operator's correction or its timed lyrics
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `GET /catalog/tracks/{id}/vocal-markers`
 */
CatalogRouter.get('/catalog/tracks/:id/vocal-markers', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(VocalMarkersService);
    const result: VocalMarkersDetail = await service.getVocalMarkers(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Correct where the singing starts and stops, over whatever the lyrics say
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `PUT /catalog/tracks/{id}/vocal-markers`
 */
CatalogRouter.put('/catalog/tracks/:id/vocal-markers', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, VocalMarkersInput);

    const service = ctx.container.get(VocalMarkersService);
    const result: VocalMarkersDetail = await service.setVocalMarkers(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Drop the correction, so the record's timed lyrics decide again
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `DELETE /catalog/tracks/{id}/vocal-markers`
 */
CatalogRouter.delete('/catalog/tracks/:id/vocal-markers', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(VocalMarkersService);
    const result: VocalMarkersDetail = await service.clearVocalMarkers(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Try this record's copies again now, rather than when the backoff says
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `POST /catalog/tracks/{id}/retry`
 */
CatalogRouter.post('/catalog/tracks/:id/retry', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(TracksService);
    const result: TrackClearResult = await service.retryAudio(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Put copies a provider refused back on offer, and clear their backoff so they are tried now
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `POST /catalog/tracks/{id}/offer`
 */
CatalogRouter.post('/catalog/tracks/:id/offer', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(TracksService);
    const result: TrackClearResult = await service.offerAudio(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * What the providers said about one recording, including everything no canonical column holds
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `GET /catalog/tracks/{id}/enrichment`
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
 * Forget what the providers said, so the enrichment pass asks again
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `DELETE /catalog/tracks/{id}/enrichment`
 */
CatalogRouter.delete('/catalog/tracks/:id/enrichment', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const query = await parseAndValidate(ctx.query, ClearEnrichmentQuery.strict());

    const service = ctx.container.get(TracksService);
    const result: TrackClearResult = await service.clearEnrichment(id, query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Every track, flat. The only way to answer "do we have this song?" without knowing its artist
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `GET /catalog/tracks`
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
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck) `PUT /catalog/tracks/{id}/rating`
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
