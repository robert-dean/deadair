import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { ServerKitContext } from '@maroonedsoftware/koa';
import { ErrorCodes } from '@deadair/error-codes';
import { STREAM_DEFAULTS, STREAM_KEYS, deployedOrigin, stationOrigin } from '#modules/stream/stream.settings.js';

/** Who a passkey is bound to, in the terms WebAuthn asks for: the host, and the full origin. */
export interface RelyingParty {
    rpId: string;
    rpOrigin: string;
    rpName: string;
}

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
