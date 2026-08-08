import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, buildQueryString } from '../sdk-options.js';
import type {
    AddLineupSegmentInput,
    EditLineupInput,
    ExtendLineupInput,
    ImportLineupInput,
    Lineup,
    LineupList,
    MoveLineupItemInput,
    PutOnAirInput,
    SetStationAirInput,
    StationAir,
} from './types/director.types.js';

export class DirectorClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List lineups
     * @description Every lineup the station holds, without their orders
     */
    async listLineups(): Promise<LineupList> {
        const result = await this.fetch(`/director/lineups`, { method: 'GET' });
        return await parseJson<LineupList>(result);
    }

    /**
     * @name Import a lineup
     * @description Builds a lineup from a plugin playlist. Does not put it on air: importing and airing are separate decisions
     */
    async importALineup(body: ImportLineupInput): Promise<Lineup> {
        const result = await this.fetch(`/director/lineups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<Lineup>(result);
    }

    /**
     * @name Get station air
     * @description What the station is airing, and whether it is driving at all
     */
    async getStationAir(): Promise<StationAir> {
        const result = await this.fetch(`/director/air`, { method: 'GET' });
        return await parseJson<StationAir>(result);
    }

    /**
     * @name Put a lineup on air
     * @description Puts a lineup on air from the top. What is playing finishes: changing the programming is not a reason to cut a listener off mid-track
     */
    async putALineupOnAir(body: PutOnAirInput): Promise<StationAir> {
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
     * @name Get a lineup
     * @description One lineup and its whole order, with the cursor marking what has already been handed to the player
     */
    async getALineup(lineupId: string): Promise<Lineup> {
        const result = await this.fetch(`/director/lineups/${encodeURIComponent(lineupId)}`, { method: 'GET' });
        return await parseJson<Lineup>(result);
    }

    /**
     * @name Delete a lineup
     * @description Deletes a lineup. Answers 409 while it is on air: stop the station or put another one on first
     */
    async deleteALineup(lineupId: string): Promise<void> {
        await this.fetch(`/director/lineups/${encodeURIComponent(lineupId)}`, { method: 'DELETE' });
    }

    /**
     * @name Extend a lineup
     * @description Queues a refill and returns at once. Generating a set walks the catalog, and an operator pressing a button should not be held open through it
     */
    async extendALineup(lineupId: string, body: ExtendLineupInput): Promise<void> {
        await this.fetch(`/director/lineups/${encodeURIComponent(lineupId)}/extend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
    }

    /**
     * @name Shuffle a lineup
     * @description Shuffles everything not yet committed. The head is already in the player's hands and is left alone
     */
    async shuffleALineup(lineupId: string, body: EditLineupInput): Promise<Lineup> {
        const result = await this.fetch(`/director/lineups/${encodeURIComponent(lineupId)}/shuffle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<Lineup>(result);
    }

    /**
     * @name Add a segment to a lineup
     * @description Puts something the station says into the order at a position. A segment with no audio yet is refused here rather than accepted and skipped at the boundary, so an operator is told why it cannot play
     */
    async addASegmentToALineup(lineupId: string, body: AddLineupSegmentInput): Promise<Lineup> {
        const result = await this.fetch(`/director/lineups/${encodeURIComponent(lineupId)}/segments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<Lineup>(result);
    }

    /**
     * @name Move a lineup item
     * @description Moves a line. A position at or before the cursor is refused rather than clamped: that part of the order is already committed
     */
    async moveALineupItem(lineupId: string, itemId: string, body: MoveLineupItemInput): Promise<Lineup> {
        const result = await this.fetch(`/director/lineups/${encodeURIComponent(lineupId)}/items/${encodeURIComponent(itemId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<Lineup>(result);
    }

    /**
     * @name Remove a lineup item
     * @description Drops a line that has not been committed yet
     */
    async removeALineupItem(lineupId: string, itemId: string, query?: EditLineupInput): Promise<Lineup> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/director/lineups/${encodeURIComponent(lineupId)}/items/${encodeURIComponent(itemId)}${qs}`, {
            method: 'DELETE',
        });
        return await parseJson<Lineup>(result);
    }
}
