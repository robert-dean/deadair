import { describe, expect, it } from 'vitest';

import { suggestAirName } from '../../../src/components/personas/air.names';

describe('suggestAirName', () => {
    it('always answers with something sayable', () => {
        // Every shape, many times over: the point of the banks is that no combination comes out
        // empty, doubly spaced, or with a dangling connective.
        for (let attempt = 0; attempt < 500; attempt += 1) {
            const name = suggestAirName();
            expect(name).toMatch(/^[A-Za-z]+( [A-Za-z]+)+$/);
            expect(name.trim()).toBe(name);
        }
    });

    it('changes the name that is already in the field', () => {
        // The button has to visibly do something when pressed twice. Checked against a name the
        // generator really can produce, so this is the collision path rather than a free pass.
        const existing = suggestAirName();
        for (let attempt = 0; attempt < 200; attempt += 1) {
            expect(suggestAirName(existing).toLowerCase()).not.toBe(existing.toLowerCase());
        }
    });

    it('ignores case and surrounding space when avoiding a repeat', () => {
        const existing = suggestAirName();
        expect(suggestAirName(`  ${existing.toUpperCase()}  `).toLowerCase()).not.toBe(existing.toLowerCase());
    });

    it('works with nothing in the field at all', () => {
        expect(suggestAirName(undefined)).not.toHaveLength(0);
        expect(suggestAirName('')).not.toHaveLength(0);
        expect(suggestAirName('   ')).not.toHaveLength(0);
    });
});
