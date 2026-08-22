// ServerKit walks ONE list for both directions, tearing down in REVERSE registration order, so a
// module that must close LAST has to register FIRST. Everything asserted here is a property of that
// list rather than of any module, which is why it is tested here and not there.
//
// Read every assertion below through `tearsDownBefore`: positions are registration order and the
// interesting relation is always teardown, which is its mirror.

import { describe, expect, it } from 'vitest';
import type { Container } from 'injectkit';

import { modules } from '../../src/modules/modules.js';

const names = modules.map(module => module.name);
const positionOf = (name: string) => names.indexOf(name);

/** Teardown is the list read backwards, so a LATER registration tears down EARLIER. */
const tearsDownBefore = (earlier: string, later: string) => positionOf(earlier) > positionOf(later);

describe('the module list', () => {
    it('closes the pools after every module that writes during its own teardown', () => {
        // The bug this pins: the pools closing in `DataModule`'s own position, so the director's
        // flush of the running order ran against a destroyed driver. That flush is a guarantee — a
        // graceful stop writes memory down — and it was lost on nine of the shutdowns in this
        // install's log before the close became its own module at the top of the list.
        const writesOnShutdown = ['Director', 'Playout', 'Jobs', 'Plugins', 'Settings', 'Stream'];

        for (const name of writesOnShutdown) {
            expect(tearsDownBefore(name, 'Connections'), `${name} must tear down before the pools close`).toBe(true);
            // And before the log store, or whatever it says on the way down goes nowhere.
            expect(tearsDownBefore(name, 'Logging'), `${name} must tear down before the log store closes`).toBe(true);
        }
    });

    it('registers the data services before anything that resolves them', () => {
        // The other half, and the reason the close could not simply be moved: the REGISTRATION
        // still has to come before every module that resolves what it registers.
        //
        // Asserted as a whitelist of what may sit in front of Data rather than as
        // `positionOf('Data') === 0`, because three things now do and each earns it narrowly.
        // Logging and Connections register nothing at all — they are up here only so the backward
        // walk reaches them last — and Health depends on nothing, resolves nothing, and exists so a
        // probe asking whether the process is up gets the true answer while everything below is
        // still starting. A FOURTH module appearing in front would be the bug this test is for, and
        // `toBe(0)` could not tell the two apart — it just failed.
        expect(names.slice(0, positionOf('Data'))).toEqual(['Logging', 'Connections', 'Health']);
    });

    it('keeps logging first, so it tears down last and the two lines the pool close writes are flushed', () => {
        expect(positionOf('Logging')).toBe(0);
        expect(positionOf('Connections')).toBe(1);
    });

    it('stops the job workers before the plugin instances under them are disposed', () => {
        // Nothing else pins this one: Jobs resolves nothing Plugins registers, so the position is a
        // teardown constraint and only a teardown constraint. Workers still dequeuing against
        // disposed plugins is what it buys against.
        expect(tearsDownBefore('Jobs', 'Plugins')).toBe(true);
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
