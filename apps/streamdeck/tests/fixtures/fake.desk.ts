import { SdkError, type ListenerRequest } from '@deadair/sdk';
import { vi } from 'vitest';

import type { WaitingDesk } from '../../src/station/waiting.requests.js';

/** A request waiting for an operator, as the station lists it. Only the fields a key reads are real. */
export function waitingRequest(id: string, title: string): ListenerRequest {
    return {
        id,
        title,
        artist: 'The Velvet Underground',
        status: 'waiting',
        requesterName: 'a listener',
        source: 'app',
    } as unknown as ListenerRequest;
}

/**
 * The station's request desk, holding a line of waiting requests NEWEST first as the station lists
 * them. A grant takes one out of the line; granting one no longer in it answers 409, as the station does.
 */
export function fakeDesk(line: ListenerRequest[] = []) {
    let current = [...line];
    const desk = {
        listRequests: vi.fn(async () => ({ requests: [...current] })),
        grantRequest: vi.fn(async (id: string) => {
            if (!current.some(request => request.id === id)) throw new SdkError(409, 'Conflict', {}, new Headers());
            current = current.filter(request => request.id !== id);
            return {};
        }),
    } satisfies WaitingDesk;
    return {
        desk,
        set(next: ListenerRequest[]) {
            current = [...next];
        },
    };
}
