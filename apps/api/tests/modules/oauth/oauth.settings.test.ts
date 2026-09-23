// The switches behind the station answering OAuth. Settings are strings, so each switch is tested
// with the string it would actually hold, 'false' included, which a boolean-reading bug turns on.

import { describe, expect, it } from 'vitest';

import { clientMetadataHostAllowed, dynamicRegistrationIsOn, OAUTH_KEYS, oauthIsEnabled } from '../../../src/modules/oauth/oauth.settings.js';
import { settingsConfig } from '../../utils/settings.config.js';

describe('the OAuth switches', () => {
    it('is off until somebody turns it on, and off again when they write false', () => {
        expect(oauthIsEnabled(settingsConfig().config)).toBe(false);
        expect(oauthIsEnabled(settingsConfig({ [OAUTH_KEYS.enabled]: 'true' }).config)).toBe(true);
        expect(oauthIsEnabled(settingsConfig({ [OAUTH_KEYS.enabled]: 'false' }).config)).toBe(false);
    });

    it('lets apps register themselves unless told not to', () => {
        expect(dynamicRegistrationIsOn(settingsConfig().config)).toBe(true);
        expect(dynamicRegistrationIsOn(settingsConfig({ [OAUTH_KEYS.dynamicRegistration]: 'false' }).config)).toBe(false);
    });
});

describe('clientMetadataHostAllowed', () => {
    const allowed = (setting: string, host: string) =>
        clientMetadataHostAllowed(settingsConfig({ [OAUTH_KEYS.clientMetadataHosts]: setting }).config, host);

    it('admits any host while the list is empty', () => {
        expect(allowed('', 'claude.ai')).toBe(true);
    });

    it('admits a named host exactly, in any case', () => {
        expect(allowed('claude.ai, example.com', 'Claude.AI')).toBe(true);
        expect(allowed('claude.ai', 'evil.ai')).toBe(false);
        expect(allowed('claude.ai', 'sub.claude.ai')).toBe(false);
    });

    it('admits the subdomains of a wildcard entry, and not the domain itself', () => {
        expect(allowed('*.example.com', 'apps.example.com')).toBe(true);
        expect(allowed('*.example.com', 'example.com')).toBe(false);
        expect(allowed('*.example.com', 'badexample.com')).toBe(false);
    });
});
