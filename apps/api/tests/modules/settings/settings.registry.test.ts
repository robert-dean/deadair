// The registry is a description of settings that are read somewhere else entirely, so the failure
// it can produce is disagreement: a default the console offers that the resolver does not use, or a
// choice the console offers that the parser throws away. Both look to an operator like a setting
// that does nothing, and neither is visible from either side on its own.

import { describe, expect, it } from 'vitest';

import { AIR_MODE_KEY, AIR_MODES, DEFAULT_AIR_MODE, parseAirMode } from '../../../src/modules/playout/air.mode.js';
import { STREAM_DEFAULTS, STREAM_KEYS, STREAM_SECRET_KEYS } from '../../../src/modules/stream/stream.settings.js';
import { findDescriptor, isSecretField, SETTING_DESCRIPTORS, SETTING_GROUPS } from '../../../src/modules/settings/settings.registry.js';

describe('the settings registry', () => {
    it('declares every key exactly once', () => {
        const keys = SETTING_DESCRIPTORS.map(descriptor => descriptor.key);

        expect(new Set(keys).size).toBe(keys.length);
    });

    it('puts every descriptor in a group the console draws', () => {
        for (const descriptor of SETTING_DESCRIPTORS) {
            expect(SETTING_GROUPS).toContain(descriptor.group);
        }
    });

    it('never gives a secret a default', () => {
        // A default for a secret would be a shared password shipped in the source, and the console
        // would prefill an input that must always start empty.
        for (const descriptor of SETTING_DESCRIPTORS.filter(isSecretField)) {
            expect(descriptor.default).toBeUndefined();
        }
    });

    it('describes every stream secret as a secret', () => {
        // The stream module decides which keys hold ciphertext. A key it encrypts and this
        // declares as a `string` would be rendered in the console, in a text input, as base64.
        for (const key of STREAM_SECRET_KEYS) {
            expect(isSecretField(findDescriptor(key)!)).toBe(true);
        }
    });

    it('offers the air modes the parser actually accepts', () => {
        // A `select` offering a value `parseAirMode` does not recognise would write a row the
        // station silently ignores, falling back while the console shows the choice as made.
        const descriptor = findDescriptor(AIR_MODE_KEY)!;
        const offered = (descriptor.options ?? []).map(option => option.value);

        expect(offered).toEqual([...AIR_MODES]);
        for (const value of offered) {
            expect(parseAirMode(value)).toBe(value);
        }
    });

    it('offers the same defaults the resolvers fall back to', () => {
        // The whole reason `STREAM_DEFAULTS` and `DEFAULT_AIR_MODE` are named constants rather
        // than literals in two files.
        expect(findDescriptor(AIR_MODE_KEY)!.default).toBe(DEFAULT_AIR_MODE);
        expect(findDescriptor(STREAM_KEYS.title)!.default).toBe(STREAM_DEFAULTS.title);
        expect(findDescriptor(STREAM_KEYS.mount)!.default).toBe(STREAM_DEFAULTS.mount);
        expect(findDescriptor(STREAM_KEYS.listenerHooks)!.default).toBe(STREAM_DEFAULTS.listenerHooks);
    });

    it('does not know about a key nobody declared', () => {
        // Undeclared rows are ordinary — a setting arrives before its console does — and the point
        // is that this answers `undefined` rather than inventing a descriptor for one.
        expect(findDescriptor('rotation.breakEveryItems')).toBeUndefined();
    });
});
