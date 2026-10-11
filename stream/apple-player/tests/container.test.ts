// The flags and the ffmpeg invocation, pinned.
//
// Both are one-line changes that break the container in ways nothing else notices: a Chrome without
// `--autoplay-policy` loads every record and starts none, and an ffmpeg pointed at the wrong source
// records digital silence into a perfectly valid file. Neither has a symptom until a rundown is
// already running, which is why they are asserted here rather than left to the container's own boot.

import { describe, expect, it } from 'vitest';

import { chromeFlags, isChromeNoise } from '../src/browser.ts';
import { ffmpegArgs } from '../src/capture.ts';
import { playerOn } from '../src/player.ts';
import { CAPTURE_FORMATS, isCaptureFormat, readConfig } from '../src/config.ts';

describe('the Chrome flags', () => {
    const flags = chromeFlags({ cdpPort: 9222, profileDir: '/state/profile', url: 'https://music.apple.com/us/browse' });

    it('allows playback with no user gesture', () => {
        // Without this, `play()` from an evaluate is refused and the record never starts. It is the
        // single flag whose absence costs the most time to diagnose.
        expect(flags).toContain('--autoplay-policy=no-user-gesture-required');
    });

    it('is never headless, because the Widevine CDM does not work there', () => {
        expect(flags.some(flag => flag.includes('headless'))).toBe(false);
    });

    it('keeps DevTools on loopback', () => {
        // The browser holds the operator's Apple Music session. Nothing outside the container may
        // drive it, and the port is not published either.
        expect(flags).toContain('--remote-debugging-address=127.0.0.1');
    });

    it('puts the profile where the volume is, so a sign-in survives a restart', () => {
        expect(flags).toContain('--user-data-dir=/state/profile');
    });

    it('opens the player URL itself rather than navigating afterwards', () => {
        expect(flags.at(-1)).toBe('https://music.apple.com/us/browse');
    });
});

describe('the ffmpeg invocation', () => {
    it('records the monitor of the null sink, not a default device', () => {
        const args = ffmpegArgs({ sink: 'deadair', format: 'flac', path: '/tmp/captures/x.flac' });
        expect(args.join(' ')).toContain('-f pulse -i deadair.monitor');
    });

    it('writes FLAC by default, so the capture adds no second lossy generation', () => {
        const args = ffmpegArgs({ sink: 'deadair', format: 'flac', path: '/tmp/captures/x.flac' });
        expect(args).toContain('flac');
        expect(args.at(-1)).toBe('/tmp/captures/x.flac');
    });

    it('offers mp3 for an operator who would rather have the disk', () => {
        const args = ffmpegArgs({ sink: 'deadair', format: 'mp3', path: '/tmp/captures/x.mp3' });
        expect(args).toContain('libmp3lame');
    });

    it('serves each format as something the app will hold', () => {
        // These have to be in TRACK_SOURCE_TYPES on the app side or the fetch is rejected as "not
        // audio this station can hold" after the record has already been captured in real time.
        expect(CAPTURE_FORMATS.flac.contentType).toBe('audio/flac');
        expect(CAPTURE_FORMATS.mp3.contentType).toBe('audio/mpeg');
    });
});

describe('the config', () => {
    it('defaults to a station that has not been told anything', () => {
        const config = readConfig({ PLAYOUT_BRIDGE_SECRET: 'x' } as NodeJS.ProcessEnv);
        expect(config.port).toBe(3680);
        expect(config.sink).toBe('deadair');
        expect(config.format).toBe('flac');
    });

    it('reads no secret as no secret, which main refuses to start on', () => {
        expect(readConfig({} as NodeJS.ProcessEnv).secret).toBe('');
    });

    it('falls back rather than failing on a format nobody offers', () => {
        expect(readConfig({ APPLE_PLAYER_FORMAT: 'wav' } as NodeJS.ProcessEnv).format).toBe('flac');
        expect(isCaptureFormat('wav')).toBe(false);
    });

    it('ignores a nonsense number rather than listening at NaN', () => {
        expect(readConfig({ APPLE_PLAYER_PORT: 'soon' } as NodeJS.ProcessEnv).port).toBe(3680);
        expect(readConfig({ APPLE_PLAYER_PORT: '-1' } as NodeJS.ProcessEnv).port).toBe(3680);
    });
});

describe('the recorder, which the page can lose', () => {
    it('installs on first use and is a no-op afterwards', async () => {
        // The measured failure this exists for: an install fired 14ms after Chrome came up answered
        // "no MusicKit instance on this page", because the web player's own bundle had not run yet. A
        // container that installed once at boot would have been permanently unable to play anything
        // for a reason that had already gone away.
        const evaluated: string[] = [];
        let pageHasRecorder = false;
        const client = {
            evaluate: async (_session: string, expression: string) => {
                evaluated.push(expression);
                if (expression === '!!window.__deadairPlayer') return pageHasRecorder;
                pageHasRecorder = true;
                return { installed: true };
            },
        } as unknown as Parameters<typeof playerOn>[0];

        const player = playerOn(client, 'session-1');

        expect(await player.ensure()).toEqual({ installed: true });
        expect(evaluated.filter(expression => expression.includes('__deadairPlayer ='))).toHaveLength(1);

        // Second time it only asks, because reinstalling would reset a recorder mid-record.
        expect(await player.ensure()).toEqual({ installed: true });
        expect(evaluated.filter(expression => expression.includes('__deadairPlayer ='))).toHaveLength(1);
    });

    it('reports why it could not install, rather than claiming it did', async () => {
        const client = {
            evaluate: async (_session: string, expression: string) =>
                expression === '!!window.__deadairPlayer' ? false : { installed: false, reason: 'no MusicKit instance on this page' },
        } as unknown as Parameters<typeof playerOn>[0];

        expect(await playerOn(client, 'session-1').ensure()).toEqual({ installed: false, reason: 'no MusicKit instance on this page' });
    });
});

describe('the chrome log filter', () => {
    it('drops what a container with no desktop always says', () => {
        expect(isChromeNoise('[33:55:0920/140317:ERROR:dbus/bus.cc:405] Failed to connect to the bus: …')).toBe(true);
        expect(isChromeNoise('Registration response error message: PHONE_REGISTRATION_ERROR')).toBe(true);
        expect(isChromeNoise('Created TensorFlow Lite XNNPACK delegate for CPU.')).toBe(true);
    });

    it('keeps the lines that are worth reading', () => {
        expect(isChromeNoise('DevTools listening on ws://127.0.0.1:9222/devtools/browser/1a44')).toBe(false);
        expect(isChromeNoise('[ERROR:media/cdm] widevine failed to initialise')).toBe(false);
    });
});
