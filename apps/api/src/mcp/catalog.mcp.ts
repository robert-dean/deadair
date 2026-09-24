// Auto-generated MCP tools
// generated from [catalog.ck](../../data/contracts/catalog/catalog.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { parseAndValidate } from '@maroonedsoftware/zod';
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
    CatalogQueryInput,
    ClearEnrichmentQuery,
    RateInput,
    Track,
    TrackClearResult,
    TrackDetail,
    TrackEnrichmentDetail,
    TrackPage,
    TrackQueryInput,
} from '../modules/catalog/types/catalog.types.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ListArtistsArgs = z.object({ query: CatalogQueryInput.optional() });
const GetArtistArgs = z.object({ id: z.uuid() });
const GetArtistEnrichmentArgs = z.object({ id: z.uuid() });
const ListArtistAlbumsArgs = z.object({ id: z.uuid(), query: CatalogQueryInput.optional() });
const RateArtistArgs = z.object({ id: z.uuid(), body: RateInput });
const ListAlbumsArgs = z.object({ query: CatalogQueryInput.optional() });
const GetAlbumArgs = z.object({ id: z.uuid() });
const GetAlbumEnrichmentArgs = z.object({ id: z.uuid() });
const ListAlbumTracksArgs = z.object({ id: z.uuid(), query: TrackQueryInput.optional() });
const RateAlbumArgs = z.object({ id: z.uuid(), body: RateInput });
const GetTrackArgs = z.object({ id: z.uuid() });
const ClearTrackAudioArgs = z.object({ id: z.uuid() });
const ClearTrackAnalysisArgs = z.object({ id: z.uuid() });
const RetryTrackAudioArgs = z.object({ id: z.uuid() });
const OfferTrackCopiesAgainArgs = z.object({ id: z.uuid() });
const GetTrackEnrichmentArgs = z.object({ id: z.uuid() });
const ClearTrackEnrichmentArgs = z.object({ id: z.uuid(), query: ClearEnrichmentQuery.optional() });
const ListTracksArgs = z.object({ query: TrackQueryInput.optional() });
const RateTrackArgs = z.object({ id: z.uuid(), body: RateInput });

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L29)
 */
