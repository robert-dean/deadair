import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, buildQueryString } from '../sdk-options.js';
import type { BreakKindFile, BreakKindImportPlan, BreakKindImportResult, BreakKindInput, BreakKindList } from './types/break.kinds.types.js';
import type { ClockBandInput, ClockBandList } from './types/clock.types.js';
import type {
    AddStationSegmentInput,
    AddStationTrackInput,
    ArtistRoute,
    ExtendStationInput,
    HoldStationInput,
    MoveStationItemInput,
    PutOnAirInput,
    QuietStationInput,
    ReplanStationInput,
    RequestStationBreakInput,
    RoutePreviewInput,
    SetStationAirInput,
    SetStationHostInput,
    StationAir,
    StationBreakRequest,
    StationOrder,
} from './types/director.types.js';
import type { BlockRuleInput, BlockRuleList, GenreSteerInput, GenreSteerReading } from './types/rules.types.js';
import { reviveBlockRuleList, reviveGenreSteerReading } from './types/rules.types.js';

export class DirectorClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List break kinds
     * @description Every kind of break you have written, switched on or not, in your own order
     */
    async listBreakKinds(): Promise<BreakKindList> {
        const result = await this.fetch(`/breaks/kinds`, { method: 'GET' });
        return await parseJson<BreakKindList>(result);
    }

    /**
     * @name Create break kind
     * @description Writes a new kind of break. Nothing airs it until it is switched on and a band on the format clock names it
     */
    async createBreakKind(body: BreakKindInput): Promise<BreakKindList> {
        const result = await this.fetch(`/breaks/kinds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<BreakKindList>(result);
    }

    /**
     * @name Update break kind
     * @description Rewrites one kind of break. Its key cannot change. A break already written keeps the words it was given
     */
    async updateBreakKind(id: string, body: BreakKindInput): Promise<BreakKindList> {
        const result = await this.fetch(`/breaks/kinds/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<BreakKindList>(result);
    }

    /**
     * @name Delete break kind
     * @description Removes a kind of break. Refused while a band on the format clock still names it
     */
    async deleteBreakKind(id: string): Promise<BreakKindList> {
        const result = await this.fetch(`/breaks/kinds/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return await parseJson<BreakKindList>(result);
    }

    /**
     * @name Export break kinds
     * @description Every kind of break you have written, as one file
     */
    async exportBreakKinds(): Promise<{ data: BreakKindFile; headers: { contentDisposition?: string } }> {
        const result = await this.fetch(`/breaks/kinds/export`, { method: 'GET' });
        const data = await parseJson<BreakKindFile>(result);
        return { data, headers: { contentDisposition: result.headers.get('Content-Disposition') ?? undefined } };
    }

    /**
     * @name Export break kind
     * @description One kind of break, as a file
     */
    async exportBreakKind(id: string): Promise<{ data: BreakKindFile; headers: { contentDisposition?: string } }> {
        const result = await this.fetch(`/breaks/kinds/${encodeURIComponent(id)}/export`, { method: 'GET' });
        const data = await parseJson<BreakKindFile>(result);
        return { data, headers: { contentDisposition: result.headers.get('Content-Disposition') ?? undefined } };
    }

    /**
     * @name Preview break kind import
     * @description Reads a file and reports what importing it would create, rewrite, skip and refuse. Writes nothing
     */
    async previewBreakKindImport(body: BreakKindFile, query?: { replace?: string[] }): Promise<BreakKindImportPlan> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/breaks/kinds/import/preview${qs}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<BreakKindImportPlan>(result);
    }

    /**
     * @name Import break kinds
     * @description Writes a file into this station and answers with what it did. Every kind it writes arrives switched off
     */
    async importBreakKinds(body: BreakKindFile, query?: { replace?: string[] }): Promise<BreakKindImportResult> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/breaks/kinds/import${qs}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<BreakKindImportResult>(result);
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
     * @name Recast the broadcast
     * @description Changes who is presenting this broadcast. Breaks already written for it in the outgoing character are written again in the new one
     */
    async recastTheBroadcast(body: SetStationHostInput): Promise<StationOrder> {
        const result = await this.fetch(`/director/air/persona`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
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
     * @name Request a break
     * @description Asks the station to say something now rather than when the format clock next calls for it: the news, the weather, a word from the host. The director decides where it goes. A decline is answered rather than thrown, with the station's reason, because "breaks are off" and "it was asked for a moment ago" are things the person pressing the button needs to read
     */
    async requestABreak(body: RequestStationBreakInput): Promise<StationBreakRequest> {
        const result = await this.fetch(`/director/air/breaks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<StationBreakRequest>(result);
    }

    /**
     * @name Preview an artist route
     * @description Finds a route from one artist to another through artists the library holds, and says how each stop connects to the one before. Nothing goes on air: this is what a route would be
     */
    async previewAnArtistRoute(body: RoutePreviewInput): Promise<ArtistRoute> {
        const result = await this.fetch(`/director/route/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<ArtistRoute>(result);
    }

    /**
     * @name Hold the station against the schedule
     * @description Holds the running order against the schedule, so a block boundary does not take back what an operator put on. A takeover is otherwise stamped with whichever slot was in force and is replaced when that block ends, which is correct and gives nobody any warning
     */
    async holdTheStationAgainstTheSchedule(body: HoldStationInput): Promise<StationAir> {
        const result = await this.fetch(`/director/air/hold`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<StationAir>(result);
    }

    /**
     * @name Release the station to the schedule
     * @description Releases a hold, so the next block boundary changes the station over as it ordinarily would. A station with no hold is unchanged rather than refused
     */
    async releaseTheStationToTheSchedule(): Promise<StationAir> {
        const result = await this.fetch(`/director/air/hold`, { method: 'DELETE' });
        return await parseJson<StationAir>(result);
    }

    /**
     * @name Keep the station quiet
     * @description Keeps the station's own breaks off the air for the next so many records, and takes out the ones already planned across them. Asking again replaces the count
     */
    async keepTheStationQuiet(body: QuietStationInput): Promise<StationAir> {
        const result = await this.fetch(`/director/air/quiet`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<StationAir>(result);
    }

    /**
     * @name End the quiet spell
     * @description Ends a quiet spell now, so the station talks again at its next break. A station that is not quiet is unchanged rather than refused
     */
    async endTheQuietSpell(): Promise<StationAir> {
        const result = await this.fetch(`/director/air/quiet`, { method: 'DELETE' });
        return await parseJson<StationAir>(result);
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
     * @name Add a record to the running order
     * @description Puts a catalog record into the running order. A record whose audio is not local yet is refused here rather than accepted and held or skipped when its slot comes round, so an operator asking for a specific one is told why it cannot play. What makes this worth having on its own is undo: dropping an item only ever marks a segment, but a track is spliced out of the order entirely, so nothing could put one back until this existed
     */
    async addARecordToTheRunningOrder(body: AddStationTrackInput): Promise<StationOrder> {
        const result = await this.fetch(`/director/air/tracks`, {
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
     * @name Write a running order break again
     * @description Writes a break still to come again from nothing: its words, and any audio already made of them, are thrown away and the station writes it afresh as its slot nears, under whoever is presenting by then. Reaches a break that failed to be written, which nothing else retries, so a break that had nothing to say can be asked again after the phrasings change or the model is switched on. Only a break the station wrote itself and has not handed to the player, and never one turn of a programme on its own
     */
    async writeARunningOrderBreakAgain(itemId: string): Promise<StationOrder> {
        const result = await this.fetch(`/director/air/items/${encodeURIComponent(itemId)}/rewrite`, { method: 'POST' });
        return await parseJson<StationOrder>(result);
    }

    /**
     * @name Skip to a running order item
     * @description Makes a record further down the running order the next thing heard. Everything still to come in front of it is marked skipped, anything the player was already holding from in front of it is taken back, and the item on air is cut. Only a record can be skipped to, and only one still to come
     */
    async skipToARunningOrderItem(itemId: string): Promise<StationOrder> {
        const result = await this.fetch(`/director/air/items/${encodeURIComponent(itemId)}/skip-to`, { method: 'POST' });
        return await parseJson<StationOrder>(result);
    }

    /**
     * @name List never-play rules
     * @description Every never-play rule on this station, newest first, each saying whether it holds right now
     */
    async listNeverPlayRules(): Promise<BlockRuleList> {
        const result = await this.fetch(`/rules`, { method: 'GET' });
        return reviveBlockRuleList(await parseJson<BlockRuleList>(result));
    }

    /**
     * @name Add a never-play rule
     * @description Adds a rule. It holds from the next record the station chooses
     */
    async addANeverPlayRule(body: BlockRuleInput): Promise<BlockRuleList> {
        const result = await this.fetch(`/rules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveBlockRuleList(await parseJson<BlockRuleList>(result));
    }

    /**
     * @name Read the genre steer
     * @description The lean in force, if any
     */
    async readTheGenreSteer(): Promise<GenreSteerReading> {
        const result = await this.fetch(`/rules/steer`, { method: 'GET' });
        return reviveGenreSteerReading(await parseJson<GenreSteerReading>(result));
    }

    /**
     * @name Steer toward genres
     * @description Leans the station toward some genres for a number of hours, replacing any lean already in force
     */
    async steerTowardGenres(body: GenreSteerInput): Promise<GenreSteerReading> {
        const result = await this.fetch(`/rules/steer`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveGenreSteerReading(await parseJson<GenreSteerReading>(result));
    }

    /**
     * @name Stop steering
     * @description Ends the lean now
     */
    async stopSteering(): Promise<GenreSteerReading> {
        const result = await this.fetch(`/rules/steer`, { method: 'DELETE' });
        return reviveGenreSteerReading(await parseJson<GenreSteerReading>(result));
    }

    /**
     * @name Change a never-play rule
     * @description Replaces a rule
     */
    async changeANeverPlayRule(id: string, body: BlockRuleInput): Promise<BlockRuleList> {
        const result = await this.fetch(`/rules/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveBlockRuleList(await parseJson<BlockRuleList>(result));
    }

    /**
     * @name Remove a never-play rule
     * @description Removes a rule
     */
    async removeANeverPlayRule(id: string): Promise<BlockRuleList> {
        const result = await this.fetch(`/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return reviveBlockRuleList(await parseJson<BlockRuleList>(result));
    }
}
