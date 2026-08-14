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
    /** 200 or nothing: a process that cannot serve this never reaches it. */
    liveness(): Health {
        return { status: 'ok', uptimeMs: Math.round(process.uptime() * 1000) };
    }
}
