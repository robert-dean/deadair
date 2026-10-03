import { DateTime } from 'luxon';
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * A music provider's copy of a record the station has not taken in yet
 * generated from [RequestableSource](../../../../../apps/api/data/contracts/requests/requests.types.ck#L7)
 */
export interface RequestableSource {
    /** The plugin that carries it */
    pluginId: string;
    /** That plugin's own id for the record */
    externalId: string;
}

/**
 * generated from [RequestStatus](../../../../../apps/api/data/contracts/requests/requests.types.ck#L26)
 */
export type RequestStatus = 'waiting' | 'pending' | 'queued' | 'aired' | 'declined' | 'expired';

/**
 * generated from [RequestSource](../../../../../apps/api/data/contracts/requests/requests.types.ck#L28)
 */
export type RequestSource = 'app' | 'chat';

/**
 * Turn a request down
 * generated from [ListenerRequestDecline](../../../../../apps/api/data/contracts/requests/requests.types.ck#L56)
 */
export interface ListenerRequestDecline {
    /** What to tell the listener. Omit for a plain no */
    reason?: string;
}

/**
 * A record the station could be asked for: one it holds, or one a music provider carries
 * generated from [RequestableTrack](../../../../../apps/api/data/contracts/requests/requests.types.ck#L12)
 */
export interface RequestableTrack {
    /** What to send as `trackId` to make the request. Absent for a record from a provider, which is asked for by `source` instead */
    trackId?: string;
    /** Where a record the station does not hold yet comes from. Send it as `source` to ask for it */
    source?: RequestableSource;
    /** The provider, as the station names it, for a record from one */
    sourceName?: string;
    title: string;
    /** The lead artist */
    artist: string;
    album?: string;
    year?: number;
}

/**
 * Ask the station to play a record
 * generated from [ListenerRequestCreate](../../../../../apps/api/data/contracts/requests/requests.types.ck#L48)
 */
export interface ListenerRequestCreate {
    /** A record from the request search that the station holds. Send this or `source`, never both */
    trackId?: string;
    /** A record from the request search that a provider carries. The station takes it in, then decides on the request as usual */
    source?: RequestableSource;
    /** What the station should call you. Omitted, you are "a listener": your account's email address is never shown or read out */
    name?: string;
    /** Dedicate it to somebody. The station may say this name on air */
    dedicateTo?: string;
    /** A few words to go with it. The presenter may put them in their own words on air, and leaves out anything unfit to broadcast; the words themselves are never read out */
    message?: string;
}

/**
 * A record somebody asked the station to play, and what became of it
 * generated from [ListenerRequest](../../../../../apps/api/data/contracts/requests/requests.types.ck#L30)
 */
export interface ListenerRequest {
    id: string;
    /** `waiting` for an operator to approve it, `pending` while its audio is fetched or a place is found for it, `queued` in the running order, `aired` once heard, `declined` or `expired` when it never will be */
    status: RequestStatus;
    /** The record, as it was called when it was asked for */
    title: string;
    artist: string;
    /** Who asked, by the name their account or chat platform gave */
    requesterName: string;
    /** Whether it came from an app or a chat platform */
    source: RequestSource;
    /** When it was asked for */
    createdAt: DateTime;
    /** Why it was declined or expired, in the station's words or an operator's */
    reason?: string;
    /** When it aired */
    airedAt?: DateTime;
    /** Who the listener dedicated it to */
    dedicateTo?: string;
    /** What the listener asked to have said with it, in their own words */
    message?: string;
}

/** Rehydrates every wire-encoded scalar in a ListenerRequest into its runtime type. Mutates and returns `raw`. */
export function reviveListenerRequest(raw: ListenerRequest): ListenerRequest {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['createdAt'] = __dt(__o0['createdAt'], 'ListenerRequest.createdAt');
    if (__o0['airedAt'] != null) {
        __o0['airedAt'] = __dt(__o0['airedAt'], 'ListenerRequest.airedAt');
    }
    return raw;
}

/**
 * Records matching a search, best matches first, the station's own before any a provider carries
 * generated from [RequestableTrackList](../../../../../apps/api/data/contracts/requests/requests.types.ck#L22)
 */
export interface RequestableTrackList {
    tracks: RequestableTrack[];
}

/**
 * Requests, newest first
 * generated from [ListenerRequestList](../../../../../apps/api/data/contracts/requests/requests.types.ck#L44)
 */
export interface ListenerRequestList {
    requests: ListenerRequest[];
}

/** Rehydrates every wire-encoded scalar in a ListenerRequestList into its runtime type. Mutates and returns `raw`. */
export function reviveListenerRequestList(raw: ListenerRequestList): ListenerRequestList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['requests'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveListenerRequest(__a1[__i2] as never);
        }
    }
    return raw;
}
