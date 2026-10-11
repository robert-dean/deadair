import { PluginError, jsonBody, tryJsonBody, truncateUpstreamMessage, type PluginHost } from '@deadair/plugin-sdk';

import { Blowfish } from './pandora.blowfish.js';
import { PARTNER, REQUEST_TIMEOUT_MS, TUNER_HOST, WEB_HOST } from './pandora.manifest.js';

/** The tuner API's envelope. `stat` is `ok` or `fail`; a failure carries a numeric `code`. */
interface TunerReply<T> {
    stat: 'ok' | 'fail';
    code?: number;
    message?: string;
    result?: T;
}

interface PartnerLoginResult {
    partnerId: string;
    partnerAuthToken: string;
    /** The server's clock, Blowfish-encrypted with the decrypt key and hex-encoded. */
    syncTime: string;
}

interface UserLoginResult {
    userId: string;
    userAuthToken: string;
    isSubscriber?: boolean;
}

/** What the web API answers a refusal with. */
interface WebFailure {
    message?: string;
    errorCode?: number;
    errorString?: string;
}

/** Tuner codes that mean the token has lapsed and signing in again will fix it. */
const EXPIRED = new Set([1001]);

/**
 * The tuner and web API's failure codes this plugin can say something useful about. The rest are an
 * upstream failure, reported with Pandora's own sentence.
 *
 * Numbers from the unofficial API documentation, which pianobar and pydora agree on.
 */
function tunerFailure(code: number | undefined, message: string | undefined): PluginError {
    const said = message ? truncateUpstreamMessage(message) : `code ${code ?? 'unknown'}`;
    switch (code) {
        case 1002:
            return new PluginError(`Pandora refused the email or password (${said})`).withCode('config');
        case 12:
            return new PluginError('Pandora is only available in the US, and this station is not reaching it from there').withCode('config');
        case 1003:
            return new PluginError(`Pandora says this account cannot listen (${said})`).withCode('auth');
        case 13:
            return new PluginError(`Pandora rejected the request's clock (${said})`).withCode('upstream');
        default:
            return new PluginError(`Pandora refused: ${said}`).withCode('upstream');
    }
}

/**
 * An HTTP-level refusal from the web API, as a `PluginError` whose code says whose problem it is.
 *
 * Exported for the plugin, which turns one of these (`NO_ENTITLEMENTS`) into "this account cannot
 * play a chosen record".
 */
export class PandoraWebError extends PluginError {
    constructor(
        readonly status: number,
        readonly failure: WebFailure,
    ) {
        super(`Pandora answered ${status}: ${truncateUpstreamMessage(failure.message ?? failure.errorString ?? 'no reason given')}`);
        this.withCode(status === 401 || status === 403 ? 'auth' : status === 429 ? 'rate_limited' : status >= 500 ? 'unavailable' : 'upstream');
    }

    /** Pandora's own name for the refusal, e.g. `NO_ENTITLEMENTS`. */
    get errorString(): string | undefined {
        return this.failure.errorString;
    }
}

/**
 * One signed-in Pandora account.
 *
 * Signing in goes through the tuner API, the one Pandora's Android app speaks: a partner sign-in with
 * the app's own published profile, then the listener's, encrypted with Blowfish. Everything after
 * that goes to the web app's REST API, which accepts the tuner's user token as `X-AuthToken`. That
 * split is deliberate. The web API's own sign-in sits behind a browser bot check, and the tuner API
 * has nothing the station needs past signing in.
 *
 * The web API wants a CSRF token as a header AND as a cookie, and checks only that the two match
 * (the double-submit pattern), so one is minted here rather than read off a page.
 *
 * Every method takes the host rather than reading it off a plugin, because a settings save
 * reinitializes the plugin while a call may still be in flight.
 */
export class PandoraSession {
    private readonly encrypt = new Blowfish(new TextEncoder().encode(PARTNER.encryptKey));
    private readonly decrypt = new Blowfish(new TextEncoder().encode(PARTNER.decryptKey));
    private readonly csrf = randomHex(16);

    private signedIn?: Promise<UserLoginResult & { partnerId: string; clockOffsetS: number }>;

    constructor(
        private readonly email: string,
        private readonly password: string,
    ) {}

    /** Whether the signed-in account is a subscriber. Signs in if nothing has yet. */
    async isSubscriber(host: PluginHost): Promise<boolean> {
        return (await this.login(host)).isSubscriber === true;
    }

    /** Forget the sign-in, so the next call makes a fresh one. */
    reset(): void {
        this.signedIn = undefined;
    }

