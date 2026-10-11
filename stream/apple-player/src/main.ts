import { readConfig } from './config.ts';
import { sinkExists } from './capture.ts';
import { startBrowser } from './browser.ts';
import { playerOn } from './player.ts';
import { createPlayerServer } from './server.ts';

/**
 * Boot order, which is the whole of this file: sink, browser, recorder, server.
 *
 * Nothing here waits for the app. The container comes up before the app that mints its credentials,
 * a station that runs no Apple Music never asks it for anything, and `/health` is how anybody learns
 * what state it is in — the same arrangement `stream/spotify-shim` settled on for the same reasons.
 *
 * The one thing it refuses to start without is the signing secret, because a server that cannot
 * verify a signature and serves anyway is a public Apple Music proxy. The supervisor restarts it on a
 * throttle, so an unseeded station logs a line every few seconds rather than looking healthy.
 */
const log = (message: string, detail?: unknown): void => {
    const line = { at: new Date().toISOString(), message, ...(detail === undefined ? {} : { detail }) };
    process.stdout.write(`${JSON.stringify(line)}\n`);
};

async function main(): Promise<void> {
    const config = readConfig();

    if (config.secret === '') {
        log('refusing to start: PLAYOUT_BRIDGE_SECRET is not set, so no fetch could be verified');
        process.exitCode = 1;
        return;
    }

    if (!(await sinkExists(config.sink))) {
        // A warning and not a refusal: the sink is loaded by `default.pa` when PulseAudio starts, and
        // on a cold container this can lose a race with it. `/health` keeps reporting it, and a
        // capture that finds no audio fails loudly on its own.
        log('the capture sink is not there yet', { sink: config.sink });
    }

    const browser = await startBrowser({
        cdpPort: config.cdpPort,
        profileDir: process.env.APPLE_PLAYER_PROFILE ?? '/state/profile',
        playerUrl: config.playerUrl,
        log,
    });
    log('chrome is up', { url: config.playerUrl });

    const player = playerOn(browser.client, browser.session);

    // Best effort, and nothing depends on it: at this point Chrome has a page but the web player's own
    // bundle has almost certainly not run yet, so the honest outcome here is "no MusicKit instance on
    // this page" and it means nothing. `PlayerHandle.ensure` is what actually guarantees a recorder,
    // and it runs on every fetch and every `/health`. This line exists so the boot log says which
    // state the page was in, not as a precondition.
    const installed = await player.install().catch(error => ({ installed: false, reason: String(error) }));
    log('recorder at boot (ensured again per fetch)', installed);

    const server = createPlayerServer({ config, client: browser.client, session: browser.session, player, log });
    server.listen(config.port, '0.0.0.0', () => log('listening', { port: config.port, format: config.format }));

    const stop = (signal: string): void => {
        log('stopping', { signal });
        server.close();
        browser.stop();
        process.exit(0);
    };
    process.on('SIGTERM', () => stop('SIGTERM'));
    process.on('SIGINT', () => stop('SIGINT'));
}

await main();
