import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, buildQueryString } from '../sdk-options.js';
import type {
    ListenerRequest,
    ListenerRequestCreate,
    ListenerRequestDecline,
    ListenerRequestList,
    RequestStatus,
    RequestableTrackList,
} from './types/requests.types.js';
import { reviveListenerRequest, reviveListenerRequestList } from './types/requests.types.js';

export class RequestsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Search requestable records
     * @description Records the station could be asked to play, matching a title or an artist
     */
    async searchRequestableRecords(query: { q: string; limit?: number }): Promise<RequestableTrackList> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/requests/search${qs}`, {
            method: 'GET',
        });
        return await parseJson<RequestableTrackList>(result);
    }

    /**
     * @name List requests
     * @description Every recent request, for the operator deciding on them
     */
    async listRequests(query?: { status?: RequestStatus }): Promise<ListenerRequestList> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/requests${qs}`, {
            method: 'GET',
        });
        return reviveListenerRequestList(await parseJson<ListenerRequestList>(result));
    }

    /**
     * @name Create request
     * @description Ask the station to play a record. Answers with the request whatever became of it, so a refusal says why in `reason`
     */
    async createRequest(body: ListenerRequestCreate): Promise<ListenerRequest> {
        const result = await this.fetch(`/requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveListenerRequest(await parseJson<ListenerRequest>(result));
    }

    /**
     * @name List my requests
     * @description The signed-in account's own recent requests
     */
    async listMyRequests(): Promise<ListenerRequestList> {
        const result = await this.fetch(`/requests/mine`, { method: 'GET' });
        return reviveListenerRequestList(await parseJson<ListenerRequestList>(result));
    }

    /**
     * @name Grant request
     * @description Let a waiting request through. It goes into the running order once its audio is here
     */
    async grantRequest(id: string): Promise<ListenerRequest> {
        const result = await this.fetch(`/requests/${encodeURIComponent(id)}/grant`, { method: 'POST' });
        return reviveListenerRequest(await parseJson<ListenerRequest>(result));
    }

    /**
     * @name Decline request
     * @description Turn a request down. One already in the running order is left there; take it out of the order instead
     */
    async declineRequest(id: string, body: ListenerRequestDecline): Promise<ListenerRequest> {
        const result = await this.fetch(`/requests/${encodeURIComponent(id)}/decline`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveListenerRequest(await parseJson<ListenerRequest>(result));
    }
}
