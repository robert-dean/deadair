import type { SdkFetch } from '../sdk-options.js';
import { parseJson } from '../sdk-options.js';
import type { NowPlaying, NowPlayingLyrics } from './types/nowplaying.types.js';

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

    /**
     * @name Get now playing lyrics
     * @description The words of the record on air, with what a player needs to follow along line by line
     */
    async getNowPlayingLyrics(): Promise<NowPlayingLyrics> {
        const result = await this.fetch(`/nowplaying/lyrics`, { method: 'GET' });
        return await parseJson<NowPlayingLyrics>(result);
    }
}
