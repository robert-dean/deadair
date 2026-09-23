// The addresses the station's authorization server is known by. The one that matters most is the
// issuer being the ORIGIN, because that is what puts discovery where every edge forwards it.

import { describe, expect, it } from 'vitest';

import { OAuthOptions } from '../../../src/modules/oauth/oauth.options.js';
import { settingsConfig } from '../../utils/settings.config.js';

describe('OAuthOptions.fromConfig', () => {
    it('makes the origin the issuer and /api/mcp the resource', () => {
        const options = OAuthOptions.fromConfig(
            settingsConfig({ APP_BASE_URL: 'https://radio.example.com/', SPA_BASE_URL: 'https://radio.example.com' }).config,
        );

        expect(options).toMatchObject({
            issuer: 'https://radio.example.com',
            resource: 'https://radio.example.com/api/mcp',
            resourceMetadataUrl: 'https://radio.example.com/.well-known/oauth-protected-resource/api/mcp',
            authorizationEndpoint: 'https://radio.example.com/oauth/authorize',
            tokenEndpoint: 'https://radio.example.com/api/auth/oauth/token',
            registrationEndpoint: 'https://radio.example.com/api/auth/oauth/register',
        });
    });

    it('drops a path from APP_BASE_URL rather than building an issuer under it', () => {
        expect(OAuthOptions.fromConfig(settingsConfig({ APP_BASE_URL: 'https://radio.example.com/station' }).config)?.issuer).toBe(
            'https://radio.example.com',
        );
    });

    it('sends consent to the console when the console lives elsewhere', () => {
        const options = OAuthOptions.fromConfig(
            settingsConfig({ APP_BASE_URL: 'https://api.example.com', SPA_BASE_URL: 'https://console.example.com' }).config,
        );
        expect(options?.authorizationEndpoint).toBe('https://console.example.com/oauth/authorize');
    });

    it('answers nothing on a station with no public address', () => {
        expect(OAuthOptions.fromConfig(settingsConfig().config)).toBeUndefined();
        expect(OAuthOptions.fromConfig(settingsConfig({ APP_BASE_URL: 'not a url' }).config)).toBeUndefined();
    });
});

describe('OAuthOptions.isMcpPath', () => {
    const options = OAuthOptions.fromConfig(settingsConfig({ APP_BASE_URL: 'https://radio.example.com' }).config)!;

    it('matches the MCP path however the router would', () => {
        expect(options.isMcpPath('/mcp')).toBe(true);
        expect(options.isMcpPath('/MCP')).toBe(true);
        expect(options.isMcpPath('/mcp/')).toBe(true);
    });

    it('matches nothing else', () => {
        expect(options.isMcpPath('/mcpx')).toBe(false);
        expect(options.isMcpPath('/settings')).toBe(false);
    });
});
