import type { DeadairSdk } from '@deadair/sdk';

import { classify } from './connection.failure.js';
import { parseAddress, stationFrom, type Station, type StationSettings } from './station.settings.js';

/** What the settings panel says about the settings it holds. */
export interface ProbeResult {
    ok: boolean;
    text: string;
}

export interface ProbeClients {
    /** The station with no key. */
    anonymous(apiBase: string): Pick<DeadairSdk, 'nowplaying'>;
    /** The station with the key. */
    keyed(station: Station): Pick<DeadairSdk, 'playout'>;
}

/**
 * Whether the settings reach a station and the station takes the key, in a sentence.
 *
 * Two questions, asked in the order that tells the answers apart. The public route first, with no
 * key: an answer proves the ADDRESS, so a refusal after it can only be the key. Then the transport
 * reading with the key, which is what every key on the deck reads.
 *
 * What it cannot tell is whether the key may ACT. The only way to find out whether Skip is allowed
 * is to skip, and a settings check that skipped a record would be a strange thing to press. So it
 * says so, and Skip and Stop report a read-only key themselves when they are pressed.
 */
export async function probeStation(settings: StationSettings, clients: ProbeClients): Promise<ProbeResult> {
    const address = parseAddress(settings.address);
    if (!('origin' in address)) {
        const text = {
            empty: "Enter the station's address: the one its console opens at.",
            notHttp: 'The address has to start with http:// or https://.',
            malformed: 'That is not an address a station can be reached at.',
        }[address.problem];
        return { ok: false, text };
    }
    const station = stationFrom(settings);
    if (station === undefined) {
        return {
            ok: false,
            text: 'Enter an API key. Issue one in the console under Settings, Sign-in and security, API keys, with Read and manage.',
        };
    }

    const host = new URL(station.origin).host;
    let name: string;
    try {
        name = (await clients.anonymous(station.apiBase).nowplaying.getNowPlaying()).station;
    } catch (error) {
        return classify(error) === 'unreachable'
            ? { ok: false, text: `Nothing answered at ${host}. Check the address, and that the station is running.` }
            : { ok: false, text: `${host} answered, but not as a deadair station. Check the address.` };
    }

    try {
        await clients.keyed(station).playout.getPlayoutStatus();
    } catch (error) {
        const failure = classify(error);
        const text =
            failure === 'unauthorised'
                ? `Found ${name}, but it refused this API key. It may be mistyped, revoked or expired.`
                : failure === 'forbidden'
                  ? `Found ${name}, but the account that issued this key may not read the station.`
                  : failure === 'unreachable'
                    ? `Found ${name}, and then it stopped answering. Try again.`
                    : `Found ${name}, but it answered the key with an error. Its activity feed in the console says more.`;
        return { ok: false, text };
    }

    const notAKey = station.apiKey.startsWith('da_')
        ? ''
        : ' This does not look like an API key, which starts with da_, and a session token stops working within the hour.';
    return {
        ok: true,
        text: `Connected to ${name}. Skip and Stop also need the key to have Read and manage; the station checks that when they are pressed.${notAKey}`,
    };
}
