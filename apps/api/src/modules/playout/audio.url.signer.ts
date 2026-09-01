import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { LiquidsoapEndpoint } from './liquidsoap.endpoint.js';
import { AUDIO_TOKEN_PARAM, AUDIO_URL_TTL_MS, signAudioPath } from './playout.audio.token.js';

/**
 * Signs the audio URLs handed to anything that fetches with no session.
 *
 * One signer rather than a token minted at each of the five places a URL is built, so the secret
 * is read in one place and the expiry is one number. The secret is the bridge's own, held by
 * {@link LiquidsoapEndpoint} once the playout module has read it, which is why this is a singleton
 * beside it and reads it per call rather than at construction: a job that starts before the secret
 * is seeded would otherwise sign with nothing forever.
 *
 * A URL that goes out unsigned is a URL the player will be refused, so an unseeded secret is said
 * once at warn rather than silently: the station is in the state where the bridge does not work
 * either, and the line names the setting that fixes both.
 */
@Injectable()
export class AudioUrlSigner {
    private warned = false;

    constructor(
        private readonly endpoint: LiquidsoapEndpoint,
        private readonly logger: Logger,
        private readonly now: () => number = Date.now,
    ) {}

    /** `url` with a token over its path in the query, valid for {@link AUDIO_URL_TTL_MS}. */
    sign(url: string): string {
        const secret = this.endpoint.secret();
        if (secret.length === 0) {
            if (!this.warned) {
                this.warned = true;
                this.logger.warn('playout: no bridge secret is seeded, so audio URLs go out unsigned and the player will be refused them');
            }
            return url;
        }

        const parsed = new URL(url);
        parsed.searchParams.set(AUDIO_TOKEN_PARAM, signAudioPath(secret, parsed.pathname, this.now() + AUDIO_URL_TTL_MS));
        return parsed.toString();
    }
}
