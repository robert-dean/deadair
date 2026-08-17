import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type { Production, ProductionList, ProductionRequest } from './types/productions.types.js';

export class ProductionsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List productions
     * @description Everything the station has made or is making, newest first
     */
    async listProductions(): Promise<ProductionList> {
        const result = await this.fetch(`/productions`, { method: 'GET' });
        return await parseJson<ProductionList>(result);
    }

    /**
     * @name Request production
     * @description Asks the station to make one. It is queued, not started
     */
    async requestProduction(body: ProductionRequest): Promise<Production> {
        const result = await this.fetch(`/productions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<Production>(result);
    }

    /**
     * @name Cancel production
     * @description Stops a production being made, for good
     */
    async cancelProduction(id: string): Promise<Production> {
        const result = await this.fetch(`/productions/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
        return await parseJson<Production>(result);
    }
}
