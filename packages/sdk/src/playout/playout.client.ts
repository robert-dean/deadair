import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type { PlayoutPlaylistInput, PlayoutStatus } from './types/playout.types.js';

export class PlayoutClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Get playout status
     * @description What the station is playing and what is queued behind it. The console polls this
     */
    async getPlayoutStatus(): Promise<PlayoutStatus> {
        const result = await this.fetch(`/playout/status`, { method: 'GET' });
        return await parseJson<PlayoutStatus>(result);
    }

    /**
     * @name Play a playlist
     * @description Loads a plugin playlist into the running order and starts handing it to the player. Replaces whatever was queued; what is on air finishes rather than being cut off
     */
    async playAPlaylist(body: PlayoutPlaylistInput): Promise<PlayoutStatus> {
        const result = await this.fetch(`/playout/playlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PlayoutStatus>(result);
    }

    /**
     * @name Skip the current item
     * @description Ends the item on air so the next one starts immediately. The station owns the decoder, so this lands at once rather than waiting out audio already committed to a player
     */
    async skipTheCurrentItem(): Promise<PlayoutStatus> {
        const result = await this.fetch(`/playout/skip`, { method: 'POST' });
        return await parseJson<PlayoutStatus>(result);
    }

    /**
     * @name Stop playout
     * @description Stands the station down: drops the running order, stops what is on air, and hands the mount back. deadair holds the mount on a lease it renews while it has something to play, so stopping goes quiet rather than falling through to a bed nobody programmed
     */
    async stopPlayout(): Promise<PlayoutStatus> {
        const result = await this.fetch(`/playout/stop`, { method: 'POST' });
        return await parseJson<PlayoutStatus>(result);
    }
}
