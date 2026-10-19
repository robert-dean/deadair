import { createHash } from 'node:crypto';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { SIGNIN_KEYS } from './signin.settings.js';

/**
 * The Android listener app, as WebAuthn and Digital Asset Links name it: its package and the
 * certificates it is signed with.
 *
 * A passkey made in the console is bound to the station's host. Android's Credential Manager will
 * only hand it to an app the host vouches for, in `/.well-known/assetlinks.json`, and the assertion
 * it produces names the app rather than a web page: its `clientDataJSON` origin is
 * `android:apk-key-hash:` followed by the base64url SHA-256 of the signing certificate. So the same
 * list of certificates is both what the station publishes there and what it accepts as an origin.
 */

/**
 * The packages the station vouches for. The release id, and the `.debug` copy that installs beside
 * the Play build on a phone that already has it.
 */
export const ANDROID_APP_PACKAGES: readonly string[] = ['com.maroonedsoftware.deadair', 'com.maroonedsoftware.deadair.debug'];

/**
 * The certificates the published app is signed with, as SHA-256 fingerprints, on every station
 * without anybody configuring them: Play App Signing re-signs what is uploaded, so this is the key
 * Play holds, not the upload key. Empty until it is copied in from the Play Console (Setup, App
 * signing), and until then the Play build answers no passkey; a debug build is named through
 * `signin.androidCertificates` instead.
 */
export const OFFICIAL_ANDROID_CERTIFICATES: readonly string[] = [];

/** What precedes the certificate hash in an Android app's WebAuthn origin. */
export const ANDROID_FACET_PREFIX = 'android:apk-key-hash:';

/** One signing certificate, in both of the spellings the two documents want. */
export interface AndroidCertificate {
    /** Upper-case hex pairs joined by colons, as `keytool` prints it and `assetlinks.json` wants it. */
    fingerprint: string;
    /** The WebAuthn origin an assertion from an app signed with it carries. */
    facet: string;
}

/**
 * Read one fingerprint, in either spelling an operator is likely to have to hand: `keytool`'s
 * colon-separated hex (with or without the colons), or the base64url hash as it appears in an
 * `android:apk-key-hash:` origin. Anything that is not 32 bytes is not a SHA-256 and reads as
 * nothing.
 */
export function parseCertificate(value: string): AndroidCertificate | undefined {
    const trimmed = value.trim().replace(new RegExp(`^${ANDROID_FACET_PREFIX}`), '');
    let bytes: Buffer | undefined;
    const hex = trimmed.replaceAll(':', '');
    if (/^[0-9a-f]{64}$/i.test(hex)) {
        bytes = Buffer.from(hex, 'hex');
    } else if (/^[A-Za-z0-9_-]{43}$/.test(trimmed)) {
        bytes = Buffer.from(trimmed, 'base64url');
    }
    if (bytes?.length !== 32) return undefined;
    return {
        fingerprint: [...bytes].map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(':'),
        facet: `${ANDROID_FACET_PREFIX}${bytes.toString('base64url')}`,
    };
}

/** The facet for a certificate's DER bytes, which is what the app computes about itself. */
export function facetOfCertificate(der: Buffer): string {
    return `${ANDROID_FACET_PREFIX}${createHash('sha256').update(der).digest('base64url')}`;
}

/**
 * Every certificate this station vouches for: the published app's, then the ones the operator
 * added, one per line or separated by commas or spaces. A line that is not a fingerprint is
 * skipped rather than failing the rest, and a certificate named twice is named once.
 */
export function androidCertificates(config: AppConfig): AndroidCertificate[] {
    const configured = String(config.get(SIGNIN_KEYS.androidCertificates, '') ?? '').split(/[\s,]+/);
    const seen = new Map<string, AndroidCertificate>();
    for (const value of [...OFFICIAL_ANDROID_CERTIFICATES, ...configured]) {
        const certificate = parseCertificate(value);
        if (certificate && !seen.has(certificate.facet)) seen.set(certificate.facet, certificate);
    }
    return [...seen.values()];
}

/**
 * The Digital Asset Links statements: every package may use the station's passkeys when signed
 * with any of the certificates. An empty list when there is no certificate at all, which is a
 * valid document saying nothing, rather than a 404 that a verifier might cache as an error.
 */
export function assetLinks(config: AppConfig): unknown[] {
    const fingerprints = androidCertificates(config).map(certificate => certificate.fingerprint);
    if (fingerprints.length === 0) return [];
    return ANDROID_APP_PACKAGES.map(packageName => ({
        relation: ['delegate_permission/common.get_login_creds'],
        target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: fingerprints },
    }));
}
