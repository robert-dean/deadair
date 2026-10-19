// The Android app's certificates, which are both what the station publishes in assetlinks.json and
// what it accepts as an assertion's origin. The two spellings have to describe the same bytes, or
// Android lets the app use a passkey the station then refuses.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { androidCertificates, facetOfCertificate, parseCertificate } from '../../../src/modules/authentication/android.apps.js';
import { settingsConfig } from '../../utils/settings.config.js';

// The Android debug keystore's certificate on one machine, as keytool prints it.
const HEX = 'BE:E5:E6:63:30:48:0F:0E:E4:3D:AC:58:54:AE:3F:81:87:34:50:23:FF:16:BA:87:C4:55:57:2F:33:5C:CB:49';
const FACET = `android:apk-key-hash:${Buffer.from(HEX.replaceAll(':', ''), 'hex').toString('base64url')}`;

describe('parseCertificate', () => {
    it("reads keytool's fingerprint and spells it both ways", () => {
        expect(parseCertificate(HEX)).toEqual({ fingerprint: HEX, facet: FACET });
    });

    it('reads it without colons, in lower case, or as the origin itself', () => {
        expect(parseCertificate(HEX.replaceAll(':', '').toLowerCase())?.facet).toBe(FACET);
        expect(parseCertificate(FACET)?.fingerprint).toBe(HEX);
        expect(parseCertificate(FACET.slice('android:apk-key-hash:'.length))?.fingerprint).toBe(HEX);
    });

    it('reads nothing that is not a SHA-256', () => {
        expect(parseCertificate('')).toBeUndefined();
        expect(parseCertificate('BE:E5:E6')).toBeUndefined();
        expect(parseCertificate('not a fingerprint at all')).toBeUndefined();
    });
});

describe('facetOfCertificate', () => {
    it('is the base64url SHA-256 of the DER bytes, which is what Credential Manager writes', () => {
        const der = Buffer.from('a certificate');
        expect(facetOfCertificate(der)).toBe(`android:apk-key-hash:${createHash('sha256').update(der).digest('base64url')}`);
    });
});

describe('androidCertificates', () => {
    it('takes one per line or separated by commas, skipping what it cannot read and what it already has', () => {
        const other = 'AA:'.repeat(31) + 'AA';
        const config = settingsConfig({ 'signin.androidCertificates': `${HEX}\n  garbage \n${other}, ${FACET}` }).config;

        expect(androidCertificates(config).map(certificate => certificate.fingerprint)).toEqual([HEX, other]);
    });
});
