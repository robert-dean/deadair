// The retention window's only use is deciding what to DELETE, and it is the one setting in the
// module whose worst reading destroys the thing it governs. Every uncertain value has to fall the
// safe way, which here means keeping everything.

import { describe, expect, it } from 'vitest';

import type { AppConfig } from '@maroonedsoftware/appconfig';
import {
    captureWrites,
    resolveHistoryRetentionDays,
    SCRIPT_HISTORY_DEFAULTS,
    SCRIPT_HISTORY_KEYS,
} from '../../../src/modules/render/script.history.settings.js';

const config = (values: Record<string, unknown>): AppConfig =>
    ({ get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) }) as unknown as AppConfig;

describe('resolveHistoryRetentionDays', () => {
    it('keeps the registry default when nobody has set it', () => {
        expect(resolveHistoryRetentionDays(config({}))).toBe(SCRIPT_HISTORY_DEFAULTS.retentionDays);
    });

    it('takes the number the operator set', () => {
        expect(resolveHistoryRetentionDays(config({ [SCRIPT_HISTORY_KEYS.retentionDays]: 30 }))).toBe(30);
    });

    it('reads a number that arrived as a string, which is how a settings row stores one', () => {
        expect(resolveHistoryRetentionDays(config({ [SCRIPT_HISTORY_KEYS.retentionDays]: '14' }))).toBe(14);
    });

    it('floors a fractional window rather than handing a fraction to an interval', () => {
        expect(resolveHistoryRetentionDays(config({ [SCRIPT_HISTORY_KEYS.retentionDays]: 7.9 }))).toBe(7);
    });

    it.each([
        ['zero, which is what the setting says means keep everything', 0],
        ['a negative window, which cannot mean anything else', -5],
        ['a row somebody typed a word into', 'soon'],
        ['an empty row', ''],
    ])('keeps everything for %s', (_, value) => {
        expect(resolveHistoryRetentionDays(config({ [SCRIPT_HISTORY_KEYS.retentionDays]: value }))).toBe(0);
    });
});

describe('captureWrites', () => {
    it('is off until somebody turns it on', () => {
        expect(captureWrites(config({}))).toBe(false);
    });

    it('reads a boolean and the string a settings row stores it as', () => {
        expect(captureWrites(config({ [SCRIPT_HISTORY_KEYS.capture]: true }))).toBe(true);
        expect(captureWrites(config({ [SCRIPT_HISTORY_KEYS.capture]: 'true' }))).toBe(true);
        expect(captureWrites(config({ [SCRIPT_HISTORY_KEYS.capture]: 'false' }))).toBe(false);
    });

    it('now takes the words somebody would type by hand, which it did not before', () => {
        // A deliberate widening rather than an accident of the refactor. This read `=== 'true'` and
        // answered `false` for `'yes'`, which is the same silent-wrong-answer failure as the
        // `'false'`-is-truthy bug one rule over, just in the other direction. `settingIsOn` owns the
        // vocabulary now and every switch shares it.
        expect(captureWrites(config({ [SCRIPT_HISTORY_KEYS.capture]: 'yes' }))).toBe(true);
        expect(captureWrites(config({ [SCRIPT_HISTORY_KEYS.capture]: '1' }))).toBe(true);
        expect(captureWrites(config({ [SCRIPT_HISTORY_KEYS.capture]: 'off' }))).toBe(false);
    });

    it('falls back to the declared default for a value it cannot read', () => {
        expect(captureWrites(config({ [SCRIPT_HISTORY_KEYS.capture]: 'banana' }))).toBe(SCRIPT_HISTORY_DEFAULTS.capture);
    });
});
