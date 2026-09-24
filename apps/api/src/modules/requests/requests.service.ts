import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { RequestDesk } from './request.desk.js';
import { dedicationOf } from './request.dedication.js';
import { RequestsRepository, type RequestRow } from './requests.repository.js';
import type {
    ListenerRequest,
    ListenerRequestCreate,
    ListenerRequestDecline,
    ListenerRequestList,
    RequestStatus,
    RequestableTrackList,
} from './types/requests.types.js';

/** What a person who gave no name is called. Their account's email address never is. */
export const UNNAMED_REQUESTER = 'a listener';

const DEFAULT_SEARCH_LIMIT = 10;

/** A row as the contract describes it. */
export function toListenerRequest(row: RequestRow): ListenerRequest {
    return {
        id: row.id,
        status: row.status,
        title: row.title,
        artist: row.artist,
        requesterName: row.requesterName,
        source: row.requesterKey.startsWith('chat:') ? 'chat' : 'app',
        createdAt: row.createdAt,
        ...(row.reason === undefined ? {} : { reason: row.reason }),
        ...(row.airedAt === undefined ? {} : { airedAt: row.airedAt }),
        ...(row.dedication?.to === undefined ? {} : { dedicateTo: row.dedication.to }),
        ...(row.dedication?.message === undefined ? {} : { message: row.dedication.message }),
    };
}

/**
 * The requests routes: what a listener app and the console call.
 *
 * Thin over `RequestDesk`, which is also what a chat command calls, so an app and a chat are held to
 * the same rules. The requester of an app request is the signed-in ACCOUNT, and their key is its id,
 * so asking from a second device does not get round the one-at-a-time rule.
 */
@Injectable()
export class RequestsService {
    constructor(
        private readonly authz: AuthorizationContext,
        private readonly desk: RequestDesk,
        private readonly repository: RequestsRepository,
        private readonly identity: StationIdentity,
    ) {}

    async search(query: { q: string; limit?: number }): Promise<RequestableTrackList> {
        return { tracks: await this.repository.search(query.q, query.limit ?? DEFAULT_SEARCH_LIMIT) };
    }

    async create(body: ListenerRequestCreate): Promise<ListenerRequest> {
        const { actorId } = this.authz.requireUser();
        const record = await this.repository.findRequestable(body.trackId);
        if (record === undefined) throw httpError(404).withDetails({ message: 'the station has no record it could play by that id' });

        const name = body.name?.trim() || UNNAMED_REQUESTER;
        const dedication = dedicationOf(body.dedicateTo, body.message);
        const row = await this.desk.submit({ key: `user:${actorId}`, name, actorId }, record, dedication);
        return toListenerRequest(row);
    }

    async mine(): Promise<ListenerRequestList> {
        const { actorId } = this.authz.requireUser();
        const rows = await this.repository.list(this.identity.stationKey, { requesterKey: `user:${actorId}`, limit: 20 });
        return { requests: rows.map(toListenerRequest) };
    }

    async list(query: { status?: RequestStatus }): Promise<ListenerRequestList> {
        const rows = await this.repository.list(this.identity.stationKey, {
            ...(query.status === undefined ? {} : { status: query.status }),
            limit: 100,
        });
        return { requests: rows.map(toListenerRequest) };
    }

    async grant(id: string): Promise<ListenerRequest> {
        const granted = await this.desk.grant(id);
        if (granted !== undefined) return toListenerRequest(granted);
        throw await this.notDecidable(id, 'only a request waiting for an operator can be granted');
    }

    async decline(id: string, body: ListenerRequestDecline): Promise<ListenerRequest> {
        const declined = await this.desk.decline(id, body.reason);
        if (declined !== undefined) return toListenerRequest(declined);
        throw await this.notDecidable(id, 'only a request not yet in the running order can be declined; take a queued one out of the order instead');
    }

    /** 404 for no such request, 409 for one somebody or something already decided. */
    private async notDecidable(id: string, message: string): Promise<Error> {
        const row = await this.repository.find(this.identity.stationKey, id);
        return row === undefined
            ? httpError(404).withDetails({ message: 'no such request' })
            : httpError(409).withDetails({ message, status: row.status });
    }
}
