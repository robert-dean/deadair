import type {
    FidoFactorAttestation,
    FidoPublicKeyCredentialRequestOptions,
    PublicKeyCredentialWithAssertion,
    PublicKeyCredentialWithAttestation,
} from '@deadair/sdk';

/**
 * The browser half of a passkey: turning the station's challenge into `navigator.credentials` calls
 * and the browser's answer back into JSON.
 *
 * WebAuthn speaks `ArrayBuffer` and the API speaks base64url, so every binary field crosses here in
 * one direction or the other. Nothing else in the console touches `navigator.credentials`.
 */

/**
 * Whether this browser can use a passkey with this station at all.
 *
 * WebAuthn needs a secure context: `https://`, or `localhost`. A station opened over plain `http://`
 * on its LAN address is not one, and the browser refuses before the station is even asked, so the
 * console offers no passkey there rather than a button that can only fail.
 */
export function passkeysAvailable(): boolean {
    return typeof window !== 'undefined' && window.isSecureContext && typeof window.PublicKeyCredential === 'function';
}

/** Thrown when the person closes the browser's passkey prompt, which is a choice rather than a fault. */
export class PasskeyCancelled extends Error {
    constructor() {
        super('Passkey prompt closed');
        this.name = 'PasskeyCancelled';
    }
}

export function isPasskeyCancelled(error: unknown): boolean {
    // The browser reports a closed prompt and a timed-out one alike as NotAllowedError.
    return error instanceof PasskeyCancelled || (error instanceof DOMException && error.name === 'NotAllowedError');
}

function base64UrlToBuffer(value: string): ArrayBuffer {
    const padded = value
        .replaceAll('-', '+')
        .replaceAll('_', '/')
        .padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
    const binary = atob(padded);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return buffer;
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
    let binary = '';
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Asks the browser to make a passkey for the registration the station started. */
export async function createPasskey(attestation: FidoFactorAttestation): Promise<PublicKeyCredentialWithAttestation> {
    const credential = (await navigator.credentials.create({
        publicKey: {
            rp: { id: attestation.rp.id, name: attestation.rp.name },
            user: { id: base64UrlToBuffer(attestation.user.id), name: attestation.user.name, displayName: attestation.user.displayName },
            challenge: base64UrlToBuffer(attestation.challenge),
            pubKeyCredParams: attestation.pubKeyCredParams,
            ...(attestation.timeout === undefined ? {} : { timeout: attestation.timeout }),
            attestation: attestation.attestation,
        },
    })) as PublicKeyCredential | null;
    if (!credential) throw new PasskeyCancelled();
    const response = credential.response as AuthenticatorAttestationResponse;
    const transports = typeof response.getTransports === 'function' ? response.getTransports() : undefined;

    return {
        id: credential.id,
        type: 'public-key',
        rawId: bufferToBase64Url(credential.rawId),
        ...(credential.authenticatorAttachment
            ? { authenticatorAttachment: credential.authenticatorAttachment as 'platform' | 'cross-platform' }
            : {}),
        clientExtensionResults: credential.getClientExtensionResults() as PublicKeyCredentialWithAttestation['clientExtensionResults'],
        response: {
            clientDataJSON: bufferToBase64Url(response.clientDataJSON),
            attestationObject: bufferToBase64Url(response.attestationObject),
            ...(transports ? { transports: transports as NonNullable<PublicKeyCredentialWithAttestation['response']['transports']> } : {}),
        },
    };
}

/** Asks the browser to prove a passkey the station already knows, for the challenge it issued. */
export async function assertPasskey(assertion: FidoPublicKeyCredentialRequestOptions): Promise<PublicKeyCredentialWithAssertion> {
    const credential = (await navigator.credentials.get({
        publicKey: {
            challenge: base64UrlToBuffer(assertion.challenge),
            ...(assertion.timeout === undefined ? {} : { timeout: assertion.timeout }),
            ...(assertion.rpId === undefined ? {} : { rpId: assertion.rpId }),
            ...(assertion.userVerification === undefined ? {} : { userVerification: assertion.userVerification }),
            ...(assertion.allowCredentials
                ? {
                      allowCredentials: assertion.allowCredentials.map(allowed => ({
                          type: allowed.type,
                          id: base64UrlToBuffer(allowed.id),
                          ...(allowed.transports ? { transports: allowed.transports as AuthenticatorTransport[] } : {}),
                      })),
                  }
                : {}),
        },
    })) as PublicKeyCredential | null;
    if (!credential) throw new PasskeyCancelled();
    const response = credential.response as AuthenticatorAssertionResponse;

    return {
        id: credential.id,
        type: 'public-key',
        rawId: bufferToBase64Url(credential.rawId),
        ...(credential.authenticatorAttachment
            ? { authenticatorAttachment: credential.authenticatorAttachment as 'platform' | 'cross-platform' }
            : {}),
        clientExtensionResults: credential.getClientExtensionResults() as PublicKeyCredentialWithAssertion['clientExtensionResults'],
        response: {
            clientDataJSON: bufferToBase64Url(response.clientDataJSON),
            authenticatorData: bufferToBase64Url(response.authenticatorData),
            signature: bufferToBase64Url(response.signature),
            ...(response.userHandle ? { userHandle: bufferToBase64Url(response.userHandle) } : {}),
        },
    };
}
