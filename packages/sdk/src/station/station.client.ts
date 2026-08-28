import type { SdkFetch } from '../sdk-options.js';
import { parseJson, buildQueryString } from '../sdk-options.js';
import type { StationAttention, StationCheckup } from './types/station.types.js';
import type { TraceDetail, TracesPage, TracesQuery } from './types/traces.types.js';

export class StationClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Read traces
     * @description Recent decisions, newest first, folded to one row each
     */
    async readTraces(query?: TracesQuery): Promise<TracesPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/traces${qs}`, {
            method: 'GET',
        });
        return await parseJson<TracesPage>(result);
    }

    /**
     * @name Read trace
     * @description One decision: every call it made, and the decisions on either side of it
     */
    async readTrace(id: string): Promise<TraceDetail> {
        const result = await this.fetch(`/traces/${encodeURIComponent(id)}`, { method: 'GET' });
        return await parseJson<TraceDetail>(result);
    }

    /**
     * @name Read station attention
     * @description Everything wrong or waiting, worst first, each with the console page that can act on it
     */
    async readStationAttention(): Promise<StationAttention> {
        const result = await this.fetch(`/station/attention`, { method: 'GET' });
        return await parseJson<StationAttention>(result);
    }

    /**
     * @name Read station checkup
     * @description The loops the station runs and how much of the library it has looked at
     */
    async readStationCheckup(): Promise<StationCheckup> {
        const result = await this.fetch(`/station/checkup`, { method: 'GET' });
        return await parseJson<StationCheckup>(result);
    }
}
