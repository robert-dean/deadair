// Trivial on its own, and worth pinning anyway: everything that uses it is guarding a case that is
// hard to reproduce and silent when it goes wrong, so the primitive underneath should not also be
// something anyone has to reason about.

import { describe, expect, it } from 'vitest';

import { Epoch } from '../../../src/modules/shared/epoch.js';

describe('Epoch', () => {
    it('says work is current until something invalidates it', () => {
        const epoch = new Epoch();
        const token = epoch.current();

        expect(epoch.isCurrent(token)).toBe(true);

        epoch.bump();

        expect(epoch.isCurrent(token)).toBe(false);
    });

    // The point of a counter over a boolean: a token taken before two changes is no more current
    // than one taken before one, and a flag that was set and cleared would say it was.
    it('does not become current again once it has moved on', () => {
        const epoch = new Epoch();
        const token = epoch.current();

        epoch.bump();
        epoch.bump();

        expect(epoch.isCurrent(token)).toBe(false);
    });

    it('makes work started after a change current again', () => {
        const epoch = new Epoch();
        epoch.bump();

        expect(epoch.isCurrent(epoch.current())).toBe(true);
    });
});
