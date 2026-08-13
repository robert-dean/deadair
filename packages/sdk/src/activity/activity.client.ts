import type { SdkFetch } from '../sdk-options.js';
import { parseJson, buildQueryString } from '../sdk-options.js';
import type { ActivityPage, ActivityQuery } from './types/activity.types.js';

export class ActivityClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Read activity
     * @description The feed, newest first, one page at a time
     */
    async readActivity(query?: ActivityQuery): Promise<ActivityPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/activity${qs}`, {
            method: 'GET',
        });
        return await parseJson<ActivityPage>(result);
    }
}
