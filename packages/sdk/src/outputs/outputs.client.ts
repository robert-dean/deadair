import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type { OutputCast, OutputCastList, OutputCastRequest, OutputDeviceList } from './types/outputs.types.js';
import { reviveOutputCast, reviveOutputCastList } from './types/outputs.types.js';

export class OutputsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List output devices
     * @description Every speaker the station can play on, from every `output` plugin, with the mounts each can take
     */
    async listOutputDevices(): Promise<OutputDeviceList> {
        const result = await this.fetch(`/outputs/devices`, { method: 'GET' });
        return await parseJson<OutputDeviceList>(result);
    }

    /**
     * @name List casts
     * @description Every speaker the station is meant to be playing on, each asked how it is doing now
     */
    async listCasts(): Promise<OutputCastList> {
        const result = await this.fetch(`/outputs/casts`, { method: 'GET' });
        return reviveOutputCastList(await parseJson<OutputCastList>(result));
    }

    /**
     * @name Start cast
     * @description Play the station on a speaker, replacing whatever it was playing. The station keeps it playing, through a dropped stream or a restart, until it is stopped here or somebody plays something else on it
     */
    async startCast(body: OutputCastRequest): Promise<OutputCast> {
        const result = await this.fetch(`/outputs/casts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveOutputCast(await parseJson<OutputCast>(result));
    }

    /**
     * @name Stop cast
     * @description Stop the station on a speaker. Answers 204 when it was not playing too
     */
    async stopCast(pluginId: string, deviceId: string): Promise<void> {
        await this.fetch(`/outputs/casts/${encodeURIComponent(pluginId)}/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
    }
}
