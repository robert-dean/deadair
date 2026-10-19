import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { ServerKitContext } from '@maroonedsoftware/koa';
import { ErrorCodes } from '@deadair/error-codes';
import { STREAM_DEFAULTS, STREAM_KEYS, deployedOrigin, resolvePublicUrl, stationOrigin } from '#modules/stream/stream.settings.js';
import { ANDROID_FACET_PREFIX, androidCertificates } from './android.apps.js';

/** Who a passkey is bound to, in the terms WebAuthn asks for: the host, and the full origin. */
export interface RelyingParty {
    rpId: string;
    rpOrigin: string;
    rpName: string;
}

/**
 * The header a native app names its own WebAuthn origin in, since it sends no `Origin`: for the
 * Android app, `android:apk-key-hash:` and the hash of the certificate it is signed with.
 */
export const APP_ORIGIN_HEADER = 'x-deadair-app-origin';

/** A browser on the developer's own machine, which `pnpm dev` serves the console from. */
const isLoopback = (origin: URL): boolean => origin.hostname === 'localhost' || origin.hostname === '127.0.0.1' || origin.hostname === '[::1]';

/**
 * The relying party a passkey belongs to: the address the station is deployed at, as the browser
 * asking sees it.
 *
 * A self-hosted station has no fixed domain, so this cannot be configured once the way a hosted
 * service's is. It is read from the request's `Origin`, and that is safe ONLY because the origin is
 * then held to the addresses the operator deployed the station at (`SPA_BASE_URL`, `APP_BASE_URL`
 * and `stream.publicUrl`). Echoing any origin back would hand a page on another domain a challenge
 * its own passkey could answer, which is the one attack passkeys exist to stop.
 *
 * In development the console is served from `localhost` on whatever port Vite picked, and that is
 * allowed too, but only under `NODE_ENV=development`, on the rule `OTP_DEV_BYPASS` follows.
 *
 * A station reached over plain `http://` on a LAN address gets nothing here: WebAuthn needs a
 * secure context, so the browser refuses before the API is asked, and the console does not offer
 * a passkey there at all.
 */
@Injectable()
export class PasskeyRelyingParty {
    constructor(
        private readonly context: ServerKitContext,
        private readonly config: AppConfig,
    ) {}

    /** The relying party for this request, or a 400 naming why a passkey cannot be used from here. */
    resolve(): RelyingParty {
        const origin = this.requestOrigin();
        if (!origin || !this.allows(origin)) {
            throw httpError(400).withDetails({
                code: ErrorCodes.PASSKEY_ORIGIN_REFUSED,
                message: 'passkeys work only at the address the station is deployed at',
            });
        }
        return { rpId: origin.hostname, rpOrigin: origin.origin, rpName: this.stationName() };
    }

    /**
     * The relying party for an ASSERTION, which is the one thing a native app may ask for.
     *
     * A browser is answered exactly as {@link resolve} answers it. A request with no `Origin` that
     * names an app origin in {@link APP_ORIGIN_HEADER} is answered with the station's public host as
     * the relying party, which is the host the console registered the passkey at, and the app's own
     * origin as the one the assertion must carry. That origin is held to the certificates the station
     * vouches for in `assetlinks.json` (`android.apps.ts`), so an app can only name one Android would
     * already have let it use the passkey under, and the verify then refuses an assertion whose
     * `clientDataJSON` names anything else. Registration never comes here: a passkey is made in the
     * console, at a web origin, and an app only proves one.
     */
    resolveForAssertion(): RelyingParty {
        if (this.context.get('origin')) return this.resolve();
        const appOrigin = this.context.get(APP_ORIGIN_HEADER).trim();
        if (!appOrigin.startsWith(ANDROID_FACET_PREFIX)) return this.resolve();

        const host = this.publicHost();
        if (!host || !androidCertificates(this.config).some(certificate => certificate.facet === appOrigin)) {
            throw httpError(400).withDetails({
                code: ErrorCodes.PASSKEY_ORIGIN_REFUSED,
                message: 'this app cannot use a passkey with this station',
            });
        }
        return { rpId: host, rpOrigin: appOrigin, rpName: this.stationName() };
    }

    /**
     * The host the station is published at, when it is published over https. Android looks a
     * relying party up through Digital Asset Links, which reads `assetlinks.json` over https from
     * the host itself, so a station on a plain-http LAN address has no relying party an app can use.
     */
    private publicHost(): string | undefined {
        try {
            const url = new URL(resolvePublicUrl(this.config));
            return url.protocol === 'https:' ? url.hostname : undefined;
        } catch {
            return undefined;
        }
    }

    /** The addresses a passkey may be bound to: every address the station was deployed or published at. */
    allowedOrigins(): string[] {
        const configured = [deployedOrigin(this.config), ...['SPA_BASE_URL', 'APP_BASE_URL'].map(key => String(this.config.get(key, '') ?? ''))];
        configured.push(String(this.config.get(STREAM_KEYS.publicUrl, STREAM_DEFAULTS.publicUrl) ?? ''));
        const origins = new Set<string>();
        for (const value of configured) {
            const trimmed = stationOrigin(value);
            if (!trimmed) continue;
            try {
                origins.add(new URL(trimmed).origin);
            } catch {
                // A setting that is not a URL names no address a passkey could be bound to.
            }
        }
        return [...origins];
    }

    private allows(origin: URL): boolean {
        if (process.env.NODE_ENV === 'development' && isLoopback(origin)) return true;
        return this.allowedOrigins().includes(origin.origin);
    }

    private requestOrigin(): URL | undefined {
        const header = this.context.get('origin');
        if (!header) return undefined;
        try {
            return new URL(header);
        } catch {
            return undefined;
        }
    }

    /** What the passkey prompt calls the station, as an authenticator app's entry does. */
    private stationName(): string {
        const title = String(this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title)).trim();
        return title.length > 0 ? title : STREAM_DEFAULTS.title;
    }
}
