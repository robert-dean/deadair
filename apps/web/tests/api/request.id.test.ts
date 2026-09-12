import { afterEach, describe, expect, it, vi } from 'vitest';

import { newRequestId } from '../../src/api/request.id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** What `crypto` looks like on a page served over plain HTTP from anywhere but localhost. */
function insecureCrypto(): Pick<Crypto, 'getRandomValues'> {
    const real = globalThis.crypto;
    return { getRandomValues: real.getRandomValues.bind(real) };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('newRequestId', () => {
    it('answers a version-4 UUID, fresh every time', () => {
        const a = newRequestId();

        expect(a).toMatch(UUID_V4);
        expect(newRequestId()).not.toBe(a);
    });

    it('needs nothing a plain-HTTP page lacks', () => {
        // The case from issue #78: a station opened at http://192.168.1.252:8080 has no
        // `randomUUID` and no `subtle`, and the SDK's own default threw on every request.
        vi.stubGlobal('crypto', insecureCrypto());

        expect(newRequestId()).toMatch(UUID_V4);
    });
});
