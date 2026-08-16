import type { SdkFetch } from '../sdk-options.js';
import { parseJson } from '../sdk-options.js';
import type { StorageReport } from './types/storage.types.js';

export class StorageClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Read storage
     * @description What is on disk, per store, against what the database says should be
     */
    async readStorage(): Promise<StorageReport> {
        const result = await this.fetch(`/storage`, { method: 'GET' });
        return await parseJson<StorageReport>(result);
    }
}
