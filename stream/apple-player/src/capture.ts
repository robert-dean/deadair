import { spawn } from 'node:child_process';
import { stat, unlink } from 'node:fs/promises';
import { CAPTURE_FORMATS, type CaptureFormat } from './config.ts';

/**
 * Recording what the browser plays, off the monitor of a sink nothing listens to.
 *
 * The container has no sound card, so `default.pa` loads a null sink and makes it the default
 * output: Chrome plays into it happily and its `.monitor` source is a perfect copy of what was
 * played. This is the same act as recording a line-out, which is what makes it a capture rather
 * than a decryption — Apple's own CDM inside Apple's own player does the decoding, and what reaches
 * here is audio.
 *
 * ## Why a file rather than a streamed response
 *
 * The obvious shape is to pipe ffmpeg's stdout straight into the HTTP response. It is wrong here for
 * one reason that outweighs the copy: a status code has to be chosen before the first byte, and
 * whether a record plays is not known until it has. Streaming would mean answering 200 and then
 * discovering that Apple will not play this track in this storefront, which reaches the app as a
 * truncated file rather than as the 410 that writes the copy off. Capturing to a temp file costs one
 * write of a file the app is about to cache anyway, and buys honest status codes and a Content-Length.
 *
 * The capture is deliberately not trimmed. Leading and trailing silence is what `analysis/` measures
 * cue points for, on every provider's audio equally, so trimming here would be a second opinion in
 * the wrong place — and `silenceremove` cannot tell a quiet intro from a gap.
 */

export interface Capture {
    /** Stop capturing and flush the file. Idempotent. */
    finish(): Promise<{ path: string; bytes: number }>;
    /** Abandon the capture and delete the file. */
    abandon(): Promise<void>;
}

export interface CaptureOptions {
    readonly sink: string;
    readonly format: CaptureFormat;
    readonly path: string;
    readonly log: (message: string, detail?: unknown) => void;
}

export function ffmpegArgs(options: { sink: string; format: CaptureFormat; path: string }): string[] {
    return [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-f',
        'pulse',
        '-i',
        `${options.sink}.monitor`,
        '-ac',
        '2',
        '-ar',
        '44100',
        ...CAPTURE_FORMATS[options.format].args,
        '-y',
        options.path,
    ];
}

/**
 * Start capturing now.
 *
 * Started BEFORE playback and stopped after it, so the record cannot be clipped at either end. The
 * cost of being early is silence, which is free; the cost of being late is the first half-second of
 * a record, which is not recoverable.
 */
export function startCapture(options: CaptureOptions): Capture {
    const child = spawn('ffmpeg', ffmpegArgs(options), { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', chunk => {
        stderr += String(chunk);
        options.log('ffmpeg', String(chunk).trim());
    });

    const exited = new Promise<number>(resolve => child.on('exit', code => resolve(code ?? 0)));
    let settled = false;

    return {
        async finish() {
            if (!settled) {
                settled = true;
                // `q` on stdin is the documented way to ask ffmpeg to finish and write its trailer;
                // SIGTERM leaves a FLAC without one, which is a file nothing will decode. stdin is
                // ignored above, so the signal is SIGINT, which ffmpeg treats the same way.
                child.kill('SIGINT');
            }
            const code = await exited;
            let bytes = 0;
            try {
                bytes = (await stat(options.path)).size;
            } catch {
                bytes = 0;
            }
            if (bytes === 0) throw new Error(`ffmpeg wrote nothing (exit ${code}): ${stderr.trim() || 'no output'}`);
            return { path: options.path, bytes };
        },
        async abandon() {
            if (!settled) {
                settled = true;
                child.kill('SIGKILL');
            }
            await exited.catch(() => undefined);
            await unlink(options.path).catch(() => undefined);
        },
    };
}

/**
 * Whether the sink the browser is supposed to be playing into actually exists.
 *
 * Asked at startup and by `/health`, because a missing sink is the failure that looks most like
 * success: Chrome plays to a null default, ffmpeg records an hour of digital silence, and every
 * record the station captures is a valid file of nothing.
 */
export async function sinkExists(sink: string): Promise<boolean> {
    return new Promise(resolve => {
        const child = spawn('pactl', ['list', 'short', 'sources'], { stdio: ['ignore', 'pipe', 'ignore'] });
        let out = '';
        child.stdout?.on('data', chunk => (out += String(chunk)));
        child.on('error', () => resolve(false));
        child.on('exit', () => resolve(out.includes(`${sink}.monitor`)));
    });
}
