import type { DeadairSdk } from '@deadair/sdk';

import { createStationSdk } from './station.client.js';
import { stationFrom, type Station, type StationSettings } from './station.settings.js';
import type { StatusPoller } from './status.poller.js';

/**
 * The station the plugin is talking to right now, and the one place that changes it.
 *
 * The settings arrive from the Stream Deck app when the plugin starts and again whenever the
 * property inspector writes them, and each time the SDK is rebuilt and the poller pointed at it, so
 * a key never reads one station while pressing another.
 */
export class StationLink {
    private current?: { station: Station; sdk: DeadairSdk };

    constructor(
        private readonly poller: StatusPoller,
        private readonly userAgent: string,
    ) {}

    get station(): Station | undefined {
        return this.current?.station;
    }

    get sdk(): DeadairSdk | undefined {
        return this.current?.sdk;
    }

    /** Take new settings. Settings that describe the station already in use change nothing. */
    apply(settings: StationSettings): void {
        const station = stationFrom(settings);
        const same = station && this.current && station.apiBase === this.current.station.apiBase && station.apiKey === this.current.station.apiKey;
        if (same) return;
        this.current = station ? { station, sdk: createStationSdk(station, this.userAgent) } : undefined;
        this.poller.reconfigure(this.current?.sdk.playout);
    }

    /** Ask again now, as though the station had just been set: after the computer wakes, the last reading is from before it slept. */
    refresh(): void {
        this.poller.reconfigure(this.current?.sdk.playout);
    }
}
