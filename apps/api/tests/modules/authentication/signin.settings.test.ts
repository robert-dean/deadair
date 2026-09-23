// The identity providers a station offers, read from the console's list, and the allowlist that
// decides who may create an account through one. The resolver's job is to be tolerant without being
// wrong: a broken row costs that row, never the others, and a secret seeded by hand still works.

import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { ROW_ID_KEY, rowSecretKey } from '@deadair/plugin-sdk';

import {
    allowlistAdmits,
    parseAllowlist,
    parseAuthorizeParams,
    parseScopes,
    resolveSigninProviders,
    SIGNIN_KEYS,
} from '../../../src/modules/authentication/signin.settings.js';
import { settingsConfig } from '../../utils/settings.config.js';

const encryption = new EncryptionProvider(randomBytes(32));
const decrypt = (ciphertext: string) => encryption.decrypt(ciphertext);
const secretKey = (rowId: string) => rowSecretKey(SIGNIN_KEYS.providers, rowId, 'clientSecret');

const AUTHELIA = { [ROW_ID_KEY]: 'r1', name: 'authelia', label: 'Authelia', issuer: 'https://auth.example.com', clientId: 'deadair' };

const resolve = (rows: Record<string, string>[], extra: Record<string, string> = {}, warn = vi.fn()) =>
    resolveSigninProviders(settingsConfig({ [SIGNIN_KEYS.providers]: JSON.stringify(rows), ...extra }).config, decrypt, warn);

describe('resolveSigninProviders', () => {
    it('reads a complete row, with its secret decrypted and the default scopes', () => {
        const [provider] = resolve([AUTHELIA], { [secretKey('r1')]: encryption.encrypt('shh') });

        expect(provider).toMatchObject({
            name: 'authelia',
            label: 'Authelia',
            clientId: 'deadair',
            clientSecret: 'shh',
            scopes: ['openid', 'email', 'profile'],
        });
        expect(provider?.issuer.href).toBe('https://auth.example.com/');
    });

    it('answers nothing for a station with no providers', () => {
        expect(resolveSigninProviders(settingsConfig().config, decrypt)).toEqual([]);
    });

    it('treats a row with no secret as a public client', () => {
        const [provider] = resolve([AUTHELIA]);
        expect(provider).not.toHaveProperty('clientSecret');
    });

    it('takes a secret seeded by hand as written', () => {
        const [provider] = resolve([AUTHELIA], { [secretKey('r1')]: 'plaintext-from-psql' });
        expect(provider?.clientSecret).toBe('plaintext-from-psql');
    });

    it('lowercases the name', () => {
        expect(resolve([{ ...AUTHELIA, name: 'Authelia' }])[0]?.name).toBe('authelia');
    });

    it('skips an unusable row and keeps the rest, saying why', () => {
        const warn = vi.fn();
        const providers = resolve(
            [
                { ...AUTHELIA, [ROW_ID_KEY]: 'a', name: 'not a slug' },
                { ...AUTHELIA, [ROW_ID_KEY]: 'b', name: 'nolabel', label: '' },
                { ...AUTHELIA, [ROW_ID_KEY]: 'c', name: 'badissuer', issuer: 'ftp://auth.example.com' },
                { ...AUTHELIA, [ROW_ID_KEY]: 'd', name: 'google' },
            ],
            {},
            warn,
        );

        expect(providers.map(provider => provider.name)).toEqual(['google']);
        expect(warn).toHaveBeenCalledTimes(3);
    });

    it('keeps the first of two rows with one name', () => {
        const providers = resolve([AUTHELIA, { ...AUTHELIA, [ROW_ID_KEY]: 'r2', label: 'Second' }]);
        expect(providers).toHaveLength(1);
        expect(providers[0]?.label).toBe('Authelia');
    });

    it('carries the scopes and extra parameters a row names', () => {
        const [provider] = resolve([{ ...AUTHELIA, scopes: 'email groups', authorizeParams: 'prompt=select_account&hd=example.com' }]);
        expect(provider?.scopes).toEqual(['openid', 'email', 'groups']);
        expect(provider?.authorizeParams).toEqual({ prompt: 'select_account', hd: 'example.com' });
    });
});

describe('parseScopes and parseAuthorizeParams', () => {
    it('splits on spaces and commas and always asks for openid', () => {
        expect(parseScopes('email, profile')).toEqual(['openid', 'email', 'profile']);
        expect(parseScopes('openid email')).toEqual(['openid', 'email']);
    });

    it('answers nothing for an empty parameter cell', () => {
        expect(parseAuthorizeParams('')).toBeUndefined();
    });
});

describe('the allowlist', () => {
    const list = parseAllowlist('Alice@Example.com\n@team.example\nexample.org, bob@elsewhere.net');

    it('admits a named address, in any case', () => {
        expect(allowlistAdmits(list, 'alice@example.com')).toBe(true);
        expect(allowlistAdmits(list, 'BOB@elsewhere.net')).toBe(true);
    });

    it('admits any address at a named domain, written with or without the @', () => {
        expect(allowlistAdmits(list, 'carol@team.example')).toBe(true);
        expect(allowlistAdmits(list, 'dave@example.org')).toBe(true);
    });

    it('does not stretch a domain to its subdomains', () => {
        expect(allowlistAdmits(list, 'eve@mail.example.org')).toBe(false);
    });

    it('does not admit another address at a domain only one address of which is named', () => {
        expect(allowlistAdmits(list, 'mallory@example.com')).toBe(false);
    });

    it('admits nobody without an address, and nobody at all when empty', () => {
        expect(allowlistAdmits(list, undefined)).toBe(false);
        expect(allowlistAdmits(parseAllowlist(''), 'alice@example.com')).toBe(false);
    });
});
