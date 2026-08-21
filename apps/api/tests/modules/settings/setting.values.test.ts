// `deadair.settings.value` is a text column, so every setting is a string in storage whatever it
// is in the console. These two functions are the whole of that conversion, and the cases that
// matter are the ones where a wrong answer is indistinguishable from a working station: a boolean
// read from a hand-edited row, a number that will not parse, a select offered a value nothing
// downstream accepts.

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { parseSetting, serializeSetting } from '../../../src/modules/settings/setting.values.js';
import { settingIsOn } from '../../../src/modules/shared/setting.flags.js';
import type { SettingDescriptor } from '../../../src/modules/settings/settings.registry.js';

const descriptor = (overrides: Partial<SettingDescriptor>): SettingDescriptor =>
    ({ group: 'station', key: 'test.key', label: 'Test', type: 'string', ...overrides }) as SettingDescriptor;

describe('parseSetting', () => {
    it('answers the default for a key that is not stored', () => {
        expect(parseSetting(descriptor({ default: 'Deadair' }), undefined)).toBe('Deadair');
    });

    it('answers a stored empty string rather than the default', () => {
        // "Set to empty" and "never set" are different answers, and several settings read the
        // first as an instruction: an empty advertised hostname means "derive it".
        expect(parseSetting(descriptor({ default: 'Deadair' }), '')).toBe('');
    });

    it('reads a stored switch with the words somebody hand-editing a row would type', () => {
        const field = descriptor({ type: 'boolean', default: true });

        expect(parseSetting(field, 'false')).toBe(false);
        expect(parseSetting(field, 'true')).toBe(true);
        // Not only the exact word. This read `stored !== 'false'` for as long as it existed, so
        // every one of these showed as ON in the console while the feature behind it was off.
        expect(parseSetting(field, 'no')).toBe(false);
        expect(parseSetting(field, 'off')).toBe(false);
        expect(parseSetting(field, '0')).toBe(false);
        expect(parseSetting(field, ' FALSE ')).toBe(false);
        expect(parseSetting(field, 'yes')).toBe(true);
    });

    it('takes the declared default for a stored value that means neither', () => {
        // An empty string is what clearing the box leaves behind, and it is not a "no". This is the
        // half that made the old reading wrong in BOTH directions: a cleared row on a switch that
        // ships off used to render as on.
        expect(parseSetting(descriptor({ type: 'boolean', default: true }), '')).toBe(true);
        expect(parseSetting(descriptor({ type: 'boolean', default: false }), '')).toBe(false);
        expect(parseSetting(descriptor({ type: 'boolean', default: false }), 'banana')).toBe(false);
    });

    it('answers exactly what `settingIsOn` answers, for every value either can be handed', () => {
        // The one failure a settings form has. The console renders `parseSetting` and the station
        // runs on `settingIsOn`, so a row they disagree about is a console reporting the opposite
        // of what is running, honestly, off the same row. Asserted end to end rather than by
        // reading the delegation, because the delegation is what a later edit removes.
        const stored = ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off', '', '   ', ' FALSE ', 'TRUE', 'banana'];

        for (const declared of [true, false]) {
            for (const value of stored) {
                const config = { get: (_key: string, fallback: unknown) => value, has: () => true } as unknown as AppConfig;

                expect(parseSetting(descriptor({ type: 'boolean', default: declared }), value)).toBe(settingIsOn(config, 'test.key', declared));
            }
        }
    });

    it('falls back rather than answering NaN for a number that will not parse', () => {
        expect(parseSetting(descriptor({ type: 'number', default: 4 }), 'four')).toBe(4);
        expect(parseSetting(descriptor({ type: 'number', default: 4 }), '7')).toBe(7);
    });

    it('answers a boolean false, not an empty string, for an undeclared default', () => {
        expect(parseSetting(descriptor({ type: 'boolean' }), undefined)).toBe(false);
    });
});

describe('serializeSetting', () => {
    it('stores a boolean as the string the parser reads back', () => {
        // The round trip is the point: anything else here and a switch turned off reads as on.
        const field = descriptor({ type: 'boolean' });

        const stored = serializeSetting(field, false);

        expect(stored).toEqual({ value: 'false' });
        expect(parseSetting(field, 'false')).toBe(false);
    });

    it('takes the string form of a boolean, which is what a form submits', () => {
        expect(serializeSetting(descriptor({ type: 'boolean' }), 'true')).toEqual({ value: 'true' });
    });

    it('refuses a boolean that is neither', () => {
        expect(serializeSetting(descriptor({ type: 'boolean' }), 'yes')).toHaveProperty('rejected');
    });

    it('refuses a choice that is not on offer', () => {
        const field = descriptor({ type: 'select', options: [{ value: 'audience', label: 'Audience' }] });

        expect(serializeSetting(field, 'audience')).toEqual({ value: 'audience' });
        expect(serializeSetting(field, 'always')).toHaveProperty('rejected');
    });

    it('refuses a URL with no scheme, and allows an empty one', () => {
        const field = descriptor({ type: 'url' });

        expect(serializeSetting(field, 'https://radio.example')).toEqual({ value: 'https://radio.example' });
        expect(serializeSetting(field, 'radio.example')).toHaveProperty('rejected');
        // Clearing it is how an operator goes back to "derive it", so empty is an answer.
        expect(serializeSetting(field, '')).toEqual({ value: '' });
    });

    it('refuses an empty value only where one is required', () => {
        expect(serializeSetting(descriptor({}), '')).toEqual({ value: '' });
        expect(serializeSetting(descriptor({ required: true }), '   ')).toHaveProperty('rejected');
    });

    it('trims, so a pasted value with a trailing newline is the value without one', () => {
        expect(serializeSetting(descriptor({}), ' /live.mp3\n')).toEqual({ value: '/live.mp3' });
    });

    it('names the field in the sentence it rejects with', () => {
        const result = serializeSetting(descriptor({ type: 'number', label: 'Bitrate (kbps)' }), 'loud');

        expect('rejected' in result && result.rejected.message).toContain('Bitrate (kbps)');
    });
});