@Injectable()
export class ListArtistsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_artists',
        description: 'Every artist the station has ingested, ordered by name',
        inputSchema: z.toJSONSchema(ListArtistsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ArtistPage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { query = await parseAndValidate({}, ListArtistsArgs.shape.query.unwrap()) } = await parseAndValidate(args, ListArtistsArgs);
        const result = await container.get(ArtistsService).listArtists(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L45)
 */
@Injectable()
export class GetArtistMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_artist',
        description: 'One artist. 404s on an id that was merged away, since reads never return merged rows',
        inputSchema: z.toJSONSchema(GetArtistArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Artist, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id } = await parseAndValidate(args, GetArtistArgs);
        const result = await container.get(ArtistsService).getArtist(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L60)
 */
@Injectable()
export class GetArtistEnrichmentMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_artist_enrichment',
        description: 'What every enrichment provider said about this artist, and when each of them said it',
        inputSchema: z.toJSONSchema(GetArtistEnrichmentArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(ArtistEnrichmentDetail, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id } = await parseAndValidate(args, GetArtistEnrichmentArgs);
        const result = await container.get(EnrichmentReadService).getArtistEnrichment(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L75)
 */
@Injectable()
export class ListArtistAlbumsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_artist_albums',
        description: 'The albums credited to one artist',
        inputSchema: z.toJSONSchema(ListArtistAlbumsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(AlbumPage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id, query = await parseAndValidate({}, ListArtistAlbumsArgs.shape.query.unwrap()) } = await parseAndValidate(
            args,
            ListArtistAlbumsArgs,
        );
        const result = await container.get(AlbumsService).listAlbumsByArtist(id, query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L91)
 */
@Injectable()
export class RateArtistMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'rate_artist',
        description: 'What the station thinks of this artist. A dislike here excludes every record they are credited on',
        inputSchema: z.toJSONSchema(RateArtistArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Artist, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, RateArtistArgs);
        const result = await container.get(ArtistsService).rateArtist(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L112)
 */
@Injectable()
export class ListAlbumsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_albums',
        inputSchema: z.toJSONSchema(ListAlbumsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(AlbumPage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { query = await parseAndValidate({}, ListAlbumsArgs.shape.query.unwrap()) } = await parseAndValidate(args, ListAlbumsArgs);
        const result = await container.get(AlbumsService).listAlbums(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L128)
 */
@Injectable()
export class GetAlbumMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_album',
        inputSchema: z.toJSONSchema(GetAlbumArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Album, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id } = await parseAndValidate(args, GetAlbumArgs);
        const result = await container.get(AlbumsService).getAlbum(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L143)
 */
@Injectable()
export class GetAlbumEnrichmentMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_album_enrichment',
        description: "The record's own enrichment: the label, pressing and cover belong to the release, not to a track on it",
        inputSchema: z.toJSONSchema(GetAlbumEnrichmentArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(AlbumEnrichmentDetail, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id } = await parseAndValidate(args, GetAlbumEnrichmentArgs);
        const result = await container.get(EnrichmentReadService).getAlbumEnrichment(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L158)
 */
@Injectable()
export class ListAlbumTracksMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_album_tracks',
        description: "One album's tracks",
        inputSchema: z.toJSONSchema(ListAlbumTracksArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TrackPage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id, query = await parseAndValidate({}, ListAlbumTracksArgs.shape.query.unwrap()) } = await parseAndValidate(
            args,
            ListAlbumTracksArgs,
        );
        const result = await container.get(TracksService).listTracksByAlbum(id, query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L174)
 */
@Injectable()
export class RateAlbumMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'rate_album',
        description: 'What the station thinks of this record. A dislike here excludes every track on it',
        inputSchema: z.toJSONSchema(RateAlbumArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Album, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, RateAlbumArgs);
        const result = await container.get(AlbumsService).rateAlbum(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L196)
 */
@Injectable()
export class GetTrackMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_track',
        description: 'One record and everything it has accumulated: its copies, its bytes, its measurement, what it has aired',
        inputSchema: z.toJSONSchema(GetTrackArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TrackDetail, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id } = await parseAndValidate(args, GetTrackArgs);
        const result = await container.get(TracksService).getTrack(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L222)
 */
@Injectable()
export class ClearTrackAudioMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'clear_track_audio',
        description: "Drop the station's own copies of this record. The next play fetches them again",
        inputSchema: z.toJSONSchema(ClearTrackAudioArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TrackClearResult, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, ClearTrackAudioArgs);
        const result = await container.get(TracksService).clearAudio(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L245)
 */
@Injectable()
export class ClearTrackAnalysisMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'clear_track_analysis',
        description: 'Forget the measurement, so the walk takes it again',
        inputSchema: z.toJSONSchema(ClearTrackAnalysisArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TrackClearResult, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, ClearTrackAnalysisArgs);
        const result = await container.get(TracksService).clearAnalysis(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L263)
 */
@Injectable()
export class RetryTrackAudioMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'retry_track_audio',
        description: "Try this record's copies again now, rather than when the backoff says",
        inputSchema: z.toJSONSchema(RetryTrackAudioArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TrackClearResult, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, RetryTrackAudioArgs);
        const result = await container.get(TracksService).retryAudio(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L293)
 */
@Injectable()
export class OfferTrackCopiesAgainMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'offer_track_copies_again',
        description: 'Put copies a provider refused back on offer, and clear their backoff so they are tried now',
        inputSchema: z.toJSONSchema(OfferTrackCopiesAgainArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TrackClearResult, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id } = await parseAndValidate(args, OfferTrackCopiesAgainArgs);
        const result = await container.get(TracksService).offerAudio(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L311)
 */
@Injectable()
export class GetTrackEnrichmentMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_track_enrichment',
        description: 'What the providers said about one recording, including everything no canonical column holds',
        inputSchema: z.toJSONSchema(GetTrackEnrichmentArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TrackEnrichmentDetail, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { id } = await parseAndValidate(args, GetTrackEnrichmentArgs);
        const result = await container.get(EnrichmentReadService).getTrackEnrichment(id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L320)
 */
@Injectable()
export class ClearTrackEnrichmentMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'clear_track_enrichment',
        description: 'Forget what the providers said, so the enrichment pass asks again',
        inputSchema: z.toJSONSchema(ClearTrackEnrichmentArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TrackClearResult, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, query = await parseAndValidate({}, ClearTrackEnrichmentArgs.shape.query.unwrap()) } = await parseAndValidate(
            args,
            ClearTrackEnrichmentArgs,
        );
        const result = await container.get(TracksService).clearEnrichment(id, query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L336)
 */
@Injectable()
export class ListTracksMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_tracks',
        description: 'Every track, flat. The only way to answer "do we have this song?" without knowing its artist',
        inputSchema: z.toJSONSchema(ListTracksArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(TrackPage, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.view' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.view' });
        const { query = await parseAndValidate({}, ListTracksArgs.shape.query.unwrap()) } = await parseAndValidate(args, ListTracksArgs);
        const result = await container.get(TracksService).listTracks(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [catalog.ck](../../data/contracts/catalog/catalog.ck#L352)
 */
@Injectable()
export class RateTrackMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'rate_track',
        description: 'What the station thinks of this song, which is the narrowest thing an opinion can be about',
        inputSchema: z.toJSONSchema(RateTrackArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Track, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: 'platform.manage' } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: 'platform.manage' });
        const { id, body } = await parseAndValidate(args, RateTrackArgs);
        const result = await container.get(TracksService).rateTrack(id, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerCatalogMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('list_artists', container.get(ListArtistsMcpTool));
    map.set('get_artist', container.get(GetArtistMcpTool));
    map.set('get_artist_enrichment', container.get(GetArtistEnrichmentMcpTool));
    map.set('list_artist_albums', container.get(ListArtistAlbumsMcpTool));
    map.set('rate_artist', container.get(RateArtistMcpTool));
    map.set('list_albums', container.get(ListAlbumsMcpTool));
    map.set('get_album', container.get(GetAlbumMcpTool));
    map.set('get_album_enrichment', container.get(GetAlbumEnrichmentMcpTool));
    map.set('list_album_tracks', container.get(ListAlbumTracksMcpTool));
    map.set('rate_album', container.get(RateAlbumMcpTool));
    map.set('get_track', container.get(GetTrackMcpTool));
    map.set('clear_track_audio', container.get(ClearTrackAudioMcpTool));
    map.set('clear_track_analysis', container.get(ClearTrackAnalysisMcpTool));
    map.set('retry_track_audio', container.get(RetryTrackAudioMcpTool));
    map.set('offer_track_copies_again', container.get(OfferTrackCopiesAgainMcpTool));
    map.set('get_track_enrichment', container.get(GetTrackEnrichmentMcpTool));
    map.set('clear_track_enrichment', container.get(ClearTrackEnrichmentMcpTool));
    map.set('list_tracks', container.get(ListTracksMcpTool));
    map.set('rate_track', container.get(RateTrackMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerCatalogMcpToolClasses(registry: Registry): void {
    registry.register(ListArtistsMcpTool).useClass(ListArtistsMcpTool).asSingleton();
    registry.register(GetArtistMcpTool).useClass(GetArtistMcpTool).asSingleton();
    registry.register(GetArtistEnrichmentMcpTool).useClass(GetArtistEnrichmentMcpTool).asSingleton();
    registry.register(ListArtistAlbumsMcpTool).useClass(ListArtistAlbumsMcpTool).asSingleton();
    registry.register(RateArtistMcpTool).useClass(RateArtistMcpTool).asSingleton();
    registry.register(ListAlbumsMcpTool).useClass(ListAlbumsMcpTool).asSingleton();
    registry.register(GetAlbumMcpTool).useClass(GetAlbumMcpTool).asSingleton();
    registry.register(GetAlbumEnrichmentMcpTool).useClass(GetAlbumEnrichmentMcpTool).asSingleton();
    registry.register(ListAlbumTracksMcpTool).useClass(ListAlbumTracksMcpTool).asSingleton();
    registry.register(RateAlbumMcpTool).useClass(RateAlbumMcpTool).asSingleton();
    registry.register(GetTrackMcpTool).useClass(GetTrackMcpTool).asSingleton();
    registry.register(ClearTrackAudioMcpTool).useClass(ClearTrackAudioMcpTool).asSingleton();
    registry.register(ClearTrackAnalysisMcpTool).useClass(ClearTrackAnalysisMcpTool).asSingleton();
    registry.register(RetryTrackAudioMcpTool).useClass(RetryTrackAudioMcpTool).asSingleton();
    registry.register(OfferTrackCopiesAgainMcpTool).useClass(OfferTrackCopiesAgainMcpTool).asSingleton();
    registry.register(GetTrackEnrichmentMcpTool).useClass(GetTrackEnrichmentMcpTool).asSingleton();
    registry.register(ClearTrackEnrichmentMcpTool).useClass(ClearTrackEnrichmentMcpTool).asSingleton();
    registry.register(ListTracksMcpTool).useClass(ListTracksMcpTool).asSingleton();
    registry.register(RateTrackMcpTool).useClass(RateTrackMcpTool).asSingleton();
}
