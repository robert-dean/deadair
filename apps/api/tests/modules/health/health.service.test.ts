// The whole point of this service is that it reads nothing, so the test worth having is
// that it stays that way: a constant status, and an uptime taken from the process rather
// than from any subsystem that could be down while the process is perfectly alive.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthService } from '../../../src/modules/health/health.service.js';

describe('HealthService', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('answers ok with the process uptime in whole milliseconds', () => {
        vi.spyOn(process, 'uptime').mockReturnValue(12.3456);

        expect(new HealthService().liveness()).toEqual({ status: 'ok', uptimeMs: 12346 });
    });

    it('answers during the first tick, when nothing else has started yet', () => {
        // A probe that arrives mid-boot gets the true answer. `uptimeMs: 0` is a live
        // process that has just come up, not a missing one.
        vi.spyOn(process, 'uptime').mockReturnValue(0);

        expect(new HealthService().liveness()).toEqual({ status: 'ok', uptimeMs: 0 });
    });

    it('carries the build revision it was constructed with', () => {
        vi.spyOn(process, 'uptime').mockReturnValue(1);

        expect(new HealthService('a518ad85').liveness()).toEqual({ status: 'ok', uptimeMs: 1000, revision: 'a518ad85' });
    });

    it('omits the revision entirely when nothing stamped the build', () => {
        // `toEqual` treats an absent key and an `undefined` one as the same, so the
        // assertion that matters is on the KEY: an unstamped build must not put
        // `"revision": null` on the wire for the console to have to special-case.
        vi.spyOn(process, 'uptime').mockReturnValue(1);

        expect(new HealthService().liveness()).not.toHaveProperty('revision');
    });
});
