import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertPasskey, createPasskey, isPasskeyCancelled, PasskeyCancelled, passkeysAvailable } from '../../src/auth/webauthn';

/** base64url of the bytes 1, 2, 3, 255: the round trip has to survive a byte that needs `-`/`_`. */
const BYTES = new Uint8Array([1, 2, 3, 255]);
const BYTES_B64URL = 'AQID_w';

const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('passkeysAvailable', () => {
    it('is false outside a secure context, which is a station on plain http', () => {
        vi.stubGlobal('isSecureContext', false);
        vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
        expect(passkeysAvailable()).toBe(false);
    });

    it('is true in a secure context with WebAuthn', () => {
        vi.stubGlobal('isSecureContext', true);
        vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
        expect(passkeysAvailable()).toBe(true);
    });
});

describe('createPasskey', () => {
    it('hands the browser binary fields and the station base64url ones', async () => {
        const create = vi.fn(async () => ({
            id: 'cred-1',
            rawId: buffer(BYTES),
            authenticatorAttachment: 'platform',
            getClientExtensionResults: () => ({}),
            response: { clientDataJSON: buffer(BYTES), attestationObject: buffer(BYTES), getTransports: () => ['internal'] },
        }));
        vi.stubGlobal('navigator', { credentials: { create } });

        const credential = await createPasskey({
            rp: { id: 'radio.example', name: 'Night Owl FM' },
            user: { id: BYTES_B64URL, name: 'sam@friends.test', displayName: 'sam@friends.test' },
            challenge: BYTES_B64URL,
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            attestation: 'none',
        });

        const options = (create.mock.calls[0] as unknown as [CredentialCreationOptions])[0].publicKey!;
        expect(new Uint8Array(options.challenge as ArrayBuffer)).toEqual(BYTES);
        expect(new Uint8Array(options.user.id as ArrayBuffer)).toEqual(BYTES);
        expect(options.rp).toEqual({ id: 'radio.example', name: 'Night Owl FM' });
        expect(credential).toEqual({
            id: 'cred-1',
            type: 'public-key',
            rawId: BYTES_B64URL,
            authenticatorAttachment: 'platform',
            clientExtensionResults: {},
            response: { clientDataJSON: BYTES_B64URL, attestationObject: BYTES_B64URL, transports: ['internal'] },
        });
    });

    it('treats a prompt that answered nothing as cancelled', async () => {
        vi.stubGlobal('navigator', { credentials: { create: async () => null } });
        await expect(
            createPasskey({
                rp: { id: 'radio.example', name: 'Radio' },
                user: { id: BYTES_B64URL, name: 'a', displayName: 'a' },
                challenge: BYTES_B64URL,
                pubKeyCredParams: [],
                attestation: 'none',
            }),
        ).rejects.toBeInstanceOf(PasskeyCancelled);
    });
});

describe('assertPasskey', () => {
    it('limits the browser to the passkeys the station offered, and returns the signature', async () => {
        const get = vi.fn(async () => ({
            id: 'cred-1',
            rawId: buffer(BYTES),
            authenticatorAttachment: null,
            getClientExtensionResults: () => ({}),
            response: { clientDataJSON: buffer(BYTES), authenticatorData: buffer(BYTES), signature: buffer(BYTES), userHandle: null },
        }));
        vi.stubGlobal('navigator', { credentials: { get } });

        const credential = await assertPasskey({
            challenge: BYTES_B64URL,
            rpId: 'radio.example',
            allowCredentials: [{ type: 'public-key', id: BYTES_B64URL }],
        });

        const options = (get.mock.calls[0] as unknown as [CredentialRequestOptions])[0].publicKey!;
        expect(options.rpId).toBe('radio.example');
        expect(new Uint8Array(options.allowCredentials![0]!.id as ArrayBuffer)).toEqual(BYTES);
        expect(credential.response).toEqual({ clientDataJSON: BYTES_B64URL, authenticatorData: BYTES_B64URL, signature: BYTES_B64URL });
        expect(credential).not.toHaveProperty('authenticatorAttachment');
    });
});

describe('isPasskeyCancelled', () => {
    it('reads a closed or timed-out prompt as a choice rather than a fault', () => {
        expect(isPasskeyCancelled(new PasskeyCancelled())).toBe(true);
        expect(isPasskeyCancelled(new DOMException('closed', 'NotAllowedError'))).toBe(true);
        expect(isPasskeyCancelled(new Error('500'))).toBe(false);
    });
});
