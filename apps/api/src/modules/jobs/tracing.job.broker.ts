import { Injectable } from 'injectkit';
import type { JobSendOptions } from '@maroonedsoftware/jobbroker';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { withParentTrace } from './job.trace.payload.js';

/**
 * The station's broker: pg-boss's, plus the one thing an enqueue knows and the job it enqueues
 * cannot find out for itself.
 *
 * ## Why a subclass and not a call-site change
 *
 * There are twenty-odd `send` calls across the director, the render pipeline, the enrichment walk
 * and the plugin service, and a link that depends on every one of them remembering to pass
 * something is a link that is wrong wherever somebody forgot — silently, since a missing edge looks
 * exactly like a root. Here it cannot be forgotten, and a new call site inherits it.
 *
 * It replaces `PgBossJobBroker` under BOTH tokens the jobs module registers, so a caller typed
 * against either gets this. Nothing else about the broker changes: `schedule`, `cancel`, `resume`,
 * `deleteJob` and `getJob` are inherited untouched.
 *
 * ## `send` and not `schedule`
 *
 * A scheduled job is written once and fires forever, so a parent stamped on it would name whatever
 * decision happened to be running at boot and would still be naming it a month later. `schedule` is
 * therefore deliberately not overridden, and a cron-fired job is a root — which it is.
 */
@Injectable()
export class TracingJobBroker extends PgBossJobBroker {
    /**
     * Enqueue, recording which decision asked for it.
     *
     * The payload is copied rather than mutated: a caller that reuses one object across two sends
     * would otherwise have its second send carry the first's parent, and it would be reading its own
     * argument back changed.
     */
    override async send<Payload extends object>(name: string, payload: Payload, options?: JobSendOptions): Promise<string> {
        return await super.send(name, withParentTrace(payload), options);
    }
}
