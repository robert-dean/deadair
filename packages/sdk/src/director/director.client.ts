import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type { ClockBand, ClockBandInput, ClockBandList } from './types/clock.types.js';
import type {
    AddStationSegmentInput,
    ExtendStationInput,
    MoveStationItemInput,
    PutOnAirInput,
    ReplanStationInput,
    SetStationAirInput,
    StationAir,
    StationOrder,
} from './types/director.types.js';

export class DirectorClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Get station air
     * @description What the station is airing, and whether it is driving at all
     */
    async getStationAir(): Promise<StationAir> {
        const result = await this.fetch(`/director/air`, { method: 'GET' });
        return await parseJson<StationAir>(result);
    }

    /**
     * @name Put the station on air
     * @description Puts the station on air, building the running order from a playlist read at this moment. What is playing finishes: changing the programming is not a reason to cut a listener off mid-track
     */
    async putTheStationOnAir(body: PutOnAirInput): Promise<StationAir> {
        const result = await this.fetch(`/director/air`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<StationAir>(result);
    }

    /**
     * @name Set the air mode
     * @description Changes what puts the station on air: only while somebody is listening, or whenever there is a programme. Takes effect at once rather than at the next boundary
     */
    async setTheAirMode(body: SetStationAirInput): Promise<StationAir> {
        const result = await this.fetch(`/director/air`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<StationAir>(result);
    }

    /**
     * @name Get the running order
     * @description The live running order, item by item, each saying where it has got to
     */
    async getTheRunningOrder(): Promise<StationOrder> {
        const result = await this.fetch(`/director/air/order`, { method: 'GET' });
        return await parseJson<StationOrder>(result);
    }

    /**
     * @name Extend the running order
     * @description Queues a refill and returns at once. Generating a set walks the catalog, and an operator pressing a button should not be held open through it
     */
    async extendTheRunningOrder(body: ExtendStationInput): Promise<void> {
        await this.fetch(`/director/air/extend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
    }

    /**
     * @name Replan the running order
     * @description Queues a fresh set for everything the player is not already holding, and swaps it in once it exists. The old tail keeps playing until then, because emptying the running order first would take the station off air while the model was still choosing
     */
    async replanTheRunningOrder(body: ReplanStationInput): Promise<void> {
        await this.fetch(`/director/air/replan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
    }

    /**
     * @name Shuffle the running order
     * @description Shuffles the records not yet handed to the player, and plants the breaks again around the new sequence. The head is already in the player's hands and is left alone
     */
    async shuffleTheRunningOrder(): Promise<StationOrder> {
        const result = await this.fetch(`/director/air/shuffle`, { method: 'POST' });
        return await parseJson<StationOrder>(result);
    }

    /**
     * @name Add a segment to the running order
     * @description Puts something the station says into the running order. A segment with no audio yet is refused here rather than accepted and skipped when it comes round, so an operator is told why it cannot play
     */
    async addASegmentToTheRunningOrder(body: AddStationSegmentInput): Promise<StationOrder> {
        const result = await this.fetch(`/director/air/segments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<StationOrder>(result);
    }

    /**
     * @name Move a running order item
     * @description Moves an item. A position already handed to the player is refused rather than clamped
     */
    async moveARunningOrderItem(itemId: string, body: MoveStationItemInput): Promise<StationOrder> {
        const result = await this.fetch(`/director/air/items/${encodeURIComponent(itemId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<StationOrder>(result);
    }

    /**
     * @name Remove a running order item
     * @description Drops an item that has not been handed to the player yet
     */
    async removeARunningOrderItem(itemId: string): Promise<StationOrder> {
        const result = await this.fetch(`/director/air/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
        return await parseJson<StationOrder>(result);
    }

    /**
     * @name List clock bands
     * @description Every band on this station's clock, including the ones switched off, in the operator's own order
     */
    async listClockBands(): Promise<ClockBandList> {
        const result = await this.fetch(`/clock/bands`, { method: 'GET' });
        return await parseJson<ClockBandList>(result);
    }

    /**
     * @name Create clock band
     * @description Adds a band. It claims its first boundary on the next commit pass
     */
    async createClockBand(body: ClockBandInput): Promise<ClockBandList> {
        const result = await this.fetch(`/clock/bands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<ClockBandList>(result);
    }

    /**
     * @name Update clock band
     * @description Rewrites one band. Breaks it has already planted stay where they are: the running order is the memory
     */
    async updateClockBand(id: string, body: ClockBandInput): Promise<ClockBandList> {
        const result = await this.fetch(`/clock/bands/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<ClockBandList>(result);
    }

    /**
     * @name Delete clock band
     * @description Removes a band, which costs it the boundaries it had not claimed yet and nothing else
     */
    async deleteClockBand(id: string): Promise<ClockBandList> {
        const result = await this.fetch(`/clock/bands/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return await parseJson<ClockBandList>(result);
    }
}
