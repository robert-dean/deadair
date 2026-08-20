import type { SdkFetch } from '../sdk-options.js';
import { parseJson } from '../sdk-options.js';
import type { StationAttention } from './types/station.types.js';

export class StationClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Read station attention
     * @description Everything wrong or waiting, worst first, each with the console page that can act on it
     */
    async readStationAttention(): Promise<StationAttention> {
        const result = await this.fetch(`/station/attention`, { method: 'GET' });
        return await parseJson<StationAttention>(result);
    }
}