    /**
     * One web API call, signed in. A token Pandora says has lapsed is renewed once and the call made
     * again; a second refusal is the caller's.
     */
    async web<T>(host: PluginHost, endpoint: string, body: unknown): Promise<T> {
        try {
            return await this.webOnce<T>(host, endpoint, body);
        } catch (error) {
            if (!(error instanceof PandoraWebError) || !(error.status === 401 || EXPIRED.has(error.failure.errorCode ?? -1))) throw error;
            this.reset();
            return this.webOnce<T>(host, endpoint, body);
        }
    }

    private async webOnce<T>(host: PluginHost, endpoint: string, body: unknown): Promise<T> {
        const { userAuthToken } = await this.login(host);
        const response = await host.fetch(`https://${WEB_HOST}/api/${endpoint}`, {
            method: 'POST',
            body: JSON.stringify(body),
            timeoutMs: REQUEST_TIMEOUT_MS,
            headers: {
                'content-type': 'application/json',
                'x-authtoken': userAuthToken,
                'x-csrftoken': this.csrf,
                cookie: `csrftoken=${this.csrf}`,
                origin: `https://${WEB_HOST}`,
                referer: `https://${WEB_HOST}/`,
            },
        });

        if (!response.ok) throw new PandoraWebError(response.status, (await tryJsonBody<WebFailure>(response)) ?? {});
        return jsonBody<T>(response);
    }

    /** The account's sign-in, made once and shared by every call that arrives while it is made. */
    private login(host: PluginHost): Promise<UserLoginResult & { partnerId: string; clockOffsetS: number }> {
        if (this.signedIn === undefined) {
            this.signedIn = this.signIn(host);
            // A failed sign-in is not kept, so the next call tries again rather than repeating it.
            this.signedIn.catch(() => (this.signedIn = undefined));
        }
        return this.signedIn;
    }

    private async signIn(host: PluginHost): Promise<UserLoginResult & { partnerId: string; clockOffsetS: number }> {
        const partner = await this.tuner<PartnerLoginResult>(host, 'auth.partnerLogin', {
            body: { username: PARTNER.username, password: PARTNER.password, deviceModel: PARTNER.deviceModel, version: PARTNER.version },
        });

        // The server's clock, as `xxxx<unix seconds>…`: four bytes of noise and then ten digits.
        const clock = new TextDecoder('latin1').decode(this.decrypt.decrypt(hexToBytes(partner.syncTime)));
        const serverNow = Number(clock.slice(4, 14));
        if (!Number.isFinite(serverNow)) throw new PluginError('Pandora answered the partner sign-in with a clock this plugin cannot read').withCode('upstream');
        const clockOffsetS = serverNow - Date.now() / 1000;

        const user = await this.tuner<UserLoginResult>(host, 'auth.userLogin', {
            partnerId: partner.partnerId,
            token: partner.partnerAuthToken,
            tokenField: 'partnerAuthToken',
            clockOffsetS,
            encrypted: true,
            body: { loginType: 'user', username: this.email, password: this.password, returnIsSubscriber: true },
        });

        return { ...user, partnerId: partner.partnerId, clockOffsetS };
    }

    private async tuner<T>(
        host: PluginHost,
        method: string,
        options: {
            body: Record<string, unknown>;
            partnerId?: string;
            token?: string;
            tokenField?: string;
            clockOffsetS?: number;
            encrypted?: boolean;
        },
    ): Promise<T> {
        const params = new URLSearchParams({ method });
        const body: Record<string, unknown> = { ...options.body };
        if (options.partnerId !== undefined) params.set('partner_id', options.partnerId);
        if (options.token !== undefined && options.tokenField !== undefined) {
            params.set('auth_token', options.token);
            body[options.tokenField] = options.token;
        }
        if (options.clockOffsetS !== undefined) body.syncTime = Math.floor(Date.now() / 1000 + options.clockOffsetS);

        const json = JSON.stringify(body);
        const response = await host.fetch(`https://${TUNER_HOST}/services/json/?${params}`, {
            method: 'POST',
            body: options.encrypted === true ? bytesToHex(this.encrypt.encrypt(zeroPad(new TextEncoder().encode(json)))) : json,
            timeoutMs: REQUEST_TIMEOUT_MS,
            headers: { 'content-type': 'text/plain' },
        });

        const reply = await jsonBody<TunerReply<T>>(response);
        if (reply.stat !== 'ok' || reply.result === undefined) throw tunerFailure(reply.code, reply.message);
        return reply.result;
    }
}

/** Pad to whole Blowfish blocks with zero bytes, which is what Pandora's tuner expects. */
function zeroPad(bytes: Uint8Array): Uint8Array {
    const padded = new Uint8Array(Math.ceil(bytes.length / 8) * 8);
    padded.set(bytes);
    return padded;
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new PluginError('Pandora answered with a clock that is not hex').withCode('upstream');
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}

function randomHex(bytes: number): string {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Exported for the tests, which play Pandora and need to read what the plugin sent. */
export const pandoraCodec = { bytesToHex, hexToBytes, zeroPad };
