import type { PartyGuestSession, PartyJoin, PartyPass, PartyStart, PartyState } from './types/requests.types.js';
import { revivePartyGuestSession, revivePartyPass, revivePartyState } from './types/requests.types.js';
import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';

/**
 * generated from [requests.party.ck](../../../../apps/api/data/contracts/requests/requests.party.ck)
 */
export class RequestsPartyClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Get party
     * @description The party that is on, with its pass, so the console can show the QR code again
     */
    async getParty(): Promise<PartyState> {
        const result = await this.fetch(`/party`, { method: 'GET' });
        return revivePartyState(await parseJson<PartyState>(result));
    }

    /**
     * @name Start party
     * @description Start a party. A party already on is ended first, which turns its guests away, so there is only ever one pass to scan
     */
    async startParty(body: PartyStart): Promise<PartyPass> {
        const result = await this.fetch(`/party`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return revivePartyPass(await parseJson<PartyPass>(result));
    }

    /**
     * @name End party
     * @description End the party. Its pass stops working and every guest who joined with it is turned away on their next request
     */
    async endParty(): Promise<void> {
        await this.fetch(`/party`, { method: 'DELETE' });
    }

    /**
     * @name Join party
     * @description Join the party as a guest. Answers 404 for a pass that is unknown, ended or run out, without saying which
     */
    async joinParty(body: PartyJoin): Promise<PartyGuestSession> {
        const result = await this.fetch(`/party/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return revivePartyGuestSession(await parseJson<PartyGuestSession>(result));
    }
}
