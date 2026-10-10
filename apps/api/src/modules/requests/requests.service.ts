import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ProviderCopyResolver } from '#modules/catalog/ingest/provider.copy.resolver.js';
import { DISCOVER_DEFAULT, DISCOVER_KEY } from '#modules/director/pick.resolver.js';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { RequestDesk } from './request.desk.js';
import { dedicationOf } from './request.dedication.js';
import { MAX_REQUESTER_NAME, UNNAMED_REQUESTER, tidyListenerText } from './listener.text.js';
import { RequestProviderSearch } from './request.provider.search.js';
import { RequestsRepository, type RequestRow } from './requests.repository.js';
import type {
    ListenerRequest,
    ListenerRequestCreate,
    ListenerRequestDecline,
    ListenerRequestList,
    RequestStatus,
    RequestableTrack,
    RequestableTrackList,
} from './types/requests.types.js';

/** Where it has always been imported from; it lives beside the rest of what is done to listener text. */
export { UNNAMED_REQUESTER };

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
        private readonly providers: RequestProviderSearch,
        private readonly copies: ProviderCopyResolver,
        private readonly config: AppConfig,
    ) {}

    /**
     * The station's own records first, then, when it holds few, records a music provider carries.
     * A provider that cannot be reached costs its rows and nothing else.
     */
    async search(query: { q: string; limit?: number }): Promise<RequestableTrackList> {
        const limit = query.limit ?? DEFAULT_SEARCH_LIMIT;
        const library: RequestableTrack[] = await this.repository.search(query.q, limit);
        if (library.length >= limit || !this.providers.reaches(library.length)) return { tracks: library };

        const reached = await this.providers.search(query.q, library, limit - library.length);
        return { tracks: [...library, ...reached] };
    }

    async create(body: ListenerRequestCreate): Promise<ListenerRequest> {
        const { actorId } = this.authz.requireUser();
        const trackId = await this.trackFor(body);
        const record = await this.repository.findRequestable(trackId);
        if (record === undefined) throw httpError(404).withDetails({ message: 'the station has no record it could play by that id' });

        const name = tidyListenerText(body.name, MAX_REQUESTER_NAME) ?? UNNAMED_REQUESTER;
        const dedication = dedicationOf(body.dedicateTo, body.message);
        const row = await this.desk.submit({ key: `user:${actorId}`, name, actorId }, record, dedication);
        return toListenerRequest(row);
    }

    /**
     * The library record a request names: its `trackId`, or the provider copy its `source` names,
     * taken in first. A record taken in stays in the library whatever becomes of the request, as one
     * a playlist fill finds does.
     */
    private async trackFor(body: ListenerRequestCreate): Promise<string> {
        if ((body.trackId === undefined) === (body.source === undefined)) {
            throw httpError(400).withDetails({ message: 'name the record by trackId or by source, not both and not neither' });
        }
        if (body.trackId !== undefined) return body.trackId;

        const { pluginId, externalId } = body.source!;
        if (!settingIsOn(this.config, DISCOVER_KEY, DISCOVER_DEFAULT)) {
            throw httpError(404).withDetails({ message: 'the station is not taking records in from its providers' });
        }
        const trackId = await this.copies.resolve(pluginId, externalId, 'requests.create.getTrack');
        if (trackId === undefined) throw httpError(404).withDetails({ message: 'that provider has no record by that id the station could take in' });
        return trackId;
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
