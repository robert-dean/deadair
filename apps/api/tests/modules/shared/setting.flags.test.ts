// Every case here is the same bug from a different angle: `deadair.settings` and dotenv both hand
// back the raw string, and `'false'` is truthy. So the reading that matters is not "is `'true'`
// true" -- a broken implementation gets that right -- but "does `'false'` turn the thing OFF".

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { settingIsOn } from '../../../src/modules/shared/setting.flags.js';

/** A config whose layer holds exactly what Postgres or a `.env` file would put there. */
const config = (rows: Record<string, unknown>): AppConfig =>
    ({
        get: (key: string, fallback: unknown) => (key in rows ? rows[key] : fallback),
        has: (key: string) => key in rows,
    }) as unknown as AppConfig;

describe('settingIsOn', () => {
    it('turns a feature OFF for the string the settings table actually stores', () => {
        // The whole reason this file exists. Read as a boolean, `'false'` is truthy and the switch
        // is welded on.
        expect(settingIsOn(config({ 'llm.setGenerator': 'false' }), 'llm.setGenerator', true)).toBe(false);
    });

    it('turns it on for the string form too', () => {
        expect(settingIsOn(config({ 'llm.setGenerator': 'true' }), 'llm.setGenerator', false)).toBe(true);
    });

    it('reads a real boolean, which is what a default and a test both hand over', () => {
        expect(settingIsOn(config({ key: true }), 'key', false)).toBe(true);
        expect(settingIsOn(config({ key: false }), 'key', true)).toBe(false);
    });

    it('takes the declared default when nothing is stored', () => {
        expect(settingIsOn(config({}), 'missing', true)).toBe(true);
        expect(settingIsOn(config({}), 'missing', false)).toBe(false);
    });

    it('takes the default for a row that was cleared rather than answered', () => {
        // An empty string is what clearing the box leaves behind, and it is not a "no".
        expect(settingIsOn(config({ key: '' }), 'key', true)).toBe(true);
        expect(settingIsOn(config({ key: '   ' }), 'key', true)).toBe(true);
    });

    it('accepts the words somebody hand-editing a .env file would actually type', () => {
        // The console only ever writes true/false, but `OTP_DEV_BYPASS=1` is a thing people write,
        // and a switch that reads as off because its operator used the wrong word for yes is the
        // same class of silent failure this file is about.
        for (const on of ['1', 'yes', 'on', 'TRUE', ' True ']) {
            expect(settingIsOn(config({ key: on }), 'key', false)).toBe(true);
        }
        for (const off of ['0', 'no', 'off', 'FALSE', ' False ']) {
            expect(settingIsOn(config({ key: off }), 'key', true)).toBe(false);
        }
    });

    it('takes the default rather than false for something it cannot read', () => {
        // A value nobody can parse is a value nobody set. Falling to `false` instead would switch
        // off a feature that ships on, which is a worse guess than the one the registry declared.
        expect(settingIsOn(config({ key: 'banana' }), 'key', true)).toBe(true);
        expect(settingIsOn(config({ key: 'banana' }), 'key', false)).toBe(false);
    });
});
