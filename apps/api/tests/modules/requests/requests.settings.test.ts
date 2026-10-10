// A broadcast's own request rules in place of the station's: a party night's shorter cooldown and
// longer line, held to the same bounds as the settings, and nothing changed where it asked for none.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import {
    MAX_OPEN_REQUESTS,
    MAX_REQUEST_COOLDOWN_MINUTES,
    requestSettings,
    requestSettingsFor,
} from '../../../src/modules/requests/requests.settings.js';

const config = (settings: Record<string, string> = {}) =>
    ({
        get: vi.fn((key: string, fallback: unknown) => settings[key] ?? fallback),
        has: vi.fn((key: string) => key in settings),
    }) as unknown as AppConfig;

describe('requestSettingsFor', () => {
    it("is the station's settings when the broadcast asked for nothing", () => {
        const station = config({ 'requests.cooldownMinutes': '20', 'requests.maxOpen': '5' });

        expect(requestSettingsFor(station, undefined)).toEqual(requestSettings(station));
        expect(requestSettingsFor(station, {})).toEqual(requestSettings(station));
    });

    it("puts the broadcast's cooldown and line length in place of the station's", () => {
        const settings = requestSettingsFor(config({ 'requests.cooldownMinutes': '30', 'requests.maxOpen': '3' }), {
            requestCooldownMinutes: 5,
            requestMaxOpen: 12,
        });

        expect(settings.cooldownMs).toBe(5 * 60_000);
        expect(settings.maxOpen).toBe(12);
    });

    it('holds a stored value to the same bounds as the settings', () => {
        const settings = requestSettingsFor(config(), { requestCooldownMinutes: 99_999, requestMaxOpen: 0 });

        expect(settings.cooldownMs).toBe(MAX_REQUEST_COOLDOWN_MINUTES * 60_000);
        expect(settings.maxOpen).toBe(1);
        expect(requestSettingsFor(config(), { requestMaxOpen: 500 }).maxOpen).toBe(MAX_OPEN_REQUESTS);
    });
});
