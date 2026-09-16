import type { SdkFetch } from '../sdk-options.js';
import { parseJson, buildQueryString } from '../sdk-options.js';
import type { StationPiece, StationPiecePage, StationPieceQuery, StationSeriesList } from './types/narrations.types.js';

export class NarrationsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List series
     * @description Every series every installed narration plugin offers
     */
    async listSeries(): Promise<StationSeriesList> {
        const result = await this.fetch(`/narrations/series`, { method: 'GET' });
        return await parseJson<StationSeriesList>(result);
    }

    /**
     * @name List pieces
     * @description The pieces the station knows about, in their series' own order, with what it has done with each
     */
    async listPieces(query?: StationPieceQuery): Promise<StationPiecePage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/narrations/pieces${qs}`, {
            method: 'GET',
        });
        return await parseJson<StationPiecePage>(result);
    }

    /**
     * @name Render piece
     * @description Has one piece spoken now, rather than waiting for its slot to come near
     */
    async renderPiece(id: string): Promise<StationPiece> {
        const result = await this.fetch(`/narrations/pieces/${encodeURIComponent(id)}/render`, { method: 'POST' });
        return await parseJson<StationPiece>(result);
    }

    /**
     * @name Refresh narrations
     * @description Reads every series again, in the background, rather than waiting for the next scheduled refresh
     */
    async refreshNarrations(): Promise<void> {
        await this.fetch(`/narrations/refresh`, { method: 'POST' });
    }
}
