import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';

import { HLS_REFUSE_DEFAULT, HLS_REFUSE_KEY, agentIsRefused, parseRefusedAgents } from './hls.refusal.js';
import { IcecastClientsClient } from './icecast.clients.client.js';

/**
 * The players the station will not serve, on the Icecast mounts.
 *
 * The same setting and the same matching as the HLS playlists, because an operator is saying one
 * thing about one client. The mechanism differs: a mount client asks once and then holds a
 * connection, so there is no request to answer with a refusal and it has to be found and dropped.
 *
 * An nginx rule would refuse it at the door, and `hls.refusal.ts` gives the reason that is the wrong
 * home for a list an operator edits. The cost is that a robot gets connected for as long as one read
 * of the client list takes, which is why `AudienceWatch` takes it off the count before accepting one.
 */
@Injectable()
export class MountRefusal {
    constructor(
        private readonly clients: IcecastClientsClient,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** Whether there is anybody to refuse. Read each time, so an edit applies to the next reading. */
    refusing(): boolean {
        return this.list().length > 0;
    }

    /**
     * Drops every connection the list names, and answers how many it matched.
     *
     * Matched rather than dropped: the operator has said these are not an audience, whether or not
     * Icecast has let go of them yet, and the next reading tries again. A mount that could not be
     * read contributes nothing, so not being able to tell counts everybody on it. Never throws.
     */
    async sweep(): Promise<number> {
        const refused = this.list();
        if (refused.length === 0) return 0;

        const kills: Promise<boolean>[] = [];
        for (const mount of await this.clients.connections()) {
            if (!('connections' in mount)) continue;
            for (const connection of mount.connections) {
                if (agentIsRefused(refused, connection.agent)) kills.push(this.clients.kill(mount.mount, connection.id));
            }
        }
        if (kills.length === 0) return 0;

        const dropped = (await Promise.all(kills)).filter(Boolean).length;
        // A count and nothing else: this list carries listeners' addresses and is never logged.
        this.logger.info(`audience: refused ${kills.length} mount client(s) on the operator's list, ${dropped} dropped`);
        return kills.length;
    }

    private list(): string[] {
        return parseRefusedAgents(this.config.get(HLS_REFUSE_KEY, HLS_REFUSE_DEFAULT));
    }
}
