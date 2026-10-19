// The document Android reads before it will let the listener app use this station's passkeys. At the
// origin, public, and a JSON array even when it has nothing to say.

import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import { afterEach, describe, expect, it } from 'vitest';
import { AppConfig } from '@maroonedsoftware/appconfig';

import { AssetLinksRouter } from '../../src/routes/assetlinks.router.js';
import { settingsConfig } from '../utils/settings.config.js';

const HEX = 'BE:E5:E6:63:30:48:0F:0E:E4:3D:AC:58:54:AE:3F:81:87:34:50:23:FF:16:BA:87:C4:55:57:2F:33:5C:CB:49';

let server: ReturnType<Koa['listen']> | undefined;
afterEach(() => {
    server?.close();
    server = undefined;
});

async function get(settings: Record<string, string>) {
    const config = settingsConfig(settings).config;
    const app = new Koa();
    app.use(async (ctx, next) => {
        (ctx as unknown as { container: { get: (token: unknown) => unknown } }).container = {
            get: token => (token === AppConfig ? config : undefined),
        };
        await next();
    });
    app.use(AssetLinksRouter.routes() as unknown as Koa.Middleware);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));
    return await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/.well-known/assetlinks.json`);
}

describe('GET /.well-known/assetlinks.json', () => {
    it('names the certificates the station vouches for, as JSON', async () => {
        const response = await get({ 'signin.androidCertificates': HEX });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(await response.json()).toContainEqual(
            expect.objectContaining({
                target: expect.objectContaining({ package_name: 'com.maroonedsoftware.deadair', sha256_cert_fingerprints: [HEX] }),
            }),
        );
    });

    it('answers an empty list rather than a 404 when there is nothing to vouch for', async () => {
        expect(await (await get({})).json()).toEqual([]);
    });
});
