import { AppConfig } from '@maroonedsoftware/appconfig';
import { ServerKitRouter } from '@maroonedsoftware/koa';
import { assetLinks } from '#modules/authentication/android.apps.js';

/**
 * `/.well-known/assetlinks.json`: the station vouching for the Android app, so that Credential
 * Manager will hand the app a passkey made for this host.
 *
 * Hand-written because Digital Asset Links fixes the path and the shape, and the path is at the
 * ORIGIN rather than under `/api`: every edge forwards it with the path kept, as it does the OAuth
 * discovery documents. A station is self-hosted on its operator's domain, so there is no one site
 * that could publish this for every station; each one answers for itself, from the certificates in
 * `android.apps.ts`. Public, as the protocol requires, and it says nothing a published app does not.
 */
export const AssetLinksRouter = ServerKitRouter();

AssetLinksRouter.get('/.well-known/assetlinks.json', async ctx => {
    ctx.type = 'application/json';
    ctx.body = assetLinks(ctx.container.get(AppConfig));
});
