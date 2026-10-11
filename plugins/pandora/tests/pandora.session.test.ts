// Signing in the way Pandora's Android app does, then calling the web API with that token: what is
// sent, what is encrypted, and what happens when Pandora says no.

import { describe, expect, it } from 'vitest';

import { PARTNER } from '../src/pandora.manifest.js';
import { PandoraSession, PandoraWebError } from '../src/pandora.session.js';
import { EMAIL, PASSWORD, fakePandora } from './pandora.fake.js';

const session = () => new PandoraSession(EMAIL, PASSWORD);

describe('signing in', () => {
    it("signs the partner in with the Android app's own profile, in the clear", async () => {
        const fake = fakePandora();
        fake.web['v4/catalog/annotateObjects'] = { body: {} };

        await session().web(fake.host, 'v4/catalog/annotateObjects', { pandoraIds: [] });

        const partner = fake.tunerCalls[0]!;
        expect(partner.method).toBe('auth.partnerLogin');
        expect(partner.body).toEqual({ username: PARTNER.username, password: PARTNER.password, deviceModel: PARTNER.deviceModel, version: PARTNER.version });
    });

    it("signs the listener in encrypted, with the partner's token and Pandora's clock", async () => {
        const fake = fakePandora();
        fake.web['v4/catalog/annotateObjects'] = { body: {} };
        const before = Math.floor(Date.now() / 1000);

        await session().web(fake.host, 'v4/catalog/annotateObjects', { pandoraIds: [] });

        const user = fake.tunerCalls[1]!;
        expect(user.method).toBe('auth.userLogin');
        expect(user.params.get('partner_id')).toBe('42');
        expect(user.params.get('auth_token')).toBe('partner-token');
        expect(user.body).toMatchObject({ loginType: 'user', username: EMAIL, password: PASSWORD, partnerAuthToken: 'partner-token', returnIsSubscriber: true });
        expect(user.body.syncTime).toBeGreaterThanOrEqual(before - 1);
    });

    it('signs in once for calls that arrive together', async () => {
        const fake = fakePandora();
        fake.web['v4/catalog/annotateObjects'] = { body: {} };
        const shared = session();

        await Promise.all([1, 2, 3].map(() => shared.web(fake.host, 'v4/catalog/annotateObjects', { pandoraIds: [] })));

        expect(fake.tunerCalls.map(call => call.method)).toEqual(['auth.partnerLogin', 'auth.userLogin']);
    });

    it('says a wrong email or password is the operator\'s to fix', async () => {
        const fake = fakePandora();
        fake.userLogin = { stat: 'fail', code: 1002, message: 'INVALID_LOGIN' };

        await expect(session().isSubscriber(fake.host)).rejects.toMatchObject({ code: 'config', message: expect.stringContaining('email or password') });
    });

    it('says plainly when Pandora will not serve the country the station is in', async () => {
        const fake = fakePandora();
        fake.userLogin = { stat: 'fail', code: 12, message: 'COUNTRY_NOT_ALLOWED' };

        await expect(session().isSubscriber(fake.host)).rejects.toMatchObject({ code: 'config', message: expect.stringContaining('only available in the US') });
    });

    it('tries the sign-in again after one failed, rather than keeping the failure', async () => {
        const fake = fakePandora();
        fake.userLogin = { stat: 'fail', code: 1002 };
        const shared = session();
        await expect(shared.isSubscriber(fake.host)).rejects.toThrow();

        fake.userLogin = { stat: 'ok', result: { userId: 'u', userAuthToken: 't', isSubscriber: true } };

        await expect(shared.isSubscriber(fake.host)).resolves.toBe(true);
    });
});

describe('the web API', () => {
    it("carries the listener's token and a CSRF token that matches its cookie", async () => {
        const fake = fakePandora();
        fake.web['v3/sod/search'] = { body: { results: [] } };

        await session().web(fake.host, 'v3/sod/search', { query: 'x' });

        const { headers } = fake.webCalls[0]!;
        expect(headers['x-authtoken']).toBe('user-token-1');
        expect(headers['x-csrftoken']).toMatch(/^[0-9a-f]{32}$/);
        expect(headers.cookie).toBe(`csrftoken=${headers['x-csrftoken']}`);
    });

    it('signs in again once when Pandora says the token has lapsed', async () => {
        const fake = fakePandora();
        fake.web['v3/sod/search'] = (_body, call) => (call === 0 ? { status: 401, body: { errorCode: 1001, message: 'Auth Token Invalid' } } : { body: { results: [] } });

        await expect(session().web(fake.host, 'v3/sod/search', { query: 'x' })).resolves.toEqual({ results: [] });
        expect(fake.tunerCalls.filter(call => call.method === 'auth.userLogin')).toHaveLength(2);
    });

    it("hands back Pandora's own refusal, naming it", async () => {
        const fake = fakePandora();
        fake.web['v1/playback/source'] = { status: 400, body: { message: 'Listener does not have rights to play source AL:1', errorCode: 0, errorString: 'NO_ENTITLEMENTS' } };

        const refused = session().web(fake.host, 'v1/playback/source', {});

        await expect(refused).rejects.toBeInstanceOf(PandoraWebError);
        await expect(refused).rejects.toMatchObject({ status: 400, errorString: 'NO_ENTITLEMENTS', code: 'upstream' });
    });
});
