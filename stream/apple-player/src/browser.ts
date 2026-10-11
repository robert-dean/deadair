import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { CdpClient } from './cdp.ts';

/**
 * Chrome, started and attached to, with the two flags that are load-bearing and the reasons why.
 *
 * This is Google's Chrome and not Chromium or Playwright's build, and that is not a preference:
 * **only Google's build ships the Widevine CDM**, so only it can play anything Apple Music serves.
 * As of the arm64 Linux release it ships on both architectures the station runs on.
 *
 * It also runs HEADFUL under Xvfb, which is the other thing that cannot be traded away: Widevine
 * does not work in headless Chrome (crbug 40551636) and stubbing the EME API does not help, because
 * the API talks to the real CDM binary. A virtual framebuffer is how everyone who does this does it,
 * and `/health` reports the CDM as available or not rather than letting a silent failure look like a
 * quiet record.
 */
const CHROME_BINARIES = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'];

/**
 * What Chrome complains about in a container that has no desktop, and which is not a fault.
 *
 * Filtered rather than forwarded because it is not a handful of lines: measured on the first boot of
 * this image, dbus and GCM errors alone were most of the log and pushed the four lines that matter
 * (the DevTools address, the player URL, the recorder's state, the listen port) off the end of
 * `docker logs`. A log nobody can read is the same as no log, and the failures this container
 * actually has are all reported by `/health`.
 *
 * Deliberately a list of exact, boring things rather than a level filter: a genuine Chrome error is
 * worth keeping, and `ERROR:` is what most of the noise is labelled.
 */
const CHROME_NOISE = [
    'Failed to connect to the bus',
    'org.freedesktop.DBus',
    'PHONE_REGISTRATION_ERROR',
    'registration_request.cc',
    'XNNPACK delegate',
    'GpuControl.CreateCommandBuffer',
    'ContextResult::kTransientFailure',
    'Failed to call method',
];

export const isChromeNoise = (line: string): boolean => CHROME_NOISE.some(noise => line.includes(noise));

export interface BrowserOptions {
    readonly cdpPort: number;
    readonly profileDir: string;
    readonly playerUrl: string;
    readonly log: (message: string, detail?: unknown) => void;
}

export interface Browser {
    readonly client: CdpClient;
    /** The session id of the player page, which every evaluate goes through. */
    readonly session: string;
    readonly process: ChildProcess;
    stop(): void;
}

export function chromeFlags(options: { cdpPort: number; profileDir: string; url: string }): string[] {
    return [
        `--remote-debugging-port=${options.cdpPort}`,
        // Loopback only. Nothing outside this container may drive the browser holding the operator's
        // Apple Music session, and the port is never published.
        '--remote-debugging-address=127.0.0.1',
        `--user-data-dir=${options.profileDir}`,
        // The signed-in session lives in that profile directory and is the whole auth story for this
        // container: the operator signs in once and the volume keeps it, exactly as the Spotify
        // shim's own authorization survives restarts on the streamstate volume.
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        // Without this, `play()` from an evaluate is refused for want of a user gesture, which
        // presents as a record that loads and never starts. It is the single flag whose absence
        // costs the most time to diagnose.
        '--autoplay-policy=no-user-gesture-required',
        // Chrome cannot use its own sandbox as PID-namespaced non-root without either a user
        // namespace or CAP_SYS_ADMIN. The container gives it neither and runs it as an unprivileged
        // user instead; the thing being contained here is a browser we point at one origin.
        '--no-sandbox',
        '--disable-dev-shm-usage',
        // A window big enough that the web player lays out as a desktop client. It is never seen.
        '--window-size=1280,900',
        options.url,
    ];
}

export async function startBrowser(options: BrowserOptions): Promise<Browser> {
    const binary = CHROME_BINARIES.find(candidate => existsSync(candidate));
    if (binary === undefined) throw new Error(`no chrome binary at any of ${CHROME_BINARIES.join(', ')}`);

    const child = spawn(binary, chromeFlags({ cdpPort: options.cdpPort, profileDir: options.profileDir, url: options.playerUrl }), {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const forward = (chunk: unknown): void => {
        const text = String(chunk).trim();
        if (text !== '' && !isChromeNoise(text)) options.log('chrome', text);
    };
    child.stdout?.on('data', forward);
    child.stderr?.on('data', forward);

    const client = await CdpClient.connect(options.cdpPort, 60_000);
    const session = await attachToPlayerPage(client, options.playerUrl);

    return {
        client,
        session,
        process: child,
        stop: () => {
            client.close();
            child.kill('SIGTERM');
        },
    };
}

/**
 * Find the tab Chrome opened for the player URL and attach to it.
 *
 * Chrome is started WITH the URL rather than navigated to it afterwards, so in the ordinary case the
 * page is already the right one. The fallback navigate covers a profile that restored some other tab.
 */
export async function attachToPlayerPage(client: CdpClient, playerUrl: string): Promise<string> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const pages = (await client.targets()).filter(target => target.type === 'page');
        const player = pages.find(page => page.url.startsWith('https://music.apple.com')) ?? pages[0];
        if (player !== undefined) {
            const session = await client.attach(player.targetId);
            if (!player.url.startsWith('https://music.apple.com')) await client.send('Page.navigate', { url: playerUrl }, session);
            return session;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('chrome opened no page to attach to');
}

/**
 * Whether this browser can actually decrypt anything, asked of the CDM rather than assumed.
 *
 * `requestMediaKeySystemAccess` is the only answer worth having: it fails in exactly the cases that
 * matter (a Chromium without the CDM, a headless launch, a missing component) and it fails the same
 * way Apple Music will. Reported by `/health` so a container that will never play a record says so
 * on the first request rather than on the first rundown.
 */
export const WIDEVINE_PROBE = `(async () => {
    if (!('requestMediaKeySystemAccess' in navigator)) return { available: false, reason: 'no EME in this browser' };
    try {
        const access = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
            initDataTypes: ['cenc'],
            audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
        }]);
        return { available: true, keySystem: access.keySystem };
    } catch (error) {
        return { available: false, reason: String(error && error.message ? error.message : error) };
    }
})()`;

export interface WidevineStatus {
    available: boolean;
    keySystem?: string;
    reason?: string;
}

export async function probeWidevine(client: CdpClient, session: string): Promise<WidevineStatus> {
    try {
        return await client.evaluate<WidevineStatus>(session, WIDEVINE_PROBE);
    } catch (error) {
        return { available: false, reason: error instanceof Error ? error.message : String(error) };
    }
}
