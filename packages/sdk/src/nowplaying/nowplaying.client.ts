import type { SdkFetch } from '../sdk-options.js';
import { parseJson } from '../sdk-options.js';
import type { NowPlaying } from './types/nowplaying.types.js';

export class NowplayingClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Get now playing
     * @description What is on air right now. Answers 200 with `onAir: false` when the station is quiet, so a device polling this treats silence as an answer rather than an error
     */
    async getNowPlaying(): Promise<NowPlaying> {
        const result = await this.fetch(`/nowplaying`, { method: 'GET' });
        return await parseJson<NowPlaying>(result);
    }
}
