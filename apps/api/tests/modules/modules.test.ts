// ServerKit walks ONE list for both directions, so shutdown runs in registration order and a
// dependency order read forwards is a teardown order read backwards. Everything asserted here is a
// property of that list rather than of any module, which is why it is tested here and not there.

import { describe, expect, it } from 'vitest';
import type { Container } from 'injectkit';

import { modules } from '../../src/modules/modules.js';

const names = modules.map(module => module.name);
const positionOf = (name: string) => names.indexOf(name);

describe('the module list', () => {
    it('closes the pools after every module that writes during its own teardown', () => {
        // The bug this pins: `DataModule` has to be first, so its shutdown was first too, and the
        // director's flush of the running order then ran against a destroyed driver. That flush is
        // a guarantee — a graceful stop writes memory down — and it was lost on nine of the
        // shutdowns in this install's log before the close moved to the end.
        const writesOnShutdown = ['Director', 'Playout', 'Jobs', 'Plugins', 'Settings', 'Stream'];

        for (const name of writesOnShutdown) {
            expect(positionOf(name), `${name} must tear down before the pools close`).toBeLessThan(positionOf('Connections'));
        }
    });

    it('registers the data services before anything that resolves them', () => {
        // The other half, and the reason the close could not simply be moved: the REGISTRATION
        // still has to come before every module that resolves what it registers.
        //
        // Asserted as "the only thing in front of Data is Health" rather than as `positionOf('Data')
        // === 0`, which is what this said until the liveness probe went in ahead of it. Health is
        // the one module that may sit there and the exception is narrow: it depends on nothing,
        // resolves nothing, and exists so a probe asking whether the process is up gets the true
        // answer while everything below is still starting. A SECOND module appearing in front would
        // be the bug this test is for, and `toBe(0)` could not tell the two apart — it just failed.
        expect(names.slice(0, positionOf('Data'))).toEqual(['Health']);
    });

    it('keeps logging last, so the two lines the pool close writes are flushed', () => {
        expect(positionOf('Logging')).toBe(names.length - 1);
        expect(positionOf('Connections')).toBe(names.length - 2);
    });

    it('carries no teardown that can reject, whatever it fails to resolve', async () => {
        // Asserted as BEHAVIOUR rather than by checking each hook is wrapped, because the wrapper
        // is an arrow assigned to a `shutdown` property and so reports the same `name` as a raw
        // hook — the two are indistinguishable from out here by shape, and identical in the one way
        // that matters when tested like this.
        //
        // ServerKit awaits these in a loop that catches nothing, so ONE rejection strands every
        // module after it and the process.exit() past the end of the loop. A container that throws
        // on everything is the cheapest way to make each hook fail at its first resolve.
        const hostile = {
            get: () => {
                throw new Error('the container is gone');
            },
        } as unknown as Container;

        for (const module of modules) {
            if (!module.shutdown) continue;
            await expect(module.shutdown(hostile), `${module.name} must not reject`).resolves.toBeUndefined();
        }
    });
});
