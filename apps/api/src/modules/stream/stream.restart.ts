import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { errorText } from '#modules/shared/error.text.js';
import { defaultStreamConfigDir } from './stream.config.js';

/**
 * The file whose mtime asks for the audio chain to be restarted, beside the rendered config.
 *
 * The container's config watch reads nothing but the mtime: see the `config-watch` service in
 * `docker/rootfs` and `stream/config-watch.sh`, which restart Liquidsoap alone when it moves.
 */
export const AUDIO_CHAIN_RESTART_FILE = 'liquidsoap.restart';

/**
 * Asks the stream side to restart Liquidsoap, and nothing else.
 *
 * This process has no Docker socket and no supervisor control, and must not get either: that is
 * root on the host, or the whole container's process tree, in exchange for being able to restart
 * the thing broadcasting it. It already tells the stream side everything else it acts on by writing
 * a file into the directory both can see, and a restart request takes the same road, so the only
 * authority in play is the one the watch already has over its own container.
 *
 * What is written is a timestamp and the reason, for whoever opens the file; the watch never reads
 * either, which is also why nothing here needs protecting. Written beside the target and renamed
 * over it, on `writeIfChanged`'s argument in `stream.config.ts`, and always with new content, so
 * every request moves the mtime.
 */
@Injectable()
export class AudioChainRestart {
    constructor(
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** Ask for the restart. Answers whether the request was written; a failure is logged here. */
    request(reason: string, now = new Date()): boolean {
        const path = join(this.config.get('STREAM_CONFIG_DIR', defaultStreamConfigDir()), AUDIO_CHAIN_RESTART_FILE);
        try {
            const temporary = `${path}.${process.pid}.tmp`;
            writeFileSync(temporary, `${now.toISOString()} ${reason}\n`);
            renameSync(temporary, path);
            return true;
        } catch (error) {
            this.logger.warn(`stream: could not ask for the audio chain to be restarted (${errorText(error)})`, { path });
            return false;
        }
    }
}
