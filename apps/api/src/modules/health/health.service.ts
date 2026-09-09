import { Injectable } from 'injectkit';
import type { Health } from './types/health.types.js';

/**
 * Liveness, and deliberately nothing more.
 *
 * This answers "is there a process on this port serving requests", which is the
 * only question a container healthcheck, a dev-server readiness probe or a
 * supervisor is actually asking. It reads nothing: no database, no Icecast, no
 * plugin. That is the point — a probe that consults subsystems reports a station
 * with an unreachable stream as a dead API, and a restart is the one repair that
 * cannot help.
 *
 * The build revision rides along and does not weaken that. It is a string handed
 * over at construction — see `shared/build.revision.ts` — so answering with it
 * asks nothing of anything, exactly as the uptime does. It belongs on the one
 * route a probe already calls because "which build is this" is the question asked
 * of a process that is up and behaving strangely, and reaching it should not
 * require the station to be healthy enough to serve an authenticated page.
 *
 * Whether the STATION is healthy is a different question with a different answer
 * already: `silence.diagnosis.ts` names every gate that can silence it, ordered
 * causally, and `/playout/status` carries the verdict. Anything tempted to grow
 * a subsystem check here belongs there instead.
 *
 * Answering out of memory is also what lets the route stay transaction-exempt
 * (`infraExemption` in `transaction.exemptions.ts`), so a probe on a short
 * interval never spends a pooled connection.
 */
@Injectable()
export class HealthService {
    /**
     * @param revision What this build was made from, or `undefined` when nothing said. Resolved
     *                 once by the module rather than read per request, because it cannot change
     *                 while the process is running.
     * @param version  Which release this build is, on exactly the same terms. Absent far more often
     *                 than `revision` is: only a tagged build carries one.
     */
    constructor(
        private readonly revision?: string,
        private readonly version?: string,
    ) {}

    /** 200 or nothing: a process that cannot serve this never reaches it. */
    liveness(): Health {
        return {
            status: 'ok',
            uptimeMs: Math.round(process.uptime() * 1000),
            // Omitted rather than sent as an empty string or a placeholder: the field is optional
            // on the contract and absent means nobody stamped this build, which is the true answer
            // for a development tree.
            ...(this.revision === undefined ? {} : { revision: this.revision }),
            ...(this.version === undefined ? {} : { version: this.version }),
        };
    }
}
