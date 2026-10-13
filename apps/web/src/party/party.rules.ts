import type { ListenerRequest, ListenerRequestCreate, RequestableTrack, RequestStatus } from '@deadair/sdk';

/**
 * What the guest page holds itself to, kept the same as the listener apps' (`RequestRules` in
 * `apps/ios/Packages/DeadairCore`, `RequestUiState.kt` on Android), so a guest and a listener with the
 * app ask the station the same way.
 */
export const PARTY_RULES = {
    /** Fewer letters than this is not a search yet. */
    searchMinChars: 2,
    /** How long the box waits for the typing to settle before asking. */
    searchDebounceMs: 250,
    searchLimit: 25,
    /** How often "Your requests" is asked again while the page shows. The station pushes nothing to a page. */
    pollMs: 15_000,
    nameMax: 60,
    dedicateMax: 60,
    messageMax: 200,
} as const;

/** The states in which a request still has something coming. */
const OPEN: readonly RequestStatus[] = ['waiting', 'pending', 'queued'];

export const isOpen = (status: RequestStatus): boolean => OPEN.includes(status);

/**
 * Whether the guest may still insist on a refusal: one the station turned down for its own taste, and
 * not insisted on yet. The station decides that and says so in `overrulable`; the page only reads it.
 */
export const mayInsist = (request: ListenerRequest): boolean => request.status === 'declined' && request.overrulable === true;

/** The term worth searching for, or undefined while there is not enough of one. */
export function searchTerm(typed: string): string | undefined {
    const term = typed.trim();
    return term.length >= PARTY_RULES.searchMinChars ? term : undefined;
}

/** A result's identity, which is its track for a record the station holds and its source for one it does not. */
export function rowKey(track: RequestableTrack): string {
    if (track.trackId !== undefined) return track.trackId;
    return `${track.source?.pluginId ?? ''}:${track.source?.externalId ?? ''}`;
}

/** What the guest typed into the sheet. Every field is optional. */
export interface PartyForm {
    name: string;
    dedicateTo: string;
    message: string;
}

export const EMPTY_FORM: PartyForm = { name: '', dedicateTo: '', message: '' };

const capped = (value: string, max: number): string | undefined => {
    const trimmed = value.trim().slice(0, max);
    return trimmed.length === 0 ? undefined : trimmed;
};

/**
 * The request to send for one result. A blank field is left out rather than sent empty, because the
 * contract refuses an empty string, and the record is named by exactly one of its track or its source.
 */
export function requestBody(track: RequestableTrack, form: PartyForm): ListenerRequestCreate {
    const name = capped(form.name, PARTY_RULES.nameMax);
    const dedicateTo = capped(form.dedicateTo, PARTY_RULES.dedicateMax);
    const message = capped(form.message, PARTY_RULES.messageMax);
    return {
        ...(track.trackId !== undefined ? { trackId: track.trackId } : track.source !== undefined ? { source: track.source } : {}),
        ...(name === undefined ? {} : { name }),
        ...(dedicateTo === undefined ? {} : { dedicateTo }),
        ...(message === undefined ? {} : { message }),
    };
}

/**
 * What to tell the guest once a request is in. A refusal is a 201 like any other answer, so this reads
 * the status and never the code, and a refusal says the station's own reason where it gave one.
 */
export type Outcome = { kind: 'waiting' | 'onItsWay'; title: string } | { kind: 'refused'; reason?: string };

export function outcomeOf(request: ListenerRequest): Outcome {
    switch (request.status) {
        case 'waiting':
            return { kind: 'waiting', title: request.title };
        case 'declined':
        case 'expired':
            return { kind: 'refused', ...(request.reason === undefined ? {} : { reason: request.reason }) };
        default:
            return { kind: 'onItsWay', title: request.title };
    }
}
